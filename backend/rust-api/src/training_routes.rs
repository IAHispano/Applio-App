//! Training lifecycle, artifact discovery and uploads coordinated by Rust.
use crate::{
    engine::{JobResult, NativeEngine},
    jobs::{Job, JobType},
    process::{json_result, ManagedProcess},
    processing_routes::{accepted, path_string, string, Accepted, Error},
    scheduler::Resource,
    training_artifacts as artifacts, training_params as params,
    uploads::{self, UploadRule},
};
use anyhow::{bail, Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Query, Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use regex::Regex;
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Component, Path, PathBuf},
    sync::{Arc, OnceLock},
    time::Duration,
};
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;
use tower_http::services::ServeFile;
use uuid::Uuid;
struct Training {
    engine: Arc<NativeEngine>,
    gpu: tokio::sync::Mutex<Option<(tokio::time::Instant, Value)>>,
}
pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/train/datasets", get(datasets))
        .route("/api/train/pretraineds", get(pretraineds))
        .route("/api/train/embedders", get(embedders))
        .route("/api/train/gpus", get(gpus))
        .route("/api/train/exports", get(exports))
        .route("/api/train/export-file", get(export_file))
        .route("/api/train/upload-dataset", post(upload_dataset))
        .route("/api/train/upload-pretrained", post(upload_pretrained))
        .route("/api/train/upload-embedder", post(upload_embedder))
        .route("/api/train/preprocess", post(preprocess))
        .route("/api/train/extract", post(extract))
        .route("/api/train/train", post(train))
        .route("/api/train/index", post(index))
        .route("/api/train/pipeline", post(pipeline))
        .route("/api/train/stop", post(stop))
        .layer(DefaultBodyLimit::disable())
        .with_state(Arc::new(Training {
            engine,
            gpu: tokio::sync::Mutex::new(None),
        }))
}
fn walk(
    root: &Path,
    extensions: &[&str],
    audio_directories: bool,
    found: &mut Vec<PathBuf>,
) -> Result<()> {
    if !root.exists() {
        return Ok(());
    }
    let mut has_audio = false;
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let path = entry.path();
        if kind.is_dir() {
            if !audio_directories
                || !entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".applio-review-")
            {
                walk(&path, extensions, audio_directories, found)?;
            }
        } else if kind.is_file()
            && path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extensions.contains(&extension.to_lowercase().as_str()))
        {
            if audio_directories {
                has_audio = true;
            } else {
                found.push(path);
            }
        }
    }
    if has_audio {
        found.push(root.into());
    }
    Ok(())
}
async fn datasets(State(state): State<Arc<Training>>) -> Result<Json<Value>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || -> Result<Json<Value>> {
        let mut result = Vec::new();
        for root in ["assets/datasets", "assets/curated-datasets"] {
            let mut found = Vec::new();
            walk(
                &runtime.data.join(root),
                uploads::AUDIO_EXTENSIONS,
                true,
                &mut found,
            )?;
            let mut found: Vec<_> = found
                .iter()
                .map(|path| runtime.repo_relative(path))
                .collect();
            found.sort();
            result.extend(found);
        }
        Ok(Json(json!({"datasets":result})))
    })
    .await
    .map_err(Error::internal)?
    .map_err(Error::internal)
}
async fn pretraineds(State(state): State<Arc<Training>>) -> Result<Json<Value>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || -> Result<Json<Value>> {
        let mut found = Vec::new();
        walk(
            &runtime.data.join("rvc/models/pretraineds/custom"),
            &["pth"],
            false,
            &mut found,
        )?;
        found.sort();
        let g: Vec<_> = found
            .iter()
            .filter(|file| {
                file.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .contains('G')
            })
            .map(|file| runtime.repo_relative(file))
            .collect();
        let d: Vec<_> = found
            .iter()
            .filter(|file| {
                file.file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .contains('D')
            })
            .map(|file| runtime.repo_relative(file))
            .collect();
        Ok(Json(json!({"g":g,"d":d})))
    })
    .await
    .map_err(Error::internal)?
    .map_err(Error::internal)
}
async fn embedders(State(state): State<Arc<Training>>) -> Result<Json<Value>, Error> {
    let directory = state
        .engine
        .runtime
        .data
        .join("rvc/models/embedders/embedders_custom");
    let mut found = Vec::new();
    if directory.is_dir() {
        for entry in std::fs::read_dir(directory).map_err(Error::internal)? {
            let entry = entry.map_err(Error::internal)?;
            if entry.file_type().map_err(Error::internal)?.is_dir() {
                found.push(entry.file_name().to_string_lossy().into_owned());
            }
        }
    }
    found.sort();
    Ok(Json(json!({"embedders":found})))
}
async fn gpus(State(state): State<Arc<Training>>) -> Result<Json<Value>, Error> {
    let mut cache = state.gpu.lock().await;
    if let Some((at, value)) = cache
        .as_ref()
        .filter(|(at, _)| at.elapsed() < Duration::from_secs(300))
    {
        let _ = at;
        return Ok(Json(value.clone()));
    }
    let spec = state
        .engine
        .runtime
        .python_command(["-c", include_str!("training-gpu.py")])?;
    let result = tokio::time::timeout(
        Duration::from_secs(90),
        ManagedProcess::run(&spec, &state.engine.cancellation_token(), |_, _| {}),
    )
    .await
    .map_err(Error::internal)?
    .map_err(Error::internal)?;
    result.ensure_success().map_err(Error::internal)?;
    let value = json_result(&result.stdout).map_err(Error::internal)?;
    *cache = Some((tokio::time::Instant::now(), value.clone()));
    Ok(Json(value))
}
async fn exports(State(state): State<Arc<Training>>) -> Result<Json<Value>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || -> Result<Json<Value>> {
        let mut files = Vec::new();
        walk(&runtime.logs, &["pth", "index"], false, &mut files)?;
        let mut models: Vec<_> = files
            .iter()
            .filter(|file| {
                file.extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("pth"))
            })
            .map(|file| runtime.model_relative(file))
            .collect();
        models.sort();
        let mut indexes: Vec<_> = files
            .iter()
            .filter(|file| {
                file.extension()
                    .is_some_and(|extension| extension.eq_ignore_ascii_case("index"))
                    && !file
                        .file_name()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .contains("trained")
            })
            .map(|file| runtime.model_relative(file))
            .collect();
        indexes.sort();
        Ok(Json(json!({"models":models,"indexes":indexes})))
    })
    .await
    .map_err(Error::internal)?
    .map_err(Error::internal)
}
async fn export_file(
    State(state): State<Arc<Training>>,
    Query(query): Query<HashMap<String, String>>,
    request: Request,
) -> Result<Response, Error> {
    let value = query
        .get("file")
        .filter(|value| !value.is_empty())
        .context("Provide 'file'.")?;
    let path = state.engine.runtime.resolve_user_path(value)?;
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if !["pth", "index"].contains(&extension.as_str()) {
        return Err(Error(
            StatusCode::FORBIDDEN,
            json!({"error":"Only .pth/.index."}),
        ));
    }
    if !path.is_file() {
        return Err(Error(
            StatusCode::NOT_FOUND,
            json!({"error":"File not found."}),
        ));
    }
    let path = tokio::fs::canonicalize(path)
        .await
        .map_err(Error::internal)?;
    let logs = tokio::fs::canonicalize(&state.engine.runtime.logs)
        .await
        .map_err(Error::internal)?;
    if !path.starts_with(logs) {
        return Err(Error(
            StatusCode::FORBIDDEN,
            json!({"error":"Only logs/ files."}),
        ));
    }
    let disposition = uploads::attachment(path.file_name().unwrap_or_default());
    let mut response = ServeFile::new(path)
        .oneshot(request)
        .await
        .unwrap()
        .into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_DISPOSITION, disposition);
    Ok(response)
}
fn clean_name(value: &str) -> Result<String> {
    let name: String = value
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || "._() -".contains(c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    if name.trim().is_empty() || name == "." || name == ".." {
        bail!("A filename or folder name is required");
    }
    Ok(name)
}
pub(crate) async fn safe_directory(root: &Path, name: &str) -> Result<PathBuf> {
    tokio::fs::create_dir_all(root).await?;
    let target = root.join(name);
    tokio::fs::create_dir_all(&target).await?;
    if !tokio::fs::canonicalize(&target)
        .await?
        .starts_with(tokio::fs::canonicalize(root).await?)
    {
        bail!("Folder escapes its storage directory");
    }
    Ok(target)
}
pub(crate) async fn publish(source: &Path, destination: &Path) -> Result<()> {
    match tokio::fs::rename(source, destination).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::CrossesDevices => {
            let temporary = destination
                .parent()
                .context("Upload has no destination folder")?
                .join(format!(".applio-upload-{}.tmp", Uuid::new_v4()));
            let result = async {
                tokio::fs::copy(source, &temporary).await?;
                tokio::fs::rename(&temporary, destination).await?;
                tokio::fs::remove_file(source).await?;
                Ok::<_, anyhow::Error>(())
            }
            .await;
            let _ = tokio::fs::remove_file(temporary).await;
            result
        }
        Err(error) => Err(error.into()),
    }
}
async fn upload_dataset(
    State(state): State<Arc<Training>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(
        request,
        &state.engine.runtime.uploads,
        &[UploadRule {
            name: "files",
            extensions: &[],
            max_bytes: 2 * 1024 * 1024 * 1024,
            max_files: 2000,
        }],
    )
    .await?;
    let name = clean_name(&string(&input.body, "datasetName"))?;
    let directory =
        safe_directory(&state.engine.runtime.data.join("assets/datasets"), &name).await?;
    let files = input.repeated.get("files").map_or(&[][..], Vec::as_slice);
    for file in files {
        publish(
            &file.path,
            &directory.join(clean_name(&file.original_name)?),
        )
        .await
        .map_err(Error::internal)?;
    }
    Ok(Json(
        json!({"ok":true,"dataset":format!("assets/datasets/{name}"),"files":files.len()}),
    ))
}
async fn upload_pretrained(
    State(state): State<Arc<Training>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(
        request,
        &state.engine.runtime.uploads,
        &[UploadRule {
            name: "file",
            extensions: &["pth"],
            max_bytes: 2 * 1024 * 1024 * 1024,
            max_files: 1,
        }],
    )
    .await?;
    let file = input.files.get("file").context("Upload a .pth file.")?;
    let root = state
        .engine
        .runtime
        .data
        .join("rvc/models/pretraineds/custom");
    tokio::fs::create_dir_all(&root)
        .await
        .map_err(Error::internal)?;
    let target = root.join(clean_name(&file.original_name)?);
    publish(&file.path, &target)
        .await
        .map_err(Error::internal)?;
    Ok(Json(
        json!({"ok":true,"file":state.engine.runtime.repo_relative(&target)}),
    ))
}
async fn upload_embedder(
    State(state): State<Arc<Training>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(
        request,
        &state.engine.runtime.uploads,
        &[
            UploadRule {
                name: "bin",
                extensions: &["bin"],
                max_bytes: 2 * 1024 * 1024 * 1024,
                max_files: 1,
            },
            UploadRule {
                name: "config",
                extensions: &["json"],
                max_bytes: 2 * 1024 * 1024 * 1024,
                max_files: 1,
            },
        ],
    )
    .await?;
    let folder = clean_name(&string(&input.body, "folderName"))?;
    let folder = folder
        .rsplit_once('.')
        .map_or(folder.as_str(), |(base, _)| base);
    let folder = clean_name(folder)?;
    let bin = input
        .files
        .get("bin")
        .context("Upload both .bin and .json.")?;
    let config = input
        .files
        .get("config")
        .context("Upload both .bin and .json.")?;
    let directory = safe_directory(
        &state
            .engine
            .runtime
            .data
            .join("rvc/models/embedders/embedders_custom"),
        &folder,
    )
    .await?;
    for file in [bin, config] {
        publish(
            &file.path,
            &directory.join(clean_name(&file.original_name)?),
        )
        .await
        .map_err(Error::internal)?;
    }
    Ok(Json(json!({"ok":true,"folder":folder})))
}
fn model_directory(engine: &NativeEngine, name: &str) -> Result<PathBuf> {
    let mut components = Path::new(name).components();
    if name.contains(['/', '\\'])
        || !matches!(components.next(), Some(Component::Normal(_)))
        || components.next().is_some()
    {
        bail!("Invalid model name");
    }
    let directory = engine.runtime.logs.join(name);
    if directory.exists()
        && (!directory.is_dir()
            || !std::fs::canonicalize(&directory)?
                .starts_with(std::fs::canonicalize(&engine.runtime.logs)?))
    {
        bail!("Invalid model directory");
    }
    Ok(directory)
}
macro_rules! step_handler {
    ($name:ident,$kind:literal) => {
        async fn $name(State(state): State<Arc<Training>>, request: Request) -> Accepted {
            start(state, request, $kind).await
        }
    };
}
step_handler!(preprocess, "preprocess");
step_handler!(extract, "extract");
step_handler!(train, "train");
step_handler!(index, "index");
step_handler!(pipeline, "pipeline");
async fn start(state: Arc<Training>, request: Request, kind: &'static str) -> Accepted {
    let engine = &state.engine;
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    engine.require_ready(true).await.map_err(|error| {
        Error(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error":error.to_string()}),
        )
    })?;
    let saved = params::normalize(kind, &input.body)?;
    let mut selected = saved.clone();
    let name = string(&saved, "modelName");
    model_directory(engine, &name)?;
    if kind == "preprocess" || kind == "pipeline" {
        let dataset = engine
            .runtime
            .resolve_user_path(&string(&saved, "datasetPath"))?;
        if !dataset.is_dir() {
            return Err(Error::input(format!(
                "Dataset directory not found: {}",
                string(&saved, "datasetPath")
            )));
        }
        selected["datasetPath"] = json!(dataset);
    }
    if kind == "train" || kind == "pipeline" {
        let vocoder = string(&saved, "vocoder");
        let allowed = if vocoder == "RefineGAN" {
            &["24000", "32000"][..]
        } else {
            &["32000", "40000", "48000"][..]
        };
        if !allowed.contains(&string(&saved, "sampleRate").as_str()) {
            return Err(Error::input(format!(
                "sampleRate must be one of {} for {vocoder}",
                allowed.join(", ")
            )));
        }
        if saved["customPretrained"] == true
            && (string(&saved, "gPretrainedPath").is_empty()
                || string(&saved, "dPretrainedPath").is_empty())
        {
            return Err(Error::input(
                "gPretrainedPath and dPretrainedPath are required with customPretrained.",
            ));
        }
    }
    let mut saved = saved;
    if kind == "pipeline" {
        saved["pipeline"] = json!(true);
    } else {
        saved["step"] = json!(kind);
    }
    if kind == "index" && selected["indexAlgorithm"] == "Skip" {
        let job = engine
            .jobs
            .create(JobType::Train, saved)
            .map_err(Error::internal)?;
        engine.jobs.running(&job.id);
        engine.jobs.done(
            &job.id,
            json!({"message":"Index generation skipped."}),
            None,
        );
        return Ok(accepted(job));
    }
    let job = engine
        .start_job(
            JobType::Train,
            saved,
            Some(Resource::Gpu),
            move |engine, job, token| run(engine, job, token, selected, kind),
        )
        .await
        .map_err(Error::internal)?;
    Ok(accepted(job))
}
fn progress(engine: &NativeEngine, id: &str, line: &str, total: u64) {
    static EPOCH: OnceLock<Regex> = OnceLock::new();
    static BATCH: OnceLock<Regex> = OnceLock::new();
    let epoch = EPOCH
        .get_or_init(|| Regex::new(r"(?i)epoch[=:]\s*(\d+)").unwrap())
        .captures(line)
        .and_then(|capture| capture[1].parse::<u64>().ok());
    let Some(epoch) = epoch.filter(|epoch| *epoch >= 1) else {
        return;
    };
    let percent = if let Some(batch) = BATCH
        .get_or_init(|| Regex::new(r"(?i)batch\s*=\s*(\d+)\s*/\s*(\d+)").unwrap())
        .captures(line)
    {
        let done = batch[1].parse::<f64>().unwrap_or_default();
        let count = batch[2].parse::<f64>().unwrap_or_default();
        let fraction = if count > 0.0 {
            (done / count).clamp(0.0, 0.999)
        } else {
            0.0
        };
        ((epoch - 1) as f64 + fraction) / total.max(1) as f64 * 100.0
    } else {
        epoch as f64 / total.max(1) as f64 * 100.0
    };
    let percent = percent.round().clamp(0.0, 99.0);
    if engine
        .jobs
        .get(id)
        .and_then(|job| job.progress)
        .is_none_or(|current| percent > current.into())
    {
        engine.jobs.progress(id, percent);
    }
}
async fn step(
    engine: &NativeEngine,
    job: &Job,
    token: &CancellationToken,
    args: Vec<String>,
    expected: &str,
    stage: &str,
    total_epochs: Option<u64>,
) -> Result<String> {
    engine.jobs.stage(&job.id, stage, None, None);
    let spec = engine.runtime.python_command(args)?;
    let result = ManagedProcess::run(&spec, token, |_, line| {
        engine.jobs.log(&job.id, line);
        if let Some(total) = total_epochs {
            progress(engine, &job.id, line, total);
        }
    })
    .await?;
    if (!result.success && result.code != Some(2333333))
        || !expected.is_empty() && !result.stdout.contains(expected)
    {
        let tail = if result.stderr.trim().is_empty() {
            result.stdout.trim()
        } else {
            result.stderr.trim()
        };
        bail!(
            "{stage} failed (exit code {:?}){}{}",
            result.code,
            if tail.is_empty() { "" } else { "\n\n" },
            tail
        );
    }
    Ok(result.stdout)
}
fn ready_file(path: &Path) -> bool {
    path.metadata()
        .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
}
async fn pretrained(
    engine: &NativeEngine,
    job: &Job,
    token: &CancellationToken,
    p: &Value,
) -> Result<[String; 2]> {
    if p["pretrained"] != true {
        return Ok([String::new(), String::new()]);
    }
    let vocoder = string(p, "vocoder");
    let rate = string(p, "sampleRate");
    let paths = if p["customPretrained"] == true {
        [
            engine
                .runtime
                .resolve_user_path(&string(p, "gPretrainedPath"))?,
            engine
                .runtime
                .resolve_user_path(&string(p, "dPretrainedPath"))?,
        ]
    } else {
        let rates = match vocoder.as_str() {
            "HiFi-GAN" => &["32000", "40000", "48000"][..],
            "RefineGAN" => &["24000", "32000"][..],
            _ => &[][..],
        };
        if !rates.contains(&rate.as_str()) {
            bail!("Unsupported pretrained: {vocoder} at {rate} Hz");
        }
        let root = engine
            .runtime
            .data
            .join("rvc/models/pretraineds")
            .join(vocoder.to_lowercase());
        let tag = rate.parse::<u32>()? / 1000;
        let paths = [
            root.join(format!("f0G{tag}k.pth")),
            root.join(format!("f0D{tag}k.pth")),
        ];
        if !paths.iter().all(|path| ready_file(path)) {
            engine.jobs.log(
                &job.id,
                &format!("Downloading default {vocoder} pretrains ({rate} Hz) before training..."),
            );
            step(
                engine,
                job,
                token,
                vec![
                    "rvc/lib/tools/prerequisites_download.py".into(),
                    "--vocoder".into(),
                    vocoder.clone(),
                    "--sample-rate".into(),
                    rate.clone(),
                ],
                "Prerequisites installed successfully.",
                "Downloading models…",
                None,
            )
            .await?;
        }
        paths
    };
    if !paths.iter().all(|path| ready_file(path)) {
        if p["customPretrained"] == true {
            bail!("Custom pretrained G and D files must exist and be non-empty.");
        }
        bail!("Default {vocoder} pretrains ({rate} Hz) are missing. Training cannot start without them.");
    }
    engine.jobs.log(
        &job.id,
        &format!("Using pretrained G: {}", paths[0].display()),
    );
    engine.jobs.log(
        &job.id,
        &format!("Using pretrained D: {}", paths[1].display()),
    );
    Ok(paths.map(|path| path_string(&path)))
}
async fn run(
    engine: Arc<NativeEngine>,
    job: Job,
    token: CancellationToken,
    p: Value,
    kind: &str,
) -> Result<JobResult> {
    let name = string(&p, "modelName");
    let directory = model_directory(&engine, &name)?;
    let pipeline = kind == "pipeline";
    let pretrains = if kind == "train" || pipeline {
        pretrained(&engine, &job, &token, &p).await?
    } else {
        [String::new(), String::new()]
    };
    let mut message = String::new();
    if kind == "preprocess" || pipeline {
        if pipeline {
            engine
                .jobs
                .log(&job.id, ">>> [1/4] Preprocessing Dataset...");
        }
        let expected = format!("Model {name} preprocessed successfully.");
        let stdout = step(
            &engine,
            &job,
            &token,
            params::preprocess(&p, &engine.runtime.logs),
            &expected,
            "Preprocessing dataset…",
            None,
        )
        .await?;
        message = stdout.trim().lines().last().unwrap_or("Done").trim().into();
    }
    if kind == "extract" || pipeline {
        if pipeline {
            engine.jobs.log(&job.id, ">>> [2/4] Extracting Features...");
        }
        let expected = format!("Model {name} extracted successfully.");
        let stdout = step(
            &engine,
            &job,
            &token,
            params::extract(&p, &engine.runtime.logs),
            &expected,
            "Extracting features…",
            None,
        )
        .await?;
        message = stdout.trim().lines().last().unwrap_or("Done").trim().into();
    }
    let mut output = None;
    if kind == "train" || pipeline {
        if pipeline {
            engine.jobs.log(
                &job.id,
                &format!(
                    ">>> [3/4] Training Model ({} epochs, batch size {})...",
                    p["totalEpoch"], p["batchSize"]
                ),
            );
        }
        let before = artifacts::snapshot(&directory)?;
        let epochs = p["totalEpoch"]
            .as_u64()
            .context("Invalid training epoch count")?;
        step(
            &engine,
            &job,
            &token,
            params::train(&p, &pretrains),
            &format!("Model {name} trained successfully."),
            "Training model…",
            Some(epochs),
        )
        .await?;
        engine.jobs.progress(&job.id, 100.0);
        output = Some(
            engine
                .runtime
                .model_relative(&artifacts::trained(&directory, &name, &before, epochs)?),
        );
        message = format!(
            "Model {name} trained successfully{}",
            if pipeline { "!" } else { "." }
        );
    }
    if kind == "index" || (kind == "train" || pipeline) && p["indexAlgorithm"] != "Skip" {
        if kind == "train" || pipeline {
            engine.jobs.log(
                &job.id,
                &format!(
                    ">>> {}Generating Index ({})...",
                    if pipeline { "[4/4] " } else { "" },
                    string(&p, "indexAlgorithm")
                ),
            );
        }
        step(
            &engine,
            &job,
            &token,
            params::index(&p, &engine.runtime.logs),
            "",
            "Generating index…",
            None,
        )
        .await?;
        let file = artifacts::index(&directory, &name)?;
        engine
            .jobs
            .log(&job.id, &format!("Index ready: {}", file.display()));
        if kind == "index" {
            message = format!("Index file for {name} is ready.");
            output = Some(engine.runtime.model_relative(&file));
        }
    }
    if token.is_cancelled() {
        bail!("Stopped by user");
    }
    engine.jobs.stage(&job.id, "Checking output…", None, None);
    if pipeline {
        engine.jobs.log(&job.id, ">>> [4/4] Verifying artifacts...");
    }
    Ok(JobResult::new(json!({"message":message}), output))
}
async fn stop(State(state): State<Arc<Training>>, request: Request) -> Result<Json<Value>, Error> {
    let input = uploads::parse(request, &state.engine.runtime.uploads, &[]).await?;
    let id = string(&input.body, "jobId");
    let model = string(&input.body, "modelName");
    if id.is_empty() && model.is_empty() {
        return Err(Error(
            StatusCode::NOT_FOUND,
            json!({"error":"No running job found (provide jobId or modelName)."}),
        ));
    }
    let mut stopped = 0;
    for job in state
        .engine
        .jobs
        .list()
        .into_iter()
        .filter(|job| job.kind == JobType::Train && job.active())
    {
        if (!id.is_empty() && job.id == id)
            || (id.is_empty()
                && job
                    .params
                    .as_ref()
                    .is_some_and(|params| params["modelName"] == model))
        {
            state.engine.jobs.log(&job.id, "Stopped by user.");
            stopped += usize::from(state.engine.jobs.cancel(&job.id, "Stopped by user"));
        }
    }
    // Native jobs own their process trees; stale, unowned PIDs from old config
    // files must never be used to terminate another application's process.
    Ok(Json(if !id.is_empty() {
        json!({"ok":true,"stopped":id})
    } else {
        json!({"ok":true,"killed":stopped})
    }))
}
