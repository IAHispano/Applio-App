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
        .route("/api/train/text-rvc", post(text_rvc))
        .route(
            "/api/tts/frontends",
            get(text_frontends).post(import_text_frontend),
        )
        .layer(DefaultBodyLimit::disable())
        .with_state(Arc::new(Training {
            engine,
            gpu: tokio::sync::Mutex::new(None),
        }))
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct TextRvcTraining {
    #[serde(default)]
    manifest: String,
    #[serde(default)]
    dataset_root: String,
    #[serde(default)]
    pth_path: String,
    #[serde(default = "text_rvc_language")]
    language: String,
    #[serde(default = "text_rvc_speaker")]
    speaker: String,
    output: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    initialize_from: Option<String>,
    #[serde(default)]
    reset_tokenizer: bool,
    #[serde(default)]
    phonetic_loss: bool,
    steps: u32,
    batch_size: u32,
    hidden: u32,
    layers: u32,
    device: String,
}
fn text_rvc_speaker() -> String {
    "p225".into()
}
fn text_rvc_language() -> String {
    "en".into()
}
impl TextRvcTraining {
    fn validate(&self) -> Result<()> {
        params::normalize("textRvc", &serde_json::to_value(self)?)?;
        if !(1..=100_000).contains(&self.steps)
            || !(1..=32).contains(&self.batch_size)
            || !(16..=512).contains(&self.hidden)
            || self.hidden % 4 != 0
            || !(1..=8).contains(&self.layers)
            || !matches!(self.device.as_str(), "cpu" | "cuda" | "mps")
            || (self.manifest.trim().is_empty() == self.dataset_root.trim().is_empty())
            || !Regex::new(r"^p\d{3}$").unwrap().is_match(&self.speaker)
            || self.output.trim().is_empty()
            || self.reset_tokenizer && self.initialize_from.is_none()
        {
            bail!("Invalid text-to-RVC training parameters");
        }
        Ok(())
    }
}
async fn text_rvc(
    State(state): State<Arc<Training>>,
    Json(request): Json<TextRvcTraining>,
) -> Accepted {
    request.validate()?;
    let runtime = &state.engine.runtime;
    let prepared = !request.manifest.is_empty();
    let source = runtime.resolve_user_path(if prepared {
        &request.manifest
    } else {
        &request.dataset_root
    })?;
    let requested_output = Path::new(&request.output);
    let output = if requested_output.is_absolute() {
        let parent = requested_output
            .parent()
            .context("Output directory needs a parent")?;
        let name = requested_output
            .file_name()
            .context("Output directory needs a name")?;
        let parent = runtime.resolve_user_path(&path_string(parent))?;
        if !parent.is_dir() {
            return Err(Error::input("Output parent must be a directory"));
        }
        parent.join(name)
    } else {
        runtime.resolve_user_path(&request.output)?
    };
    if (prepared && !source.is_file()) || (!prepared && !source.is_dir()) || output.exists() {
        return Err(Error::input(
            "Provide a speech dataset or prepared manifest and a new training output directory",
        ));
    }
    let mut args = vec![
        "-m".to_owned(),
        "backend.python.text_rvc".into(),
        "--device".into(),
        request.device.clone(),
        if prepared {
            "train".into()
        } else {
            "fit".into()
        },
        if prepared {
            "--manifest".into()
        } else {
            "--vctk-root".into()
        },
        path_string(&source),
        "--output".into(),
        path_string(&output),
    ];
    let resolved_manifest = path_string(&source);
    if !prepared {
        args.extend([
            "--speaker".into(),
            request.speaker.clone(),
            "--language".into(),
            request.language.clone(),
            "--embedder".into(),
            path_string(&runtime.data.join("rvc/models/embedders/contentvec")),
            "--rmvpe".into(),
            path_string(&runtime.data.join("rvc/models/predictors/rmvpe.pt")),
            "--recognizer".into(),
            path_string(&runtime.data.join("rvc/models/aligners/phonemes")),
        ]);
        if !request.pth_path.is_empty() {
            args.extend([
                "--rvc".into(),
                path_string(&runtime.require_file(&request.pth_path)?),
            ]);
        }
    }
    for (flag, value) in [
        ("--steps", request.steps),
        ("--batch-size", request.batch_size),
        ("--hidden", request.hidden),
        ("--layers", request.layers),
    ] {
        args.extend([flag.into(), value.to_string()]);
    }
    if let Some(source) = &request.initialize_from {
        let source = runtime.resolve_user_path(source)?;
        if !source.is_file() {
            return Err(Error::input("Initialization checkpoint not found"));
        }
        args.extend(["--initialize-from".into(), path_string(&source)]);
    }
    if request.reset_tokenizer {
        args.push("--reset-tokenizer".into());
    }
    if request.phonetic_loss {
        args.push("--phonetic-loss".into());
    }
    // Training unloads the resident worker even on CPU, so admission must remain
    // exclusive with inference and realtime just like ordinary RVC training.
    let resource = Some(Resource::Gpu);
    let saved = json!({"step":"text-rvc", "modelName":output.file_name().map(|name|name.to_string_lossy()), "training":request});
    let job = state
        .engine
        .start_job(
            JobType::Train,
            saved,
            resource,
            move |engine, job, token| async move {
                let mut spec = engine.runtime.python_command(args)?;
                if resource.is_some() {
                    spec.env
                        .insert("APPLIO_TEXT_RVC_GPU_LEASE".into(), job.id.clone().into());
                }
                let result = ManagedProcess::run(&spec, &token, |_, line| {
                    text_training_log(&engine, &job.id, line, request.steps.into(), "Training");
                })
                .await?;
                result.ensure_success()?;
                let best = output.join(if prepared {
                    "best.pt"
                } else {
                    "training/best.pt"
                });
                if !ready_file(&best) {
                    bail!("Training exited without a frontend checkpoint");
                }
                if prepared {
                    let spec = engine.runtime.python_command([
                        "-m".to_owned(),
                        "backend.python.text_rvc".into(),
                        "calibrate".into(),
                        "--frontend".into(),
                        path_string(&best),
                        "--manifest".into(),
                        resolved_manifest.clone(),
                        "--output".into(),
                        path_string(&output.join("frontend.pt")),
                    ])?;
                    ManagedProcess::run(&spec, &token, |_, line| engine.jobs.log(&job.id, line))
                        .await?
                        .ensure_success()?;
                }
                let frontend = output.join("frontend.pt");
                if !ready_file(&frontend) {
                    bail!("Training did not export a calibrated frontend");
                }
                let frontend = if frontend.starts_with(&engine.runtime.logs) {
                    engine.runtime.model_relative(&frontend)
                } else {
                    path_string(&frontend)
                };
                Ok(JobResult::new(
                    json!({"frontend":frontend,"pthPath":request.pth_path}),
                    None,
                ))
            },
        )
        .await
        .map_err(Error::internal)?;
    Ok(accepted(job))
}
async fn text_frontends(State(state): State<Arc<Training>>) -> Result<Json<Value>, Error> {
    let runtime = state.engine.runtime.clone();
    tokio::task::spawn_blocking(move || -> Result<Json<Value>> {
        let mut found = Vec::new();
        walk(&runtime.logs.join("tts"), &["pt"], false, &mut found)?;
        let mut frontends: Vec<_> = found
            .into_iter()
            .filter(|path| path.file_name().is_some_and(|name| name == "frontend.pt"))
            .map(|path| runtime.model_relative(&path))
            .collect();
        frontends.sort();
        Ok(Json(json!({"frontends":frontends})))
    })
    .await
    .map_err(Error::internal)?
    .map_err(Error::internal)
}
async fn import_text_frontend(
    State(state): State<Arc<Training>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(
        request,
        &state.engine.runtime.uploads,
        &[UploadRule {
            name: "file",
            extensions: &["pt"],
            max_bytes: 256 * 1024 * 1024,
            max_files: 1,
        }],
    )
    .await?;
    let file = input.files.get("file").context("Upload failed.")?;
    let name = clean_name(&file.original_name)?;
    let stem = Path::new(&name)
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy();
    // Every import has its own directory; importing a similarly named model cannot overwrite it.
    let folder = format!(
        "{}-{}",
        stem.chars().take(60).collect::<String>(),
        Uuid::new_v4()
    );
    let directory = safe_directory(&state.engine.runtime.logs.join("tts"), &folder).await?;
    let target = directory.join("frontend.pt");
    if let Err(error) = publish(&file.path, &target).await {
        let _ = tokio::fs::remove_dir(&directory).await;
        return Err(Error::internal(error));
    }
    Ok(Json(
        json!({"ok":true,"frontend":state.engine.runtime.model_relative(&target)}),
    ))
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
        .python_command(["-c", include_str!("../training/training-gpu.py")])?;
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
    if !["pth", "index"].contains(&extension.as_str())
        && !(extension == "pt" && path.file_name().is_some_and(|name| name == "frontend.pt"))
    {
        return Err(Error(
            StatusCode::FORBIDDEN,
            json!({"error":"Invalid params"}),
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
    if saved["enableTts"] == true {
        let source = if string(&saved, "ttsDatasetPath").is_empty() {
            string(&saved, "datasetPath")
        } else {
            string(&saved, "ttsDatasetPath")
        };
        let source = engine.runtime.resolve_user_path(&source)?;
        if !source.is_dir() {
            return Err(Error::input(
                "Provide the transcribed speech dataset for TTS",
            ));
        }
        selected["ttsDatasetPath"] = json!(source);
        let initial = string(&saved, "ttsInitializeFrom");
        if !initial.is_empty() {
            selected["ttsInitializeFrom"] = json!(engine.runtime.require_file(&initial)?);
        }
        if kind == "pipeline" && saved["embedderModel"] != "contentvec" {
            return Err(Error::input("TTS requires the ContentVec embedder"));
        }
    }
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
fn text_training_progress(line: &str, total: u64) -> Option<(u64, f64)> {
    let value = serde_json::from_str::<Value>(line).ok()?;
    let step = value["step"].as_u64()?;
    if total == 0 {
        return None;
    }
    Some((
        step.min(total),
        (step as f64 / total as f64 * 100.0).min(99.0),
    ))
}
fn text_training_log(engine: &NativeEngine, id: &str, line: &str, total: u64, stage: &str) {
    engine.jobs.log(id, line);
    if let Some((step, percent)) = text_training_progress(line, total) {
        engine.jobs.stage(id, stage, Some(step), Some(total));
        engine.jobs.progress(id, percent);
    }
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
    if p["enableTts"] == true && (kind == "train" || pipeline) {
        engine.jobs.stage(&job.id, "Preparing…", None, None);
        let mut args = vec![
            "-m".to_owned(),
            "backend.python.text_rvc".into(),
            "validate-data".into(),
            "--dataset".into(),
            string(&p, "ttsDatasetPath"),
            "--language".into(),
            string(&p, "ttsLanguage"),
        ];
        let initial = string(&p, "ttsInitializeFrom");
        if !initial.is_empty() {
            args.extend(["--initialize-from".into(), initial]);
        }
        let spec = engine.runtime.python_command(args)?;
        ManagedProcess::run(&spec, &token, |_, line| engine.jobs.log(&job.id, line))
            .await?
            .ensure_success()?;
    }
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
    let mut result = json!({"message":message});
    if p["enableTts"] == true && (kind == "train" || pipeline) {
        let voice = engine
            .runtime
            .require_file(output.as_deref().context("RVC model was not exported")?)?;
        let target = engine.runtime.logs.join("tts").join(&name).join(&job.id);
        engine.jobs.stage(&job.id, "Applio TTS", None, None);
        // The new phase has its own step count; RVC completion is not TTS completion.
        engine.jobs.progress(&job.id, 0.0);
        let mut args = vec![
            "-m".into(),
            "backend.python.text_rvc".into(),
            "--device".into(),
            if string(&p, "gpu") == "-" {
                "cpu".into()
            } else {
                "auto".into()
            },
            "fit".into(),
            "--vctk-root".into(),
            string(&p, "ttsDatasetPath"),
            "--language".into(),
            string(&p, "ttsLanguage"),
            "--rvc".into(),
            path_string(&voice),
            "--output".into(),
            path_string(&target),
            "--embedder".into(),
            path_string(&engine.runtime.data.join("rvc/models/embedders/contentvec")),
            "--rmvpe".into(),
            path_string(&engine.runtime.data.join("rvc/models/predictors/rmvpe.pt")),
            "--recognizer".into(),
            path_string(&engine.runtime.data.join("rvc/models/aligners/phonemes")),
            "--steps".into(),
            p["ttsSteps"].to_string(),
            "--batch-size".into(),
            "4".into(),
            "--hidden".into(),
            "256".into(),
            "--layers".into(),
            "4".into(),
            "--phonetic-loss".into(),
        ];
        let initial = string(&p, "ttsInitializeFrom");
        if !initial.is_empty() {
            args.extend(["--initialize-from".into(), initial]);
        }
        let mut spec = engine.runtime.python_command(args)?;
        spec.env
            .insert("APPLIO_TEXT_RVC_GPU_LEASE".into(), job.id.clone().into());
        ManagedProcess::run(&spec, &token, |_, line| {
            text_training_log(
                &engine,
                &job.id,
                line,
                p["ttsSteps"].as_u64().unwrap(),
                "Applio TTS",
            )
        })
        .await?
        .ensure_success()?;
        let frontend = target.join("frontend.pt");
        if !ready_file(&frontend) {
            bail!("TTS training did not export a text frontend");
        }
        result["frontend"] = json!(engine.runtime.model_relative(&frontend));
        result["pthPath"] = json!(output);
    }
    engine.jobs.stage(&job.id, "Checking output…", None, None);
    if pipeline {
        engine.jobs.log(&job.id, ">>> [4/4] Verifying artifacts...");
    }
    Ok(JobResult::new(result, output))
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

#[cfg(test)]
mod text_rvc_tests {
    use super::*;

    #[tokio::test]
    async fn tts_model_import_and_export_preserve_storage_and_bridge_boundaries() {
        use axum::body::{to_bytes, Body};
        let root = tempfile::tempdir().unwrap();
        let assets = root.path().join("assets");
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::write(assets.join("config_template.json"), "{}").unwrap();
        let backend_config = root.path().join("backend/applio/rvc/configs/config.py");
        std::fs::create_dir_all(backend_config.parent().unwrap()).unwrap();
        std::fs::write(backend_config, "").unwrap();
        let config = crate::ApiConfig {
            code_root: root.path().into(),
            data_root: root.path().join("data"),
            config_dir: root.path().join("config"),
        };
        let runtime =
            crate::engine_runtime::EngineRuntime::with_python(&config, Some("python".into()))
                .unwrap();
        let engine = NativeEngine::open(
            runtime.clone(),
            Arc::new(crate::engine::RuntimeReadiness::new(runtime, false)),
        )
        .unwrap();
        let app = router(engine.clone());
        let multipart = |name: &str| {
            format!("--tts-boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/octet-stream\r\n\r\ncheckpoint-bytes\r\n--tts-boundary--\r\n")
        };
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tts/frontends")
                    .header(
                        header::CONTENT_TYPE,
                        "multipart/form-data; boundary=tts-boundary",
                    )
                    .body(Body::from(multipart("voice.pt")))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(response.status().is_success());
        let imported: Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024).await.unwrap()).unwrap();
        let frontend = imported["frontend"].as_str().unwrap();
        assert!(frontend.starts_with("logs/tts/") && frontend.ends_with("/frontend.pt"));
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(format!("/api/train/export-file?file={frontend}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(response.status().is_success());
        assert!(response.headers().contains_key(header::CONTENT_DISPOSITION));
        assert_eq!(
            &to_bytes(response.into_body(), 1024).await.unwrap()[..],
            b"checkpoint-bytes"
        );
        std::fs::write(
            engine.runtime.logs.join("best.pt"),
            b"private training state",
        )
        .unwrap();
        let outside = engine.runtime.data.join("assets/frontend.pt");
        std::fs::create_dir_all(outside.parent().unwrap()).unwrap();
        std::fs::write(outside, b"outside model storage").unwrap();
        for file in ["logs/best.pt", "assets/frontend.pt"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(format!("/api/train/export-file?file={file}"))
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::FORBIDDEN);
        }
        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/tts/frontends")
                    .header(
                        header::CONTENT_TYPE,
                        "multipart/form-data; boundary=tts-boundary",
                    )
                    .body(Body::from(multipart("voice.pth")))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(!response.status().is_success());
        assert!(!crate::bridge_policy::api_allowed(
            "POST",
            "/api/tts/frontends"
        ));
        assert!(!crate::bridge_policy::api_allowed(
            "GET",
            "/api/train/export-file"
        ));
        engine.shutdown().await.unwrap();
    }

    #[test]
    fn tts_steps_report_their_own_progress_before_export_completes() {
        assert_eq!(
            text_training_progress(r#"{"step":100}"#, 4000),
            Some((100, 2.5))
        );
        assert_eq!(
            text_training_progress(r#"{"step":4000}"#, 4000),
            Some((4000, 99.0))
        );
        assert_eq!(
            text_training_progress(r#"{"step":5000}"#, 4000),
            Some((4000, 99.0))
        );
        assert!(text_training_progress("Aligned recording", 4000).is_none());
        assert!(text_training_progress(r#"{"step":-1}"#, 4000).is_none());
        assert!(text_training_progress(r#"{"step":1}"#, 0).is_none());
    }

    #[test]
    fn text_frontend_training_is_bounded_and_host_only() {
        let valid = json!({"manifest":"prepared/phonemes.json","output":"new-run","steps":1000,"batchSize":8,"hidden":128,"layers":2,"device":"cuda"});
        serde_json::from_value::<TextRvcTraining>(valid.clone())
            .unwrap()
            .validate()
            .unwrap();
        for (key, value) in [
            ("steps", json!(0)),
            ("batchSize", json!(33)),
            ("hidden", json!(127)),
            ("layers", json!(9)),
            ("device", json!("cuda; arbitrary command")),
            ("resetTokenizer", json!(true)),
        ] {
            let mut invalid = valid.clone();
            invalid[key] = value;
            assert!(serde_json::from_value::<TextRvcTraining>(invalid)
                .unwrap()
                .validate()
                .is_err());
        }
        let mut unknown = valid;
        unknown["command"] = json!("arbitrary command");
        assert!(serde_json::from_value::<TextRvcTraining>(unknown).is_err());
        assert!(!crate::bridge_policy::api_allowed(
            "POST",
            "/api/train/text-rvc"
        ));
        for kind in ["train", "pipeline"] {
            let input = json!({"modelName":"voice", "datasetPath":"speech", "enableTts":true, "ttsSteps":2000, "ttsInitializeFrom":"logs/tts/base/frontend.pt"});
            let normalized = params::normalize(kind, &input).unwrap();
            assert_eq!(normalized["enableTts"], true);
            assert_eq!(normalized["ttsSteps"], 2000);
            assert_eq!(normalized["ttsInitializeFrom"], "logs/tts/base/frontend.pt");
            let mut invalid = input;
            invalid["ttsSteps"] = json!(0);
            assert!(params::normalize(kind, &invalid).is_err());
        }
    }
}
