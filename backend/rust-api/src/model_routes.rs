//! Model discovery, metadata and management without a Node API dependency.
use crate::{
    engine::NativeEngine,
    engine_runtime::EngineRuntime,
    metadata_cache::MetadataCache,
    process::ManagedProcess,
    processing_routes::{path_string, string, Error},
    scheduler::Resource,
    uploads,
};
use anyhow::{bail, Context, Result};
use axum::{
    extract::{Path as RoutePath, Query, Request, State},
    http::StatusCode,
    routing::{delete, get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::Arc,
};
use uuid::Uuid;

struct Models {
    engine: Arc<NativeEngine>,
    cache: MetadataCache,
}
pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/models", get(list))
        .route("/api/models/library", get(library))
        .route("/api/models/inspect", post(inspect))
        .route("/api/models/preload", post(preload))
        .route("/api/models/speakers", get(speakers))
        .route("/api/models/{name}", delete(remove))
        .with_state(Arc::new(Models {
            engine,
            cache: MetadataCache::default(),
        }))
}
fn files(root: &Path, extensions: &[&str], found: &mut Vec<PathBuf>) -> Result<()> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let mut entries: Vec<_> = entries.collect::<std::io::Result<_>>()?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let kind = entry.file_type()?;
        let path = entry.path();
        if kind.is_dir() {
            let name = entry.file_name().to_string_lossy().to_lowercase();
            if name != ".onnx-cache" && !name.starts_with(".onnx-export-") {
                files(&path, extensions, found)?;
            }
        } else if kind.is_file()
            && path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extensions.contains(&extension.to_lowercase().as_str()))
        {
            found.push(path);
        }
    }
    Ok(())
}
fn scan(root: &Path) -> Result<(Vec<PathBuf>, Vec<PathBuf>)> {
    let mut all = Vec::new();
    files(root, &["pth", "onnx", "index"], &mut all)?;
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
async fn list(State(state): State<Arc<Models>>) -> Result<Json<Value>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || -> Result<Json<Value>> {
        let (models, indexes) = scan(&runtime.logs)?;
        let mut audios = Vec::new();
        files(
            &runtime.data.join("assets/audios"),
            uploads::AUDIO_EXTENSIONS,
            &mut audios,
        )?;
        let mut models: Vec<_> = models
            .iter()
            .map(|file| runtime.model_relative(file))
            .collect();
        models.sort();
        let mut indexes: Vec<_> = indexes
            .iter()
            .map(|file| runtime.model_relative(file))
            .collect();
        indexes.sort();
        let mut audios: Vec<_> = audios
            .iter()
            .map(|file| runtime.model_relative(file))
            .collect();
        audios.sort();
        Ok(Json(
            json!({"models":models,"indexes":indexes,"audios":audios,"root":runtime.data}),
        ))
    })
    .await
    .map_err(Error::internal)?
    .map_err(Error::internal)
}
async fn library(State(state): State<Arc<Models>>) -> Result<Json<Value>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || -> Result<Json<Value>> {
        let (models,indexes)=scan(&runtime.logs)?;
        let mut results = Vec::new();
        for model in models {
            let metadata = model.metadata()?;
            let stem = model.file_stem().unwrap_or_default().to_string_lossy().into_owned();
            let index = indexes.iter().find(|index| index.parent()==model.parent() || {
                let index = index.file_stem().unwrap_or_default().to_string_lossy().to_lowercase();
                index.contains(&stem.to_lowercase()) || stem.to_lowercase().contains(&index)
            });
            let relative = runtime.model_relative(&model);
            let folder = model.parent().unwrap().strip_prefix(&runtime.logs)?.to_string_lossy().replace('\\',"/");
            results.push(json!({"id":relative,"name":stem,"pthPath":relative,"pthSize":metadata.len(),"indexPath":index.map(|file| runtime.model_relative(file)),"indexSize":index.map(|file| file.metadata().map(|m| m.len())).transpose()?,"modifiedAt":chrono::DateTime::<chrono::Utc>::from(metadata.modified()?).to_rfc3339_opts(chrono::SecondsFormat::Millis,true),"folder":if folder.is_empty() {"root"} else {&folder}}));
        }
        results.sort_by(|a,b| b["modifiedAt"].as_str().cmp(&a["modifiedAt"].as_str()));
        Ok(Json(json!({"models":results})))
    }).await.map_err(Error::internal)?.map_err(Error::internal)
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
            let token = engine.cancellation_token();
            let id = format!("inspect-{}", Uuid::new_v4());
            let _lease = engine
                .scheduler
                .acquire(&id, Resource::Gpu, &token)
                .await?
                .context("Applio is shutting down")?;
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
                    let spec =
                        engine
                            .runtime
                            .python_command(["-c", INSPECT_CODE, &path_string(path)])?;
                    let result = ManagedProcess::run(&spec, &token, |_, _| {}).await?;
                    result
                        .ensure_success()
                        .with_context(|| format!("Checkpoint reader fallback after {error}"))?;
                    let json = result
                        .stdout
                        .lines()
                        .rev()
                        .find_map(|line| line.split_once("APPLIO_JSON:").map(|(_, json)| json))
                        .context("Checkpoint reader did not report metadata")?;
                    serde_json::from_str(json)?
                }
            };
            if !value.is_object() {
                bail!("Checkpoint reader returned invalid metadata");
            }
            Ok(value)
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
    let engine = state.engine.clone();
    let id = format!("preload-{}", Uuid::new_v4());
    if let Some(lease) = engine.scheduler.try_gpu(&id) {
        let token = engine.cancellation_token();
        let background = engine.clone();
        engine
            .spawn_background(async move {
                let _lease = lease;
                if let Err(error) = background
                    .worker
                    .request(
                        json!({"command":"preload_model","pthPath":path,"sid":sid}),
                        &token,
                        |_| {},
                    )
                    .await
                {
                    eprintln!("Model preload: {error}");
                }
            })
            .await
            .map_err(Error::internal)?;
    }
    Ok(Json(json!({"ok":true,"preloading":name})))
}
fn delete_path(logs: &Path, name: &str) -> Result<PathBuf> {
    let name = name.replace('\\', "/");
    let name = name.strip_prefix("logs/").unwrap_or(&name);
    let root = std::fs::canonicalize(logs)?;
    let candidate = logs.join(name);
    // Check the lexical path before following links, then check the resolved
    // path too. Recursive deletes are confined to the selected models folder.
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
        // Recheck immediately before a recursive operation.
        let target = delete_path(&logs, &path_string(&target))?;
        if target.is_dir() {
            std::fs::remove_dir_all(&target).map_err(Error::internal)?;
        } else {
            std::fs::remove_file(&target).map_err(Error::internal)?;
            if let Some(parent) = target.parent().filter(|parent| *parent != logs) {
                if std::fs::read_dir(parent).is_ok_and(|mut entries| entries.next().is_none()) {
                    let _ = std::fs::remove_dir(parent);
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(Error::internal)??;
    state.cache.invalidate(&removed);
    Ok(Json(json!({"ok":true,"message":format!("Deleted {name}")})))
}
const INSPECT_CODE:&str="import sys,json; from rvc.lib.tools.inspect_checkpoint import inspect_checkpoint; print('APPLIO_JSON:'+json.dumps(inspect_checkpoint(sys.argv[1])))";
