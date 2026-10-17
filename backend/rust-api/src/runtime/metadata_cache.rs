//! A bounded metadata-only LRU with single-flight loads and file/sidecar stamps.
//! Failed or aborted reads are never retained. A checkpoint changed during its
//! load is returned to that caller but cannot poison subsequent inspections.
use anyhow::Result;
use serde_json::Value;
use std::{
    collections::{HashMap, VecDeque},
    future::Future,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
    time::SystemTime,
};

#[derive(Clone, Debug, PartialEq)]
struct Stamp {
    size: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
    changed: Option<(i64, i64)>,
}
fn stamp(path: &Path) -> Result<Option<Stamp>> {
    let metadata = match std::fs::metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.into()),
    };
    #[cfg(unix)]
    let changed = {
        use std::os::unix::fs::MetadataExt;
        Some((metadata.ctime(), metadata.ctime_nsec()))
    };
    #[cfg(not(unix))]
    let changed = None;
    Ok(Some(Stamp {
        size: metadata.len(),
        modified: metadata.modified().ok(),
        created: metadata.created().ok(),
        changed,
    }))
}
type Signature = (Option<Stamp>, Option<Stamp>);
fn signature(path: &Path) -> Result<Signature> {
    Ok((
        stamp(path)?,
        stamp(
            &path
                .parent()
                .unwrap_or_else(|| Path::new("."))
                .join("model_info.json"),
        )?,
    ))
}
struct Entry {
    path: PathBuf,
    signature: Signature,
    value: Value,
}
#[derive(Default)]
pub struct MetadataCache {
    entries: Mutex<VecDeque<Entry>>,
    gates: Mutex<HashMap<PathBuf, Weak<tokio::sync::Mutex<()>>>>,
}
impl MetadataCache {
    fn hit(&self, path: &Path, signature: &Signature) -> Option<Value> {
        let mut entries = self.entries.lock().unwrap();
        let position = entries.iter().position(|entry| entry.path == path)?;
        let entry = entries.remove(position).unwrap();
        if entry.signature != *signature {
            return None;
        }
        let value = entry.value.clone();
        entries.push_back(entry);
        Some(value)
    }
    pub async fn get<F: Future<Output = Result<Value>>>(
        &self,
        path: &Path,
        load: impl FnOnce() -> F,
    ) -> Result<(Value, bool)> {
        let before = signature(path)?;
        if let Some(value) = self.hit(path, &before) {
            return Ok((value, true));
        }
        let gate = {
            let mut gates = self.gates.lock().unwrap();
            gates.retain(|_, gate| gate.strong_count() > 0);
            if let Some(gate) = gates.get(path).and_then(Weak::upgrade) {
                gate
            } else {
                let gate = Arc::new(tokio::sync::Mutex::new(()));
                gates.insert(path.into(), Arc::downgrade(&gate));
                gate
            }
        };
        let _guard = gate.lock().await;
        let before = signature(path)?;
        // Concurrent subscribers share one result, but report cached=false as
        // the original API does for subscribers to an in-flight request.
        if let Some(value) = self.hit(path, &before) {
            return Ok((value, false));
        }
        let value = load().await?;
        if signature(path)? == before {
            let mut entries = self.entries.lock().unwrap();
            entries.retain(|entry| entry.path != path);
            entries.push_back(Entry {
                path: path.into(),
                signature: before,
                value: value.clone(),
            });
            while entries.len() > 64 {
                entries.pop_front();
            }
        }
        Ok((value, false))
    }
    pub fn invalidate(&self, path: &Path) {
        self.entries
            .lock()
            .unwrap()
            .retain(|entry| !entry.path.starts_with(path));
    }
}
