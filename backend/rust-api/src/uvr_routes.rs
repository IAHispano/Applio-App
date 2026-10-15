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
async fn models(State(state): State<Arc<Uvr>>) -> Result<Json<Value>, Error> {
    let engine = &state.engine;
    let path = engine.runtime.code.join("uvr/models.py");
    let (models,_)=state.catalog.get(&path,||async {
        let spec=engine.runtime.python_command(["uvr/separate.py","--list-models"])?;
        let result=ManagedProcess::run(&spec,&engine.cancellation_token(),|_,_|{}).await?;
        result.ensure_success()?;
        let catalog=json_result(&result.stdout)?;
        let models=catalog["models"].as_array().context("Model catalog returned no data.")?;
        let models:Result<Vec<_>>=models.iter().map(|model|{
            let stems=model["stems"].as_array().context("Invalid model catalog stems")?;
            let stems:Result<Vec<_>>=stems.iter().map(|stem|stem.as_str().map(title).context("Invalid stem label")).collect();
            Ok(json!({"filename":model["filename"],"name":model["label"],"type":model["arch"].as_str().unwrap_or_default().to_uppercase(),"stems":stems?,"target_stem":model["target"].as_str().map(title)}))
        }).collect();
        Ok(json!({"models":models?}))
    }).await.map_err(Error::internal)?;
    Ok(Json(models))
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
        "demucsSegment",
        "demucsShifts",
        "demucsOverlap",
        "demucsSplit",
        "roformerChunk",
        "roformerOverlap",
        "roformerBatch",
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
                engine.jobs.progress(&job.id, percent.into());
            }
        }
    })
    .await?;
    result.ensure_success()?;
    Ok(result.stdout)
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
    let saved = json!({"inputPath":audio,"model":params["model"],"outputFormat":params["outputFormat"],"device":params["device"]});
    let job = engine
        .start_job(
            JobType::Other,
            saved,
            Some(Resource::Gpu),
            move |engine, job, token| run_separation(engine, job, token, params, audio),
        )
        .await
        .map_err(Error::internal)?;
    input.retain();
    Ok(accepted(job))
}

async fn run_separation(
    engine: Arc<NativeEngine>,
    job: Job,
    token: CancellationToken,
    params: Value,
    audio: std::path::PathBuf,
) -> Result<JobResult> {
    engine
        .jobs
        .stage(&job.id, "Audio separation setup", None, None);
    run_step(&engine, &job, &token, vec!["uvr/install.py".into()]).await?;
    engine.jobs.log(&job.id, "UVR dependencies ready.");
    let output = engine
        .runtime
        .outputs
        .join(format!("uvr_{}", Uuid::new_v4()));
    tokio::fs::create_dir_all(&output).await?;
    engine.jobs.stage(&job.id, "Separating audio…", None, None);
    let stdout = run_step(&engine, &job, &token, cli_args(&params, &audio, &output)).await?;
    let data = json_result(&stdout)?;
    let stems = data["stems"].as_object().context("No stems produced.")?;
    if stems.is_empty() {
        bail!("No stems produced.");
    }
    let mut result = Vec::new();
    let output = tokio::fs::canonicalize(output).await?;
    for (label, file) in stems {
        let file = file.as_str().context("Invalid stem filename")?;
        let actual = tokio::fs::canonicalize(engine.runtime.data.join(file)).await?;
        if !actual.is_file() || !actual.starts_with(&output) {
            bail!("Separator reported a stem outside its output folder");
        }
        let url = if file.split('/').any(|part| part == "..") || Path::new(file).is_absolute() {
            let name = actual
                .strip_prefix(&output)?
                .to_string_lossy()
                .replace('\\', "/");
            format!(
                "/outputs/{}/{}",
                encode_segment(&output.file_name().unwrap_or_default().to_string_lossy()),
                name.split('/')
                    .map(encode_segment)
                    .collect::<Vec<_>>()
                    .join("/")
            )
        } else {
            format!(
                "/{}",
                file.split('/')
                    .map(encode_segment)
                    .collect::<Vec<_>>()
                    .join("/")
            )
        };
        result.push(json!({"label":label,"file":file,"url":url}));
    }
    engine.jobs.progress(&job.id, 100.0);
    Ok(JobResult::new(
        json!({"stems":result,"message":format!("Separated {} stems with {}.",result.len(),string(&params,"model"))}),
        None,
    ))
}
