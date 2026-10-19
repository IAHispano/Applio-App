//! Stem separation and its live Python model catalog, coordinated by Rust.
use crate::{
    engine::{JobResult, NativeEngine},
    infer_params::{ParameterSchema, ValidationErrors},
    jobs::{Job, JobType},
    metadata_cache::MetadataCache,
    process::{json_result, ManagedProcess},
    processing_routes::{accepted, path_string, ready, string, Accepted, Error},
    scheduler::Resource,
    uploads,
};
use anyhow::{bail, Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    routing::{get, post},
    Json, Router,
};
use regex::Regex;
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{Arc, OnceLock},
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;
struct Uvr {
    engine: Arc<NativeEngine>,
    catalog: MetadataCache,
}
pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/uvr/models", get(models))
        .route("/api/uvr/variants", get(variants))
        .route("/api/uvr/custom-models", post(custom_models))
        .route("/api/uvr/separate", post(separate))
        .layer(DefaultBodyLimit::disable())
        .with_state(Arc::new(Uvr {
            engine,
            catalog: MetadataCache::default(),
        }))
}
fn schema() -> &'static ParameterSchema {
    static SCHEMA: OnceLock<ParameterSchema> = OnceLock::new();
    SCHEMA.get_or_init(|| ParameterSchema::from_json(include_str!("uvr-schema.json")))
}
pub(crate) fn normalize(input: &Value) -> Result<Value, ValidationErrors> {
    schema().normalize(input)
}
fn title(value: &str) -> String {
    let mut chars = value.chars();
    match chars.next() {
        Some(first) => first.to_uppercase().collect::<String>() + chars.as_str(),
        None => String::new(),
    }
}
fn with_download_status(data_root: &Path, catalog: Value) -> Value {
    let uvr_root = data_root.join("rvc/models/uvr");
    let mut list = catalog["models"].as_array().cloned().unwrap_or_default();
    for model in &mut list {
        let key = model["key"].as_str().unwrap_or_default();
        let files: Vec<&str> = model["files"]
            .as_array()
            .map(|items| items.iter().filter_map(Value::as_str).collect())
            .unwrap_or_default();
        let downloaded = !key.is_empty()
            && !files.is_empty()
            && files.iter().all(|name| {
                std::fs::metadata(uvr_root.join(key).join(name))
                    .is_ok_and(|meta| meta.is_file() && meta.len() > 0)
            });
        if let Some(obj) = model.as_object_mut() {
            obj.remove("key");
            obj.remove("files");
            obj.insert("downloaded".into(), Value::Bool(downloaded));
        }
    }
    list.sort_by_key(|model| !model["downloaded"].as_bool().unwrap_or(false));
    json!({ "models": list })
}
async fn models(State(state): State<Arc<Uvr>>) -> Result<Json<Value>, Error> {
    let engine = &state.engine;
    let path = engine.runtime.code.join("uvr/models.py");
    // User models live in data ("rvc/models/uvr/custom_models.json"); a change
    // there must refresh the cached catalog without an app restart.
    let custom = engine
        .runtime
        .data
        .join("rvc/models/uvr/custom_models.json");
    let (models,_)=state.catalog.get_with_stamps(&path,Some(&custom),||async {
        let spec=engine.runtime.python_command(["uvr/separate.py","--list-models"])?;
        let result=ManagedProcess::run(&spec,&engine.cancellation_token(),|_,_|{}).await?;
        result.ensure_success()?;
        let catalog=json_result(&result.stdout)?;
        let models=catalog["models"].as_array().context("Model catalog returned no data.")?;
        let models:Result<Vec<_>>=models.iter().map(|model|{
            let stems=model["stems"].as_array().context("Invalid model catalog stems")?;
            let stems:Result<Vec<_>>=stems.iter().map(|stem|stem.as_str().map(title).context("Invalid stem label")).collect();
            Ok(json!({"key":model["key"],"files":model["files"],"filename":model["filename"],"name":model["label"],"type":model["arch"].as_str().unwrap_or_default().to_uppercase(),"stems":stems?,"target_stem":model["target"].as_str().map(title)}))
        }).collect();
        Ok(json!({"models":models?}))
    }).await.map_err(Error::internal)?;
    let data_root = engine.runtime.data.clone();
    let catalog = tokio::task::spawn_blocking(move || with_download_status(&data_root, models))
        .await
        .map_err(Error::internal)?;
    Ok(Json(catalog))
}
pub(crate) fn cli_args(params: &Value, input: &Path, output: &Path) -> Vec<String> {
    let mut args = vec![
        "uvr/separate.py".into(),
        "--input-path".into(),
        path_string(input),
        "--model".into(),
        string(params, "model"),
        "--output-dir".into(),
        path_string(output),
        "--output-format".into(),
        string(params, "outputFormat").to_lowercase(),
        "--single-stem".into(),
        string(params, "singleStem"),
    ];
    // Explicit order keeps the legacy CLI contract reviewable and testable.
    for key in [
        "vrAggression",
        "vrWindow",
        "vrBatch",
        "vrTta",
        "vrHighEnd",
        "vrPostProcess",
        "vrPostThreshold",
        "mdxSegment",
        "mdxOverlap",
        "mdxBatch",
        "mdxHop",
        "mdxDenoise",
        "mdxcSegment",
        "mdxcOverlap",
        "mdxcBatch",
        "mdxcOverrideSegment",
        "mdxcPitchShift",
        "demucsSegment",
        "demucsShifts",
        "demucsOverlap",
        "demucsSplit",
        "roformerChunk",
        "roformerOverlap",
        "roformerBatch",
        "roformerDenoise",
        "device",
    ] {
        if key == "demucsSplit" {
            if params[key] == false {
                args.push("--demucs-no-split".into());
            }
            continue;
        }
        let Some(value) = params.get(key) else {
            continue;
        };
        let mut flag = String::from("--");
        for c in key.chars() {
            if c.is_ascii_uppercase() {
                flag.push('-');
                flag.push(c.to_ascii_lowercase());
            } else {
                flag.push(c);
            }
        }
        if let Value::Bool(value) = value {
            if *value {
                args.push(flag);
            }
            continue;
        }
        args.push(flag);
        args.push(
            value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string()),
        );
    }
    args
}
async fn run_step(
    engine: &NativeEngine,
    job: &Job,
    token: &CancellationToken,
    args: Vec<String>,
) -> Result<String> {
    static PROGRESS: OnceLock<Regex> = OnceLock::new();
    let progress = PROGRESS.get_or_init(|| Regex::new(r"(\d{1,3})%\s*\|").unwrap());
    let spec = engine.runtime.python_command(args)?;
    let result = ManagedProcess::run(&spec, token, |_, line| {
        if let Some(stage) = separation_stage(line) {
            engine.jobs.stage(&job.id, stage, None, None);
            return;
        }
        let trimmed: String = line.trim().chars().take(1000).collect();
        if !trimmed.is_empty() {
            engine.jobs.log(&job.id, &trimmed);
        }
        if let Some(percent) = progress
            .captures_iter(line)
            .last()
            .and_then(|capture| capture[1].parse::<u8>().ok())
        {
            if engine
                .jobs
                .get(&job.id)
                .and_then(|job| job.progress)
                .is_none_or(|current| percent > current)
            {
                engine.jobs.progress(&job.id, percent.min(99).into());
            }
        }
    })
    .await?;
    result.ensure_success()?;
    Ok(result.stdout)
}
fn separation_stage(line: &str) -> Option<&str> {
    match line.trim().strip_prefix("APPLIO_STAGE:")? {
        stage @ ("Downloading models…" | "Loading models…" | "Separating…") => Some(stage),
        _ => None,
    }
}

fn encode_segment(value: &str) -> String {
    let mut result = String::new();
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte) {
            result.push(byte as char);
        } else {
            result.push_str(&format!("%{byte:02X}"));
        }
    }
    result
}
async fn separate(State(state): State<Arc<Uvr>>, request: Request) -> Accepted {
    let engine = &state.engine;
    let mut input =
        uploads::parse(request, &engine.runtime.uploads, &uploads::audio_rule()).await?;
    ready(engine).await?;
    let params = normalize(&input.body)?;
    let audio = if let Some(file) = input.file("audio") {
        file.into()
    } else {
        engine
            .runtime
            .require_file(&string(&input.body, "inputPath"))?
    };
    let mut saved = params.clone();
    saved["inputPath"] = json!(audio);
    let job = engine
        .start_job(JobType::Other, saved, None, move |engine, job, token| {
            run_separation(engine, job, token, params, audio)
        })
        .await
        .map_err(Error::internal)?;
    input.retain();
    Ok(accepted(job))
}

const WEIGHT_EXTENSIONS: &[&str] = &["pth", "onnx", "ckpt", "th", "pt"];
const CONFIG_EXTENSIONS: &[&str] = &["yaml", "yml"];

fn model_rules() -> Vec<uploads::UploadRule> {
    vec![
        uploads::UploadRule {
            name: "weightFile",
            extensions: WEIGHT_EXTENSIONS,
            max_bytes: 1024 * 1024 * 1024,
            max_files: 1,
        },
        uploads::UploadRule {
            name: "configFile",
            extensions: CONFIG_EXTENSIONS,
            max_bytes: 20 * 1024 * 1024,
            max_files: 1,
        },
    ]
}

fn simple_filename(name: &str, slot: &str, allowed: &[&str]) -> Result<String> {
    let base = Path::new(name)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    let valid = !base.is_empty()
        && base.len() <= 128
        && base
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '(' | ')'))
        && base
            .rsplit('.')
            .next()
            .is_some_and(|ext| allowed.contains(&ext.to_ascii_lowercase().as_str()));
    if !valid {
        bail!("{slot} needs a simple file name ending in one of: .{allowed:?}");
    }
    Ok(base.to_owned())
}

fn slug(name: &str) -> String {
    let mut out = String::new();
    let mut dash = false;
    for c in name.chars() {
        if c.is_ascii_alphanumeric() {
            out.push(c.to_ascii_lowercase());
            dash = false;
        } else if !out.is_empty() && !dash {
            out.push('-');
            dash = true;
        }
    }
    out.trim_matches('-').chars().take(64).collect()
}

async fn upsert_custom_entry(data_root: &Path, entry: Value) -> Result<()> {
    let path = data_root.join("rvc/models/uvr/custom_models.json");
    let parent = path.parent().context("custom models path has no parent")?;
    tokio::fs::create_dir_all(parent).await?;
    let bytes = match tokio::fs::read(&path).await {
        Ok(bytes) => bytes,
        Err(_) => Vec::new(),
    };
    // An empty file (e.g. created manually or truncated elsewhere) starts fresh.
    let mut entries: Vec<Value> = if bytes.iter().all(|byte| byte.is_ascii_whitespace()) {
        Vec::new()
    } else {
        serde_json::from_slice(&bytes)
            .map_err(|error| anyhow::anyhow!("custom_models.json is invalid: {error}"))?
    };
    if let Some(object) = entries.iter_mut().find(|e| e["key"] == entry["key"]) {
        *object = entry;
    } else {
        entries.push(entry);
    }
    let tmp = path.with_extension("json.tmp");
    tokio::fs::write(&tmp, serde_json::to_vec_pretty(&entries)?).await?;
    tokio::fs::rename(&tmp, &path).await?;
    Ok(())
}

async fn variants(State(state): State<Arc<Uvr>>) -> Result<Json<Value>, Error> {
    let engine = &state.engine;
    let spec = engine
        .runtime
        .python_command(["uvr/separate.py", "--list-variants"])?;
    let result = ManagedProcess::run(&spec, &engine.cancellation_token(), |_, _| {}).await?;
    result.ensure_success()?;
    let data = json_result(&result.stdout)?;
    Ok(Json(
        json!({"variants": data["variants"], "official": data["official"]}),
    ))
}

async fn custom_models(State(state): State<Arc<Uvr>>, request: Request) -> Accepted {
    let engine = &state.engine;
    let mut input = uploads::parse(request, &engine.runtime.uploads, &model_rules()).await?;
    let body = &input.body;
    let name = string(body, "name").trim().to_owned();
    let architecture = string(body, "architecture");
    let variant = string(body, "variant").trim().to_owned();
    if name.is_empty() {
        return Err(Error::input("A model name is required."));
    }
    // VR and MDX resolve arch parameters through vendored hash tables keyed by
    // file digest, so custom weights for them are unsupported by design.
    if !matches!(architecture.as_str(), "roformer" | "mdxc" | "demucs") {
        return Err(Error::input(
            "Custom weights are supported for roformer, mdxc and demucs models only.",
        ));
    }
    if architecture == "roformer" {
        if variant.is_empty() {
            return Err(Error::input("A roformer variant is required."));
        }
        let spec = engine
            .runtime
            .python_command(["uvr/separate.py", "--list-variants"])?;
        let result = ManagedProcess::run(&spec, &engine.cancellation_token(), |_, _| {}).await?;
        result.ensure_success()?;
        let known = json_result(&result.stdout)?;
        if !known["variants"]
            .as_array()
            .is_some_and(|variants| variants.iter().any(|v| v == &variant))
        {
            return Err(Error::input(&format!(
                "Unknown roformer variant '{variant}'."
            )));
        }
    }
    let weight = match input.files.get("weightFile") {
        Some(file) => (
            simple_filename(&file.original_name, "Model file", WEIGHT_EXTENSIONS)
                .map_err(Error::from)?,
            None,
        ),
        None => {
            let link = string(body, "weightLink").trim().to_owned();
            if link.is_empty() {
                return Err(Error::input("A model file or link is required."));
            }
            (
                simple_filename(
                    &link.split(['?', '#']).next().unwrap_or_default(),
                    "Model file",
                    WEIGHT_EXTENSIONS,
                )
                .map_err(Error::from)?,
                Some(link),
            )
        }
    };
    let config = match input.files.get("configFile") {
        Some(file) => (
            simple_filename(&file.original_name, "Config file", CONFIG_EXTENSIONS)
                .map_err(Error::from)?,
            None,
        ),
        None => {
            let link = string(body, "configLink").trim().to_owned();
            if link.is_empty() {
                return Err(Error::input("A config file or link is required."));
            }
            (
                simple_filename(
                    &link.split(['?', '#']).next().unwrap_or_default(),
                    "Config file",
                    CONFIG_EXTENSIONS,
                )
                .map_err(Error::from)?,
                Some(link),
            )
        }
    };
    if weight.0 == config.0 {
        return Err(Error::input(
            "The model file and the config file must have different names.",
        ));
    }
    let key = slug(&name);
    if key.is_empty() {
        return Err(Error::input(
            "A model name with letters or numbers is required.",
        ));
    }

    let model_dir = engine.runtime.data.join("rvc/models/uvr").join(&key);
    tokio::fs::create_dir_all(&model_dir)
        .await
        .map_err(|error| Error::internal(error))?;
    if let Some(file) = input.files.get("weightFile") {
        tokio::fs::copy(&file.path, model_dir.join(&weight.0))
            .await
            .map_err(|error| Error::internal(error))?;
    }
    if let Some(file) = input.files.get("configFile") {
        tokio::fs::copy(&file.path, model_dir.join(&config.0))
            .await
            .map_err(|error| Error::internal(error))?;
    }

    let mut entry = json!({
        "key": key,
        "label": name,
        "arch": architecture,
        "files": [(weight.0, weight.1), (config.0, config.1)],
        "stems": ["vocals", "instrumental"],
        "target": "vocals",
    });
    if architecture == "roformer" {
        if let Some(object) = entry.as_object_mut() {
            object.insert("cls".into(), json!(variant));
        }
    }
    upsert_custom_entry(&engine.runtime.data, entry)
        .await
        .map_err(Error::internal)?;

    // Fetching only downloads files: never hold the GPU lease.
    let job = engine
        .start_job(
            JobType::Other,
            json!({"model": key}),
            Some(Resource::ModelDownload),
            move |engine, job, token| run_fetch(engine, job, token, key),
        )
        .await
        .map_err(Error::internal)?;
    input.retain();
    Ok(accepted(job))
}

async fn run_fetch(
    engine: Arc<NativeEngine>,
    job: Job,
    token: CancellationToken,
    key: String,
) -> Result<JobResult> {
    engine.jobs.stage(&job.id, "Model import", None, None);
    run_step(&engine, &job, &token, vec!["uvr/install.py".into()]).await?;
    engine.jobs.log(&job.id, "UVR dependencies ready.");
    engine
        .jobs
        .stage(&job.id, "Fetching model files…", None, None);
    let stdout = run_step(
        &engine,
        &job,
        &token,
        vec!["uvr/separate.py".into(), "--fetch-only".into(), key.clone()],
    )
    .await?;
    let data = json_result(&stdout)?;
    engine.jobs.progress(&job.id, 100.0);
    Ok(JobResult::new(
        json!({"filename": data["filename"], "message": format!("Imported model '{key}'.")}),
        None,
    ))
}

async fn run_separation(
    engine: Arc<NativeEngine>,
    job: Job,
    token: CancellationToken,
    params: Value,
    audio: std::path::PathBuf,
) -> Result<JobResult> {
    // Provisioning never loads an architecture. Serialize optional installs and
    // shared model transfers without reserving the accelerator for network I/O.
    {
        engine
            .jobs
            .stage(&job.id, "Waiting for a download slot.", None, None);
        let _download = engine
            .scheduler
            .acquire(&job.id, Resource::ModelDownload, &token)
            .await?
            .context("Stopped by user")?;
        engine
            .jobs
            .stage(&job.id, "Audio separation setup", None, None);
        run_step(&engine, &job, &token, vec!["uvr/install.py".into()]).await?;
        run_step(
            &engine,
            &job,
            &token,
            vec![
                "uvr/separate.py".into(),
                "--fetch-only".into(),
                string(&params, "model"),
            ],
        )
        .await?;
    }
    let _gpu = if params["device"] == "cpu" {
        None
    } else {
        engine.jobs.stage(
            &job.id,
            "Waiting for the GPU to become available.",
            None,
            None,
        );
        let lease = engine
            .scheduler
            .acquire(&job.id, Resource::Gpu, &token)
            .await?
            .context("Stopped by user")?;
        // Release the resident converter only while owning the same GPU lease.
        engine.worker.stop().await?;
        Some(lease)
    };
    if token.is_cancelled() {
        bail!("Stopped by user");
    }
    let output = engine
        .runtime
        .outputs
        .join(format!("uvr_{}", Uuid::new_v4()));
    tokio::fs::create_dir_all(&output).await?;
    engine.jobs.stage(&job.id, "Separating audio…", None, None);
    let stdout = run_step(&engine, &job, &token, cli_args(&params, &audio, &output)).await?;
    let data = json_result(&stdout)?;
    engine.jobs.stage(&job.id, "Checking output…", None, None);
    let mut result = separation_result(&engine.runtime.data, &output, &data).await?;
    result.result["message"] = json!(format!(
        "Separated {} stems with {}.",
        result.result["stems"].as_array().unwrap().len(),
        string(&params, "model")
    ));
    engine.jobs.progress(&job.id, 100.0);
    Ok(result)
}

async fn separation_result(data_root: &Path, output: &Path, data: &Value) -> Result<JobResult> {
    let stems = data["stems"].as_object().context("No stems produced.")?;
    if stems.is_empty() {
        bail!("No stems produced.");
    }
    let output = tokio::fs::canonicalize(output).await?;
    let mut result = Vec::new();
    let mut output_file = None;
    for (label, file) in stems {
        let file = file.as_str().context("Invalid stem filename")?;
        let actual = tokio::fs::canonicalize(data_root.join(file)).await?;
        let metadata = tokio::fs::metadata(&actual).await?;
        if !metadata.is_file() || !actual.starts_with(&output) {
            bail!("Separator reported a stem outside its output folder");
        }
        if metadata.len() == 0 {
            bail!("No stems produced.");
        }
        let name = actual
            .strip_prefix(&output)?
            .to_string_lossy()
            .replace('\\', "/");
        let url = format!(
            "/outputs/{}/{}",
            encode_segment(&output.file_name().unwrap_or_default().to_string_lossy()),
            name.split('/')
                .map(encode_segment)
                .collect::<Vec<_>>()
                .join("/")
        );
        if output_file.is_none() || data["outputFile"].as_str() == Some(file) {
            output_file = Some(path_string(&actual));
        }
        result.push(json!({"label":label,"file":file,"url":url}));
    }
    Ok(JobResult::new(json!({"stems":result}), output_file))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn progress_stages_only_accept_known_separator_messages() {
        assert_eq!(
            separation_stage("APPLIO_STAGE:Separating…"),
            Some("Separating…")
        );
        assert_eq!(
            separation_stage("APPLIO_STAGE:Loading models…"),
            Some("Loading models…")
        );
        assert_eq!(
            separation_stage("APPLIO_STAGE:Downloading models…"),
            Some("Downloading models…")
        );
        assert_eq!(separation_stage("Separating: 100% |"), None);
        assert_eq!(separation_stage("APPLIO_STAGE:unknown"), None);
    }

    #[tokio::test]
    async fn separation_outputs_validate_files_and_preserve_primary_download() {
        let root = tempfile::tempdir().unwrap();
        let output = root.path().join("moved outputs/uvr_1");
        tokio::fs::create_dir_all(&output).await.unwrap();
        let primary = output.join("song (vocals).wav");
        let secondary = output.join("song (instrumental).wav");
        tokio::fs::write(&primary, b"audio").await.unwrap();
        tokio::fs::write(&secondary, b"audio").await.unwrap();
        let data =
            json!({"stems":{"Vocals":primary,"Instrumental":secondary},"outputFile":primary});
        let result = separation_result(root.path(), &output, &data)
            .await
            .unwrap();
        assert_eq!(
            result.output_file,
            Some(path_string(
                &tokio::fs::canonicalize(&primary).await.unwrap()
            ))
        );
        assert_eq!(
            result.result["stems"][1]["url"],
            "/outputs/uvr_1/song%20(vocals).wav"
        );
        let outside = root.path().join("outside.wav");
        tokio::fs::write(&outside, b"audio").await.unwrap();
        assert!(
            separation_result(root.path(), &output, &json!({"stems":{"Vocals":outside}}))
                .await
                .is_err()
        );
        tokio::fs::write(&primary, b"").await.unwrap();
        assert!(separation_result(root.path(), &output, &data)
            .await
            .is_err());
        assert!(
            separation_result(root.path(), &output, &json!({"stems":{}}))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn separation_prepares_without_gpu_and_cancels_queued_inference() {
        let root = tempfile::tempdir().unwrap();
        for (name, source) in [
            ("assets/config_template.json", "{}"),
            ("backend/applio/rvc/configs/config.py", ""),
            ("uvr/install.py", "print('ready')"),
            (
                "uvr/separate.py",
                r#"
import json, sys, time
from pathlib import Path
if '--fetch-only' in sys.argv:
    Path('fetch-started').touch()
    while not Path('allow-fetch').exists():
        time.sleep(0.02)
    print('APPLIO_JSON:' + json.dumps({'filename':'fixture.onnx'}), flush=True)
else:
    Path('inference-started').touch()
    output = Path(sys.argv[sys.argv.index('--output-dir') + 1]) / 'Vocals.wav'
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(b'fixture-output')
    print('APPLIO_JSON:' + json.dumps({'stems':{'Vocals':str(output)},'outputFile':str(output)}), flush=True)
"#,
            ),
        ] {
            let path = root.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, source).unwrap();
        }
        let config = crate::ApiConfig {
            code_root: root.path().into(),
            data_root: root.path().join("data"),
            config_dir: root.path().join("config"),
        };
        let runtime = crate::engine_runtime::EngineRuntime::with_python(
            &config,
            Some(if cfg!(windows) { "python" } else { "python3" }.into()),
        )
        .unwrap();
        let engine = NativeEngine::open(
            runtime.clone(),
            Arc::new(crate::engine::RuntimeReadiness::new(runtime, true)),
        )
        .unwrap();
        let data = &engine.runtime.data;
        let token = CancellationToken::new();
        let gpu = engine
            .scheduler
            .acquire("existing-gpu-work", Resource::Gpu, &token)
            .await
            .unwrap()
            .unwrap();
        async fn submit(engine: &Arc<NativeEngine>, device: &str) -> Job {
            let params =
                normalize(&json!({"model":"fixture.onnx", "device":device, "mdxOverlap":0.5}))
                    .unwrap();
            let audio = engine.runtime.data.join("input.wav");
            engine
                .start_job(
                    JobType::Other,
                    params.clone(),
                    None,
                    move |engine, job, token| run_separation(engine, job, token, params, audio),
                )
                .await
                .unwrap()
        }
        let queued = submit(&engine, "auto").await;
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while !data.join("fetch-started").exists() {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        assert!(!data.join("inference-started").exists());
        std::fs::write(data.join("allow-fetch"), "").unwrap();
        tokio::time::timeout(std::time::Duration::from_secs(10), async {
            while !engine.scheduler.status().queued.contains(&queued.id) {
                tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            }
        })
        .await
        .unwrap();
        // Downloads can proceed while separation waits for an occupied GPU.
        let download = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            engine
                .scheduler
                .acquire("another-download", Resource::ModelDownload, &token),
        )
        .await
        .unwrap()
        .unwrap()
        .unwrap();
        drop(download);
        engine.jobs.cancellation(&queued.id).unwrap().cancel();
        async fn terminal(engine: &NativeEngine, id: &str) -> Job {
            tokio::time::timeout(std::time::Duration::from_secs(10), async {
                loop {
                    let job = engine.jobs.get(id).unwrap();
                    if !job.active() {
                        return job;
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
            })
            .await
            .unwrap()
        }
        assert_eq!(
            terminal(&engine, &queued.id).await.status,
            crate::jobs::JobStatus::Error
        );
        assert!(!data.join("inference-started").exists());
        assert!(!engine.scheduler.status().queued.contains(&queued.id));
        // Explicit CPU work still completes while another job owns the GPU.
        let cpu = submit(&engine, "cpu").await;
        let completed = terminal(&engine, &cpu.id).await;
        assert_eq!(
            completed.status,
            crate::jobs::JobStatus::Done,
            "{:?}",
            completed.error
        );
        assert!(completed.output_file.is_some());
        assert_eq!(completed.params.unwrap()["mdxOverlap"], 0.5);
        drop(gpu);
        engine.shutdown().await.unwrap();
    }

    #[test]
    fn cli_args_maps_schema_defaults_for_every_arch() {
        let params = normalize(&json!({"model":"UVR_MDXNET_Main.onnx"})).expect("valid");
        let args = cli_args(
            &params,
            Path::new("/data/input.wav"),
            Path::new("/data/outputs/uvr_1"),
        );
        assert_eq!(
            args,
            vec![
                "uvr/separate.py",
                "--input-path",
                "/data/input.wav",
                "--model",
                "UVR_MDXNET_Main.onnx",
                "--output-dir",
                "/data/outputs/uvr_1",
                "--output-format",
                "wav",
                "--single-stem",
                "all",
                "--vr-aggression",
                "5",
                "--vr-window",
                "512",
                "--vr-batch",
                "1",
                "--vr-post-threshold",
                "0.2",
                "--mdx-segment",
                "256",
                "--mdx-overlap",
                "0.25",
                "--mdx-batch",
                "1",
                "--mdx-hop",
                "1024",
                "--mdxc-segment",
                "256",
                "--mdxc-overlap",
                "8",
                "--mdxc-batch",
                "1",
                "--mdxc-pitch-shift",
                "0",
                "--demucs-segment",
                "Default",
                "--demucs-shifts",
                "2",
                "--demucs-overlap",
                "0.25",
                "--roformer-overlap",
                "2",
                "--roformer-batch",
                "1",
                "--device",
                "auto",
            ]
        );
    }

    #[test]
    fn cli_args_keeps_true_flags_only_and_demucs_no_split() {
        let params = normalize(&json!({
            "model": "m",
            "vrTta": true,
            "vrHighEnd": true,
            "vrPostProcess": true,
            "mdxDenoise": true,
            "mdxcOverrideSegment": true,
            "roformerDenoise": true,
            "demucsSplit": false,
        }))
        .expect("valid");
        let args = cli_args(&params, Path::new("/data/i.wav"), Path::new("/data/o"));
        for flag in [
            "--vr-tta",
            "--vr-high-end",
            "--vr-post-process",
            "--mdx-denoise",
            "--mdxc-override-segment",
            "--roformer-denoise",
            "--demucs-no-split",
        ] {
            assert!(args.contains(&flag.to_string()), "missing {flag}");
        }
        // False booleans stay absent: defaults come from the engine itself.
        assert!(!args.contains(&"--demucs-split".to_string()));
        assert!(!args.contains(&"--roformer-chunk".to_string()));
    }

    #[test]
    fn slug_keeps_simple_names_only() {
        assert_eq!(slug("HyperACE Karaoke v2"), "hyperace-karaoke-v2");
        assert_eq!(slug("  My*Model!! "), "my-model");
        assert_eq!(slug("модель"), "");
        assert_eq!(slug("a").chars().count(), 1);
        assert_eq!(slug(&"x".repeat(100)).len(), 64);
    }

    #[test]
    fn simple_filename_checks_extension_and_charset() {
        assert!(simple_filename("my model.pth", "x", WEIGHT_EXTENSIONS).is_err());
        assert!(simple_filename("model.pth?token=1", "x", WEIGHT_EXTENSIONS).is_err());
        assert!(simple_filename("evil.exe", "x", WEIGHT_EXTENSIONS).is_err());
        assert!(simple_filename("", "x", WEIGHT_EXTENSIONS).is_err());
        assert_eq!(
            simple_filename("model.ckpt", "x", WEIGHT_EXTENSIONS).unwrap(),
            "model.ckpt"
        );
        assert!(simple_filename("cfg.YML", "x", CONFIG_EXTENSIONS).is_ok());
    }

    #[tokio::test]
    async fn upsert_bootstraps_after_the_file_gone_or_empty() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("rvc/models/uvr/custom_models.json");
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "   \n").unwrap();
        upsert_custom_entry(
            dir.path(),
            serde_json::json!({"key": "a", "label": "A", "arch": "roformer", "files": [], "stems": [], "target": ""}),
        )
        .await
        .unwrap();
        let entries: Vec<serde_json::Value> =
            serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0]["key"], "a");
    }
}
