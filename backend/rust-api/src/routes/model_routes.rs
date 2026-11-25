//! Model discovery, metadata and management without a Node API dependency.
use crate::{
    engine::NativeEngine,
    engine_runtime::EngineRuntime,
    metadata_cache::MetadataCache,
    process::ManagedProcess,
    processing_routes::{path_string, string, Error},
    uploads,
};
use anyhow::{bail, Context, Result};
use axum::{
    extract::{Path as RoutePath, Query, Request, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    ffi::OsStr,
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

struct Models {
    engine: Arc<NativeEngine>,
    cache: MetadataCache,
}
pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/models", get(list))
        .route("/api/models/voices", get(voices))
        .route("/api/models/audios", get(audios))
        .route("/api/models/library", get(library))
        .route("/api/models/dashboard", get(dashboard))
        .route("/api/models/inspect", post(inspect))
        .route("/api/models/preload", post(preload))
        .route("/api/models/speakers", get(speakers))
        .route("/api/models/{name}", delete(remove))
        .with_state(Arc::new(Models {
            engine,
            cache: MetadataCache::default(),
        }))
}
fn visit_files(
    root: &Path,
    extensions: &[&str],
    visit: &mut impl FnMut(&Path, &OsStr),
) -> Result<()> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    for entry in entries {
        let entry = entry?;
        let kind = entry.file_type()?;
        let name = entry.file_name();
        if kind.is_dir() {
            let folder = name.to_string_lossy();
            let exporting = folder
                .get(..".onnx-export-".len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(".onnx-export-"));
            if !folder.eq_ignore_ascii_case(".onnx-cache") && !exporting {
                visit_files(&root.join(&name), extensions, visit)?;
            }
        } else if kind.is_file()
            && Path::new(&name)
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| {
                    extensions
                        .iter()
                        .any(|supported| extension.eq_ignore_ascii_case(supported))
                })
        {
            visit(root, &name);
        }
    }
    Ok(())
}
pub(crate) fn scan(root: &Path) -> Result<(Vec<PathBuf>, Vec<PathBuf>)> {
    let mut all = Vec::new();
    visit_files(root, &["pth", "onnx", "index"], &mut |folder, name| {
        all.push(folder.join(name));
    })?;
    // Component ordering preserves the original sorted depth-first scan for index matching.
    all.sort_unstable();
    let (mut models, mut indexes) = (Vec::new(), Vec::new());
    for file in all {
        let name = file.file_name().unwrap_or_default().to_string_lossy();
        if file
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("index"))
        {
            if !name.contains("trained") {
                indexes.push(file);
            }
        } else if !name.starts_with("G_") && !name.starts_with("D_") {
            models.push(file);
        }
    }
    Ok((models, indexes))
}
fn visit_samples(runtime: &EngineRuntime, visit: &mut impl FnMut(&Path, &OsStr)) -> Result<()> {
    visit_files(
        &runtime.data.join("assets/audios"),
        uploads::AUDIO_EXTENSIONS,
        visit,
    )
}

fn sample_paths(runtime: &EngineRuntime) -> Result<Vec<String>> {
    let mut audios = Vec::new();
    visit_samples(runtime, &mut |folder, name| {
        audios.push(runtime.model_relative(&folder.join(name)));
    })?;
    audios.sort_unstable();
    Ok(audios)
}

async fn list(State(state): State<Arc<Models>>) -> Result<Json<Value>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || -> Result<Json<Value>> {
        let VoiceLists { models, indexes } = voice_lists(&runtime)?;
        let audios = sample_paths(&runtime)?;
        Ok(Json(
            json!({"models":models,"indexes":indexes,"audios":audios,"root":runtime.data}),
        ))
    })
    .await
    .map_err(Error::internal)?
    .map_err(Error::internal)
}

fn relative_paths(runtime: &EngineRuntime, paths: Vec<PathBuf>) -> Vec<String> {
    let mut paths: Vec<_> = paths
        .iter()
        .map(|path| runtime.model_relative(path))
        .collect();
    paths.sort_unstable();
    paths
}

#[derive(Serialize)]
struct VoiceLists {
    models: Vec<String>,
    indexes: Vec<String>,
}

fn voice_lists(runtime: &EngineRuntime) -> Result<VoiceLists> {
    let (models, indexes) = scan(&runtime.logs)?;
    Ok(VoiceLists {
        models: relative_paths(runtime, models),
        indexes: relative_paths(runtime, indexes),
    })
}

async fn voices(State(state): State<Arc<Models>>) -> Result<Json<VoiceLists>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || voice_lists(&runtime))
        .await
        .map_err(Error::internal)?
        .map(Json)
        .map_err(Error::internal)
}

#[derive(Serialize)]
struct SampleList {
    audios: Vec<String>,
}

async fn audios(State(state): State<Arc<Models>>) -> Result<Json<SampleList>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || -> Result<SampleList> {
        Ok(SampleList {
            audios: sample_paths(&runtime)?,
        })
    })
    .await
    .map_err(Error::internal)?
    .map(Json)
    .map_err(Error::internal)
}
#[derive(Serialize)]
struct ModelLibrary {
    models: Vec<LibraryModel>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelDashboard {
    model_count: usize,
    audio_count: usize,
    recent_models: Vec<LibraryModel>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LibraryModel {
    id: String,
    name: String,
    pth_path: String,
    pth_size: u64,
    index_path: Option<String>,
    index_size: Option<u64>,
    modified_at: String,
    folder: String,
}

struct LibraryIndex<'a> {
    path: &'a Path,
    folded_stem: String,
    details: Option<(String, u64)>,
}

impl LibraryIndex<'_> {
    fn details(&mut self, runtime: &EngineRuntime) -> Result<(String, u64)> {
        let details = match &self.details {
            Some(details) => details,
            None => self.details.insert((
                runtime.model_relative(self.path),
                self.path.metadata()?.len(),
            )),
        };
        Ok(details.clone())
    }
}

fn library_models(
    runtime: &EngineRuntime,
    models: Vec<PathBuf>,
    indexes: &[PathBuf],
    limit: usize,
) -> Result<Vec<LibraryModel>> {
    let mut models = models
        .into_iter()
        .map(|model| {
            let metadata = model.metadata()?;
            let modified_at = chrono::DateTime::<chrono::Utc>::from(metadata.modified()?);
            Ok((model, metadata.len(), modified_at))
        })
        .collect::<std::io::Result<Vec<_>>>()?;
    // Keep scan order for modification times that display as the same millisecond.
    models.sort_by_key(|(_, _, modified_at)| std::cmp::Reverse(modified_at.timestamp_millis()));
    models.truncate(limit);

    let mut first_index_by_folder = HashMap::new();
    let mut candidates: Vec<_> = indexes
        .iter()
        .enumerate()
        .map(|(position, path)| {
            first_index_by_folder
                .entry(path.parent())
                .or_insert(position);
            LibraryIndex {
                path,
                folded_stem: path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_lowercase(),
                details: None,
            }
        })
        .collect();

    let mut results = Vec::with_capacity(models.len());
    for (model, pth_size, modified_at) in models {
        let name = model.file_stem().unwrap_or_default().to_string_lossy();
        let folded_stem = name.to_lowercase();
        let parent = model.parent();
        let first_local = first_index_by_folder
            .get(&parent)
            .copied()
            .unwrap_or(candidates.len());
        // The scan's first match wins. A name match in an earlier folder can
        // take precedence over the first index in the model's own folder.
        let position = candidates[..first_local]
            .iter()
            .position(|index| {
                index.folded_stem.contains(&folded_stem) || folded_stem.contains(&index.folded_stem)
            })
            .unwrap_or(first_local);
        let (index_path, index_size) = candidates
            .get_mut(position)
            .map(|index| index.details(runtime))
            .transpose()?
            .unzip();
        let relative = runtime.model_relative(&model);
        let folder = parent
            .context("Model has no parent folder")?
            .strip_prefix(&runtime.logs)?
            .to_string_lossy()
            .replace('\\', "/");
        results.push(LibraryModel {
            id: relative.clone(),
            name: name.into_owned(),
            pth_path: relative,
            pth_size,
            index_path,
            index_size,
            modified_at: modified_at.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            folder: if folder.is_empty() {
                "root".into()
            } else {
                folder
            },
        });
    }
    Ok(results)
}

fn model_library(runtime: &EngineRuntime) -> Result<ModelLibrary> {
    let (models, indexes) = scan(&runtime.logs)?;
    let limit = models.len();
    Ok(ModelLibrary {
        models: library_models(runtime, models, &indexes, limit)?,
    })
}

fn model_dashboard(runtime: &EngineRuntime) -> Result<ModelDashboard> {
    let (models, indexes) = scan(&runtime.logs)?;
    let mut audio_count = 0;
    visit_samples(runtime, &mut |_, _| audio_count += 1)?;
    Ok(ModelDashboard {
        model_count: models.len(),
        audio_count,
        recent_models: library_models(runtime, models, &indexes, 4)?,
    })
}

async fn dashboard(State(state): State<Arc<Models>>) -> Result<Json<ModelDashboard>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || model_dashboard(&runtime))
        .await
        .map_err(Error::internal)?
        .map(Json)
        .map_err(Error::internal)
}

async fn library(State(state): State<Arc<Models>>) -> Result<Json<ModelLibrary>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || model_library(&runtime))
        .await
        .map_err(Error::internal)?
        .map(Json)
        .map_err(Error::internal)
}
fn model_path(runtime: &EngineRuntime, value: &str) -> Result<PathBuf, Error> {
    if value.is_empty() {
        return Err(Error::input("pthPath is required"));
    }
    let path = runtime.resolve_user_path(value).map_err(|error| {
        if Path::new(value).is_absolute() && !Path::new(value).exists() {
            Error(
                StatusCode::NOT_FOUND,
                json!({"error":format!("File not found: {value}")}),
            )
        } else {
            Error::input(error)
        }
    })?;
    if !path.is_file() {
        return Err(Error(
            StatusCode::NOT_FOUND,
            json!({"error":format!("File not found: {value}")}),
        ));
    }
    Ok(path)
}
async fn metadata(state: &Models, path: &Path) -> Result<(Value, bool)> {
    state
        .cache
        .get(path, || async {
            let engine = &state.engine;
            let shutdown = engine.cancellation_token();
            let id = format!("inspect-{}", Uuid::new_v4());
            loop {
                let token = shutdown.child_token();
                let Some(lease) = engine.scheduler.acquire_background_gpu(&id, &token).await?
                else {
                    if shutdown.is_cancelled() {
                        bail!("Applio is shutting down");
                    }
                    continue;
                };
                let result: Result<Value> = async {
                    let value = match engine
                        .worker
                        .request(
                            json!({"command":"inspect_model","pthPath":path}),
                            &token,
                            |_| {},
                        )
                        .await
                    {
                        Ok(response) => response["metadata"].clone(),
                        Err(error) => {
                            if token.is_cancelled() {
                                bail!("Applio is shutting down");
                            }
                            engine.worker.stop().await?;
                            let spec = engine.runtime.python_command([
                                "-c",
                                INSPECT_CODE,
                                &path_string(path),
                            ])?;
                            let result = ManagedProcess::run(&spec, &token, |_, _| {}).await?;
                            result.ensure_success().with_context(|| {
                                format!("Checkpoint reader fallback after {error}")
                            })?;
                            let json = result
                                .stdout
                                .lines()
                                .rev()
                                .find_map(|line| {
                                    line.split_once("APPLIO_JSON:").map(|(_, json)| json)
                                })
                                .context("Checkpoint reader did not report metadata")?;
                            serde_json::from_str(json)?
                        }
                    };
                    Ok(value)
                }
                .await;
                drop(lease);
                if token.is_cancelled() && !shutdown.is_cancelled() {
                    // Let the requested action finish admission before retrying
                    // this optional read; foreground GPU work stays ahead.
                    tokio::select! {
                        _ = shutdown.cancelled() => bail!("Applio is shutting down"),
                        _ = tokio::time::sleep(std::time::Duration::from_millis(250)) => {},
                    }
                    continue;
                }
                let value = result?;
                if !value.is_object() {
                    bail!("Checkpoint reader returned invalid metadata");
                }
                return Ok(value);
            }
        })
        .await
}
fn inspection_error(error: anyhow::Error, speakers: bool) -> Error {
    let message = format!("{error:#}");
    if let Some((_, detail)) = message.split_once("LOAD_FAILED:") {
        let limit = if speakers { 300 } else { 500 };
        let detail: String = detail.trim().chars().take(limit).collect();
        let prefix = if speakers {
            "Could not read checkpoint"
        } else {
            "Could not read checkpoint (file may be corrupted or not an RVC checkpoint)"
        };
        Error(
            StatusCode::UNPROCESSABLE_ENTITY,
            json!({"error":format!("{prefix}: {detail}")}),
        )
    } else {
        Error::internal(message)
    }
}
async fn inspect(State(state): State<Arc<Models>>, request: Request) -> Result<Json<Value>, Error> {
    let input = uploads::parse(request, &state.engine.runtime.uploads, &[]).await?;
    let path = model_path(&state.engine.runtime, &string(&input.body, "pthPath"))?;
    let (metadata, cached) = metadata(&state, &path)
        .await
        .map_err(|error| inspection_error(error, false))?;
    Ok(Json(json!({"ok":true,"metadata":metadata,"cached":cached})))
}
async fn speakers(
    State(state): State<Arc<Models>>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, Error> {
    let value = query
        .get("pthPath")
        .filter(|value| !value.is_empty())
        .context("Provide 'pthPath'.")?;
    let path = model_path(&state.engine.runtime, value)?;
    let (metadata, _) = metadata(&state, &path)
        .await
        .map_err(|error| inspection_error(error, true))?;
    let count = match &metadata["speakers_id"] {
        Value::Number(value) => value.as_f64().unwrap_or_default(),
        Value::String(value) => value.trim().parse::<f64>().unwrap_or_default(),
        Value::Bool(true) => 1.0,
        _ => 0.0,
    };
    let count = if count.is_nan() { 0.0 } else { count.trunc() };
    if !count.is_finite() || count.abs() > 9_007_199_254_740_991.0 || count > 65536.0 {
        return Err(Error::internal("Invalid speaker count in checkpoint"));
    }
    let ids: Vec<_> = if count > 0.0 {
        (0..count as u32).collect()
    } else {
        vec![0]
    };
    Ok(Json(json!({"speakers":ids})))
}
async fn preload(State(state): State<Arc<Models>>, request: Request) -> Result<Json<Value>, Error> {
    let input = uploads::parse(request, &state.engine.runtime.uploads, &[]).await?;
    let path = model_path(&state.engine.runtime, &string(&input.body, "pthPath"))?;
    let sid = match input.body.get("sid") {
        None | Some(Value::Null) => Some(0.0),
        Some(Value::Number(value)) => value.as_f64(),
        Some(Value::String(value)) => {
            if value.trim().is_empty() {
                Some(0.0)
            } else {
                value.trim().parse().ok()
            }
        }
        Some(Value::Bool(value)) => Some(if *value { 1.0 } else { 0.0 }),
        _ => None,
    };
    let sid = sid
        .filter(|sid| sid.is_finite() && sid.fract() == 0.0)
        .ok_or_else(|| Error::input("pthPath is required"))?;
    let name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .into_owned();
    // Optional background conversion that warms the rest of the pipeline:
    // embedder, F0 models, retrieval index and the device kernels.
    let wants_prime = input
        .body
        .get("prime")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let prime_params = input
        .body
        .get("params")
        .filter(|_| wants_prime)
        .cloned()
        .filter(Value::is_object);
    let engine = state.engine.clone();
    let id = format!("preload-{}", Uuid::new_v4());
    let token = engine.cancellation_token();
    if let Some(lease) = engine.scheduler.try_background_gpu(&id, &token) {
        let background = engine.clone();
        engine
            .spawn_background(async move {
                let _lease = lease;
                let loaded = background
                    .worker
                    .request(
                        json!({"command":"preload_model","pthPath":path,"sid":sid}),
                        &token,
                        |_| {},
                    )
                    .await;
                if let Err(error) = loaded {
                    if !token.is_cancelled() {
                        eprintln!("Model preload: {error}");
                    }
                    return;
                }
                let Some(params) = prime_params else {
                    return;
                };
                if let Err(error) = warm_pipeline(&background, params, path, sid, &token).await {
                    if !token.is_cancelled() {
                        eprintln!("Model prime: {error}");
                    }
                }
            })
            .await
            .map_err(Error::internal)?;
    }
    Ok(Json(json!({"ok":true,"preloading":name})))
}
async fn warm_pipeline(
    engine: &Arc<NativeEngine>,
    mut params: Value,
    path: PathBuf,
    sid: f64,
    token: &CancellationToken,
) -> Result<()> {
    params["pthPath"] = json!(path_string(&path));
    params["sid"] = json!(sid);
    // The output is discarded; never pay for format conversion.
    params["exportFormat"] = json!("WAV");
    let index = params
        .get("indexPath")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim()
        .to_owned();
    if !index.is_empty() {
        params["indexPath"] = match engine.runtime.require_file(&index) {
            Ok(resolved) => json!(path_string(&resolved)),
            Err(_) => json!(""),
        };
    }
    let input = prime_audio()?;
    let output = std::env::temp_dir().join(format!("applio-prime-{}.wav", Uuid::new_v4()));
    let result = engine
        .worker
        .request(
            json!({
                "command": "infer",
                "params": params,
                "inputPath": path_string(&input),
                "outputPath": path_string(&output),
            }),
            token,
            |_| {},
        )
        .await;
    let _ = std::fs::remove_file(&output);
    result.map(|_| ())
}
/// One second of a quiet 16 kHz tone that exercises the full conversion path.
fn prime_audio() -> Result<PathBuf> {
    let path = std::env::temp_dir().join("applio-prime-input.wav");
    if std::fs::metadata(&path)
        .map(|meta| meta.len() > 44)
        .unwrap_or(false)
    {
        return Ok(path);
    }
    const SAMPLE_RATE: u32 = 16_000;
    const SAMPLES: u32 = SAMPLE_RATE;
    let data_len = SAMPLES * 2;
    let mut bytes = Vec::with_capacity(44 + data_len as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_len).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16u32.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&1u16.to_le_bytes());
    bytes.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    bytes.extend_from_slice(&(SAMPLE_RATE * 2).to_le_bytes());
    bytes.extend_from_slice(&2u16.to_le_bytes());
    bytes.extend_from_slice(&16u16.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_len.to_le_bytes());
    for n in 0..SAMPLES {
        let phase = 2.0 * std::f64::consts::PI * 220.0 * f64::from(n) / f64::from(SAMPLE_RATE);
        let sample = (0.2 * phase.sin() * 32767.0) as i16;
        bytes.extend_from_slice(&sample.to_le_bytes());
    }
    std::fs::write(&path, bytes).with_context(|| format!("Write {}", path.display()))?;
    Ok(path)
}
fn delete_path(logs: &Path, name: &str) -> Result<PathBuf> {
    let name = name.replace('\\', "/");
    let name = name.strip_prefix("logs/").unwrap_or(&name);
    let root = std::fs::canonicalize(logs)?;
    let candidate = logs.join(name);
    // Check the lexical path before following links, then check the resolved
    // path too. Deletes are confined to the logs directory.
    let mut lexical = PathBuf::new();
    for part in candidate.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                lexical.pop();
            }
            part => lexical.push(part.as_os_str()),
        }
    }
    let mut lexical_root = PathBuf::new();
    for part in logs.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                lexical_root.pop();
            }
            part => lexical_root.push(part.as_os_str()),
        }
    }
    if lexical == lexical_root || !lexical.starts_with(&lexical_root) {
        bail!("Invalid model path: escapes logs directory");
    }
    if candidate.exists() {
        let resolved = std::fs::canonicalize(&candidate)?;
        if resolved == root || !resolved.starts_with(&root) {
            bail!("Invalid model path: escapes logs directory");
        }
    }
    Ok(candidate)
}
fn is_model_checkpoint(path: &Path) -> bool {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| matches!(extension.to_lowercase().as_str(), "pth" | "onnx"))
        && !name.starts_with("G_")
        && !name.starts_with("D_")
}
fn prune_model_directory(directory: &Path) -> Result<()> {
    let entries = match std::fs::read_dir(directory) {
        Ok(entries) => entries.collect::<std::io::Result<Vec<_>>>()?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    if entries.iter().any(|entry| {
        entry.file_type().is_ok_and(|kind| kind.is_file()) && is_model_checkpoint(&entry.path())
    }) {
        return Ok(());
    }
    // Indexes are shared by all checkpoints in a training folder, so keep them
    // until the last inference model is gone.
    for entry in &entries {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase();
        if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("index"))
            && !name.contains("trained")
        {
            std::fs::remove_file(path)?;
        }
    }
    if std::fs::read_dir(directory)?.next().is_none() {
        std::fs::remove_dir(directory)?;
    }
    Ok(())
}
fn remove_model_file(logs: &Path, target: &Path) -> Result<()> {
    std::fs::remove_file(target)?;
    if let Some(parent) = target.parent().filter(|parent| *parent != logs) {
        prune_model_directory(parent)?;
    }
    Ok(())
}
fn remove_target(logs: &Path, target: &Path) -> Result<(), Error> {
    // Folders contain every checkpoint from a training run. Only remove the
    // file the user selected.
    if target.is_dir() {
        return Err(Error::input(
            "Select a model checkpoint to delete, not a folder",
        ));
    }
    remove_model_file(logs, target).map_err(Error::internal)
}
async fn remove(
    State(state): State<Arc<Models>>,
    RoutePath(name): RoutePath<String>,
) -> Result<Json<Value>, Error> {
    let logs = state.engine.runtime.logs.clone();
    let target = delete_path(&logs, &name)?;
    let removed = target.clone();
    let display = name.clone();
    tokio::task::spawn_blocking(move || -> Result<(), Error> {
        if !target.exists() {
            return Err(Error(
                StatusCode::NOT_FOUND,
                json!({"error":format!("Model not found: {display}")}),
            ));
        }
        // Recheck immediately before removing anything.
        let target = delete_path(&logs, &path_string(&target))?;
        remove_target(&logs, &target)?;
        Ok(())
    })
    .await
    .map_err(Error::internal)??;
    state.cache.invalidate(&removed);
    Ok(Json(json!({"ok":true,"message":format!("Deleted {name}")})))
}
const INSPECT_CODE:&str="import sys,json; from rvc.lib.tools.inspect_checkpoint import inspect_checkpoint; print('APPLIO_JSON:'+json.dumps(inspect_checkpoint(sys.argv[1])))";
#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(path: &Path) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, b"checkpoint").unwrap();
    }

    #[test]
    fn library_preserves_the_first_matching_index_and_model_aliases() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        let logs = root.join("moved models");
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::write(
            root.join("assets/config_template.json"),
            json!({"logs_dir": logs}).to_string(),
        )
        .unwrap();
        write(&root.join("backend/applio/rvc/configs/config.py"));
        let runtime = EngineRuntime::open(&crate::ApiConfig {
            code_root: root.into(),
            data_root: root.join("data"),
            config_dir: root.join("config"),
        })
        .unwrap();

        for (position, file) in [
            "a/älva.index",
            "b/000-fallback.index",
            "b/voice.index",
            "b/ÄLVA_100s.pth",
            "b/voice_100s.pth",
            "b/voice_200s.ONNX",
            "c/added_IVF_Zola.index",
            "d/zola.pth",
            "plain.pth",
        ]
        .into_iter()
        .enumerate()
        {
            let path = logs.join(file);
            write(&path);
            fs::OpenOptions::new()
                .write(true)
                .open(&path)
                .unwrap()
                .set_modified(
                    std::time::UNIX_EPOCH + std::time::Duration::from_secs(position as u64),
                )
                .unwrap();
        }
        write(&runtime.data.join("assets/audios/sample.wav"));
        write(&runtime.data.join("assets/audios/nested/upper.MP3"));
        write(&runtime.data.join("assets/audios/.ONNX-CACHE/ignored.wav"));
        write(
            &runtime
                .data
                .join("assets/audios/.Onnx-Export-12/ignored.wav"),
        );
        write(&runtime.data.join("assets/audios/ignored.jpg"));
        assert_eq!(
            sample_paths(&runtime).unwrap(),
            ["assets/audios/nested/upper.MP3", "assets/audios/sample.wav"]
        );

        let library = model_library(&runtime).unwrap();
        let entries: HashMap<_, _> = library
            .models
            .iter()
            .map(|model| (model.pth_path.as_str(), model))
            .collect();
        let cases = [
            ("logs/b/ÄLVA_100s.pth", Some("logs/a/älva.index")),
            ("logs/b/voice_100s.pth", Some("logs/b/000-fallback.index")),
            ("logs/b/voice_200s.ONNX", Some("logs/b/000-fallback.index")),
            ("logs/d/zola.pth", Some("logs/c/added_IVF_Zola.index")),
            ("logs/plain.pth", None),
        ];
        assert_eq!(entries.len(), cases.len());
        for (path, expected_index) in cases {
            let entry = entries[path];
            assert_eq!(entry.id, path);
            assert_eq!(entry.index_path.as_deref(), expected_index);
            assert_eq!(entry.index_size, expected_index.map(|_| 10));
        }

        let dashboard = model_dashboard(&runtime).unwrap();
        assert_eq!(dashboard.model_count, 5);
        assert_eq!(dashboard.audio_count, 2);
        assert_eq!(dashboard.recent_models.len(), 4);
        assert_eq!(dashboard.recent_models[0].pth_path, "logs/plain.pth");
        assert_eq!(
            serde_json::to_value(&dashboard.recent_models).unwrap(),
            serde_json::to_value(&library.models[..4]).unwrap()
        );
    }

    #[test]
    fn deleting_one_checkpoint_keeps_snapshots_and_shared_index() {
        let temp = tempfile::tempdir().unwrap();
        let logs = temp.path().join("logs");
        let folder = logs.join("voice");
        let first = folder.join("voice_10e_100s.pth");
        let second = folder.join("voice_20e_200s.pth");
        let index = folder.join("voice.index");
        let training = folder.join("G_2333333.pth");
        for file in [&first, &second, &index, &training] {
            write(file);
        }

        remove_model_file(&logs, &first).unwrap();
        assert!(!first.exists());
        assert!(second.exists());
        assert!(index.exists());
        assert!(training.exists());

        remove_model_file(&logs, &second).unwrap();
        assert!(!second.exists());
        assert!(!index.exists());
        assert!(training.exists());
        assert!(folder.exists());
    }

    #[test]
    fn deleting_the_last_checkpoint_removes_the_index_and_empty_folder() {
        let temp = tempfile::tempdir().unwrap();
        let logs = temp.path().join("logs");
        let folder = logs.join("voice");
        let model = folder.join("voice.pth");
        let index = folder.join("voice.index");
        write(&model);
        write(&index);

        remove_model_file(&logs, &model).unwrap();
        assert!(!model.exists());
        assert!(!index.exists());
        assert!(!folder.exists());
    }

    #[test]
    fn deleting_a_folder_is_rejected_without_touching_its_files() {
        let temp = tempfile::tempdir().unwrap();
        let logs = temp.path().join("logs");
        let folder = logs.join("voice");
        let first = folder.join("voice_10e_100s.pth");
        let second = folder.join("voice_20e_200s.pth");
        write(&first);
        write(&second);

        let error = remove_target(&logs, &folder).unwrap_err();
        assert_eq!(error.0, StatusCode::BAD_REQUEST);
        assert!(first.exists());
        assert!(second.exists());
    }
}
