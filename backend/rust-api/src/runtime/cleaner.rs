//! Temporary upload/output accounting and cleanup; model and user audio files
//! are never included in the temporary-output filename policy.
use crate::{engine::NativeEngine, engine_runtime::EngineRuntime};
use serde::Serialize;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    uploads_bytes: u64,
    uploads_count: u64,
    outputs_bytes: u64,
    outputs_count: u64,
    total_bytes: u64,
    total_files: u64,
}
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CleanResult {
    deleted_files: u64,
    freed_bytes: u64,
    errors: Vec<String>,
}
pub struct Options {
    pub max_age_ms: f64,
    pub uploads: bool,
    pub outputs: bool,
}
fn output(name: &str) -> bool {
    let name = name.to_lowercase();
    [
        "web_output_",
        "tts_output_",
        "tts_rvc_output_",
        "split_",
        "tts_input_",
        ".applio-report-",
    ]
    .iter()
    .any(|prefix| name.starts_with(prefix))
}
fn entries(directory: &Path, outputs: bool) -> std::io::Result<Vec<(PathBuf, fs::Metadata)>> {
    let mut files = Vec::new();
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name == ".gitkeep" || outputs && !output(&name) {
            continue;
        }
        if let Ok(metadata) = entry.path().symlink_metadata() {
            if metadata.is_file() {
                files.push((entry.path(), metadata));
            }
        }
    }
    Ok(files)
}
pub fn stats(runtime: &EngineRuntime) -> Stats {
    let mut stats = Stats::default();
    for (outputs, directory) in [(false, &runtime.uploads), (true, &runtime.outputs)] {
        for (_, metadata) in entries(directory, outputs).unwrap_or_default() {
            if outputs {
                stats.outputs_bytes += metadata.len();
                stats.outputs_count += 1;
            } else {
                stats.uploads_bytes += metadata.len();
                stats.uploads_count += 1;
            }
        }
    }
    stats.total_bytes = stats.uploads_bytes + stats.outputs_bytes;
    stats.total_files = stats.uploads_count + stats.outputs_count;
    stats
}
fn collect_paths(value: &serde_json::Value, runtime: &EngineRuntime, paths: &mut HashSet<PathBuf>) {
    match value {
        serde_json::Value::String(value) => {
            if let Ok(path) = runtime.resolve_user_path(value) {
                paths.insert(std::fs::canonicalize(&path).unwrap_or(path));
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                collect_paths(value, runtime, paths);
            }
        }
        serde_json::Value::Object(values) => {
            for value in values.values() {
                collect_paths(value, runtime, paths);
            }
        }
        _ => {}
    }
}
pub fn clean(engine: &NativeEngine, options: Options) -> CleanResult {
    let runtime = &engine.runtime;
    let mut result = CleanResult::default();
    let now = SystemTime::now();
    let mut protected = HashSet::new();
    let mut active_since = None;
    let mut revision;
    let refresh = |protected: &mut HashSet<PathBuf>, active_since: &mut Option<SystemTime>| {
        protected.clear();
        *active_since = None;
        for (created_at, params) in engine.jobs.active_params() {
            collect_paths(&params, runtime, protected);
            if let Ok(at) = chrono::DateTime::parse_from_rfc3339(&created_at) {
                let at = SystemTime::from(at);
                *active_since =
                    Some(active_since.map_or(at, |previous: SystemTime| previous.min(at)));
            }
        }
    };
    {
        let _uploads = crate::uploads::active_uploads();
        revision = engine.jobs.revision();
        refresh(&mut protected, &mut active_since);
    }
    for (outputs, enabled, directory) in [
        (false, options.uploads, &runtime.uploads),
        (true, options.outputs, &runtime.outputs),
    ] {
        if !enabled || !directory.exists() {
            continue;
        }
        let files = match entries(directory, outputs) {
            Ok(files) => files,
            Err(error) => {
                result.errors.push(format!(
                    "Failed to scan {} dir: {error}",
                    if outputs { "outputs" } else { "uploads" }
                ));
                continue;
            }
        };
        for (file, metadata) in files {
            // Admission and in-flight multipart staging use the same short
            // storage gate. Refresh job protection if work started after the
            // directory scan, before removing any temporary file.
            let uploads = crate::uploads::active_uploads();
            if uploads.contains(&file) {
                continue;
            }
            let current = engine.jobs.revision();
            if current != revision {
                refresh(&mut protected, &mut active_since);
                revision = current;
            }
            let canonical = std::fs::canonicalize(&file).unwrap_or_else(|_| file.clone());
            if protected
                .iter()
                .any(|path| canonical == *path || canonical.starts_with(path) && path.is_dir())
            {
                continue;
            }
            let modified = metadata.modified().unwrap_or(now);
            if active_since
                .is_some_and(|at| modified >= at.checked_sub(Duration::from_secs(30)).unwrap_or(at))
            {
                continue;
            }
            if options.max_age_ms > 0.0
                && now
                    .duration_since(modified)
                    .unwrap_or_default()
                    .as_secs_f64()
                    * 1000.0
                    < options.max_age_ms
            {
                continue;
            }
            match fs::remove_file(&file) {
                Ok(()) => {
                    result.deleted_files += 1;
                    result.freed_bytes += metadata.len();
                }
                Err(error) => result.errors.push(format!(
                    "Failed to remove {}: {error}",
                    file.file_name().unwrap_or_default().to_string_lossy()
                )),
            }
        }
    }
    let _uploads = crate::uploads::active_uploads();
    if engine.jobs.active_params().is_empty() {
        for file in ["infer_pid.txt", "extract_pid.txt"] {
            let _ = fs::remove_file(runtime.data.join("assets").join(file));
        }
    }
    result
}
