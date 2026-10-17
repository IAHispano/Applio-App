//! Validate this run's inference export instead of accepting stale exports or
//! optimizer/discriminator checkpoints as a successfully trained voice model.
use anyhow::{bail, Result};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    time::SystemTime,
};
#[derive(Eq, PartialEq)]
pub struct Stamp {
    size: u64,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
    changed: Option<(i64, i64)>,
}
pub fn snapshot(directory: &Path) -> Result<HashMap<String, Stamp>> {
    let mut result = HashMap::new();
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(result),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if !entry.file_type()?.is_file() || !name.ends_with(".pth") {
            continue;
        }
        let metadata = entry.metadata()?;
        #[cfg(unix)]
        let changed = {
            use std::os::unix::fs::MetadataExt;
            Some((metadata.ctime(), metadata.ctime_nsec()))
        };
        #[cfg(not(unix))]
        let changed = None;
        result.insert(
            name,
            Stamp {
                size: metadata.len(),
                modified: metadata.modified().ok(),
                created: metadata.created().ok(),
                changed,
            },
        );
    }
    Ok(result)
}
pub fn trained(
    directory: &Path,
    name: &str,
    before: &HashMap<String, Stamp>,
    epochs: u64,
) -> Result<PathBuf> {
    let mut candidates = Vec::new();
    for (file, stamp) in snapshot(directory)? {
        if before.get(&file) == Some(&stamp) || stamp.size == 0 {
            continue;
        }
        if file == format!("{name}.pth") {
            candidates.push((None, None, file));
        } else if let Some(suffix) = file
            .strip_prefix(&format!("{name}_"))
            .and_then(|suffix| suffix.strip_suffix("s.pth"))
        {
            if let Some((epoch, step)) = suffix.split_once("e_") {
                if let (Ok(epoch), Ok(step)) = (epoch.parse::<u64>(), step.parse::<u64>()) {
                    if epoch >= epochs {
                        candidates.push((Some(epoch), Some(step), file));
                    }
                }
            }
        }
    }
    candidates.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| b.1.cmp(&a.1)));
    if let Some((_, _, file)) = candidates.first() {
        return Ok(directory.join(file));
    }
    bail!("Training did not save a new voice model in {}. Expected {name}_<epoch>e_<step>s.pth or {name}.pth. Check the training logs for model export errors; G_/D_ files are training checkpoints.",directory.display())
}
pub fn index(directory: &Path, name: &str) -> Result<PathBuf> {
    let file = directory.join(format!("{name}.index"));
    if !file
        .symlink_metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
    {
        bail!("Index generation produced no usable index file: {}. Check the feature extraction and index logs.",file.display());
    }
    Ok(file)
}
