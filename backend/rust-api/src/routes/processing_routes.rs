//! Native conversion, speech and analysis endpoints. No HTTP compatibility hop.
use crate::{
    engine::{JobResult, NativeEngine},
    infer_params,
    jobs::{Job, JobType},
    process::ManagedProcess,
    scheduler::Resource,
    uploads::{self, Input},
};
use anyhow::{bail, Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Query, Request, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;
use tower_http::services::{ServeDir, ServeFile};
use uuid::Uuid;

pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/inference", post(inference))
        .route("/api/tts", post(tts))
        .route("/api/extra/analyze", post(analyze))
        .route("/api/extra/f0", post(f0))
        .route("/api/extra/model-info", post(model_info))
        .route("/api/voice-blender", post(blender))
        .route("/api/audio/raw", get(raw_audio))
        .route_service(
            "/assets/applio-logo.svg",
            ServeFile::new(engine.runtime.code.join("assets/applio-logo.svg")),
        )
        .nest_service("/assets", ServeDir::new(engine.runtime.data.join("assets")))
        .nest_service("/outputs", ServeDir::new(&engine.runtime.outputs))
        .layer(DefaultBodyLimit::disable())
        .with_state(engine)
}

pub(crate) struct Error(pub(crate) StatusCode, pub(crate) Value);
impl Error {
    pub(crate) fn input(error: impl ToString) -> Self {
        Self(StatusCode::BAD_REQUEST, json!({"error": error.to_string()}))
    }
    pub(crate) fn internal(error: impl ToString) -> Self {
        Self(
            StatusCode::INTERNAL_SERVER_ERROR,
            json!({"error": error.to_string()}),
        )
    }
}
impl From<anyhow::Error> for Error {
    fn from(error: anyhow::Error) -> Self {
        Self::input(error)
    }
}
impl From<infer_params::ValidationErrors> for Error {
    fn from(error: infer_params::ValidationErrors) -> Self {
        Self(StatusCode::BAD_REQUEST, error.body())
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(self.1)).into_response()
    }
}
pub(crate) type Accepted = Result<(StatusCode, Json<Value>), Error>;
pub(crate) fn accepted(job: Job) -> (StatusCode, Json<Value>) {
    (StatusCode::ACCEPTED, Json(json!({"jobId": job.id})))
}
pub(crate) async fn ready(engine: &NativeEngine) -> Result<(), Error> {
    engine.require_ready(false).await.map_err(|e| {
        Error(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({"error": e.to_string()}),
        )
    })
}
pub(crate) fn string(value: &Value, field: &str) -> String {
    value[field].as_str().unwrap_or_default().to_owned()
}
pub(crate) fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}
fn input_audio(engine: &NativeEngine, input: &Input) -> Result<PathBuf> {
    if let Some(file) = input.file("audio") {
        return Ok(file.into());
    }
    let value = string(&input.body, "inputPath");
    if value.is_empty() {
        bail!("Provide an 'audio' file upload or 'inputPath'.");
    }
    engine.runtime.require_file(&value)
}
pub(crate) fn model_paths(engine: &NativeEngine, params: &mut Value) -> Result<()> {
    params["pthPath"] = json!(engine.runtime.require_file(&string(params, "pthPath"))?);
    let index = string(params, "indexPath");
    if !index.is_empty() {
        params["indexPath"] = json!(engine.runtime.require_file(&index)?);
    }
    Ok(())
}
fn output(engine: &NativeEngine, prefix: &str, extension: &str) -> PathBuf {
    engine
        .runtime
        .outputs
        .join(format!("{prefix}_{}.{}", Uuid::new_v4(), extension))
}
fn log(engine: &NativeEngine, id: &str, line: &str, tail: &mut String) {
    let line: String = line.trim().chars().take(1000).collect();
    if line.is_empty() {
        return;
    }
    engine.jobs.log(id, &line);
    engine.jobs.conversion_output(id, &line);
    tail.push_str(&line);
    tail.push('\n');
    // Bound by Unicode characters, never slicing in the middle of UTF-8.
    if tail.len() > 16_000 {
        *tail = tail
            .chars()
            .rev()
            .take(8000)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
    }
}
fn tail(text: &str) -> String {
    text.chars()
        .rev()
        .take(2000)
        .collect::<String>()
        .chars()
        .rev()
        .collect()
}
pub(crate) async fn cli(
    engine: &NativeEngine,
    id: &str,
    args: Vec<String>,
    token: &CancellationToken,
    stdout: &mut String,
) -> Result<String> {
    if token.is_cancelled() {
        bail!("Stopped by user");
    }
    engine.worker.stop().await?;
    let spec = engine.runtime.python_command(args)?;
    let result = ManagedProcess::run(&spec, token, |_, line| log(engine, id, line, stdout)).await?;
    result.ensure_success()?;
    Ok(result.stdout)
}
pub(crate) fn infer_cli(params: &Value, input: &Path, output: &Path) -> Vec<String> {
    let mut args = vec![
        "rvc/infer/infer.py".into(),
        "--input-path".into(),
        path_string(input),
        "--output-path".into(),
        path_string(output),
        "--pth-path".into(),
        string(params, "pthPath"),
        "--index-path".into(),
        string(params, "indexPath"),
    ];
    args.extend(infer_params::common_cli_args(params));
    args
}
pub(crate) fn final_output(
    engine: &NativeEngine,
    wav: &Path,
    ext: &str,
    response: &Value,
    fields: &[&str],
) -> Result<String> {
    let mut candidates: Vec<PathBuf> = fields
        .iter()
        .filter_map(|key| response[*key].as_str())
        .map(|path| {
            let path = PathBuf::from(path);
            if path.is_absolute() {
                path
            } else {
                engine.runtime.data.join(path)
            }
        })
        .collect();
    candidates.extend([wav.with_extension(ext.to_lowercase()), wav.to_path_buf()]);
    let file = candidates
        .into_iter()
        .find(|file| file.is_file())
        .context("Processing finished but no output file was found.")?;
    Ok(engine.runtime.repo_relative(&file))
}

async fn inference(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    let mut input =
        uploads::parse(request, &engine.runtime.uploads, &uploads::audio_rule()).await?;
    ready(&engine).await?;
    let mut params = infer_params::inference(&input.body)?;
    let audio = input_audio(&engine, &input)?;
    let mut saved = params.clone();
    saved["inputPath"] = json!(audio);
    model_paths(&engine, &mut params)?;
    let job = engine.start_job(JobType::Inference, saved, Some(Resource::Gpu), move |engine, job, token| async move {
        let wav = output(&engine, "web_output", "wav");
        engine.jobs.stage(&job.id, "Preparing conversion…", None, None);
        let mut stdout = String::new();
        let response = engine.worker.request(json!({"command":"infer", "id":job.id, "params":params, "inputPath":audio, "outputPath":wav}), &token, |line| log(&engine, &job.id, line, &mut stdout)).await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                if token.is_cancelled() { bail!("Stopped by user"); }
                engine.jobs.log(&job.id, &format!("Worker notice: {error}; falling back to standalone CLI runner..."));
                cli(&engine, &job.id, infer_cli(&params, &audio, &wav), &token, &mut stdout).await?;
                Value::Null
            }
        };
        engine.jobs.stage(&job.id, "Checking output…", None, None);
        let file = final_output(&engine, &wav, &string(&params, "exportFormat"), &response, &["outputPath"])?;
        engine.jobs.log(&job.id, &format!("Done -> {file}"));
        Ok(JobResult::new(json!({"stdout":tail(&stdout)}), Some(file)))
    }).await.map_err(Error::internal)?;
    input.retain();
    Ok(accepted(job))
}

async fn tts(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    let mut input = uploads::parse(request, &engine.runtime.uploads, &uploads::text_rule()).await?;
    ready(&engine).await?;
    let mut params = infer_params::tts(&input.body)?;
    let tts_file = input.file("txt_file").map(path_string).unwrap_or_default();
    if string(&params, "ttsText").is_empty() && tts_file.is_empty() {
        return Err(Error::input("Provide 'ttsText' or upload a 'txt_file'."));
    }
    let mut saved = params.clone();
    saved["ttsFile"] = json!(tts_file);
    model_paths(&engine, &mut params)?;
    let job = engine.start_job(JobType::Tts, saved, Some(Resource::Gpu), move |engine, job, token| async move {
        let intermediate = output(&engine, "tts_output", "wav");
        let wav = output(&engine, "tts_rvc_output", "wav");
        engine.jobs.stage(&job.id, "Preparing speech synthesis…", None, None);
        let mut stdout = String::new();
        let response = engine.worker.request(json!({"command":"tts", "id":job.id, "params":params, "ttsText":params["ttsText"], "ttsFile":tts_file, "ttsVoice":params["ttsVoice"], "ttsRate":params["ttsRate"], "outputTtsPath":intermediate, "outputRvcPath":wav}), &token, |line| log(&engine, &job.id, line, &mut stdout)).await;
        let response = match response {
            Ok(response) => response,
            Err(error) => {
                if token.is_cancelled() { bail!("Stopped by user"); }
                engine.jobs.log(&job.id, &format!("Worker notice: {error}; falling back to standalone CLI runner..."));
                engine.jobs.stage(&job.id, "Generating speech…", None, None);
                cli(&engine, &job.id, vec!["rvc/lib/tools/tts.py".into(), "--tts-file".into(), tts_file, "--tts-text".into(), string(&params,"ttsText"), "--tts-voice".into(), string(&params,"ttsVoice"), "--tts-rate".into(), params["ttsRate"].to_string(), "--output-tts-path".into(), path_string(&intermediate)], &token, &mut stdout).await?;
                engine.jobs.stage(&job.id, "Loading voice model…", None, None);
                let mut args = infer_cli(&params, &intermediate, &wav);
                args.extend(["--cleanup-stage".into(), "output".into()]);
                cli(&engine, &job.id, args, &token, &mut stdout).await?;
                Value::Null
            }
        };
        engine.jobs.stage(&job.id, "Checking output…", None, None);
        let file = final_output(&engine, &wav, &string(&params,"exportFormat"), &response, &["outputRvcPath", "outputPath"])?;
        Ok(JobResult::new(json!({"stdout":tail(&stdout), "ttsIntermediate":engine.runtime.repo_relative(&intermediate)}), Some(file)))
    }).await.map_err(Error::internal)?;
    input.retain();
    Ok(accepted(job))
}

async fn analyze(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    extra_audio(engine, request, false).await
}
async fn f0(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    extra_audio(engine, request, true).await
}
async fn extra_audio(engine: Arc<NativeEngine>, request: Request, f0: bool) -> Accepted {
    let mut input =
        uploads::parse(request, &engine.runtime.uploads, &uploads::audio_rule()).await?;
    ready(&engine).await?;
    let audio = input_audio(&engine, &input)?;
    let method = input.body.get("method").cloned().unwrap_or(json!("rmvpe"));
    if f0
        && !["crepe", "fcpe", "rmvpe", "swift"]
            .iter()
            .any(|s| method.as_str() == Some(s))
    {
        return Err(Error(
            StatusCode::BAD_REQUEST,
            json!({"error":"Invalid params", "details":{"formErrors":[],"fieldErrors":{"method":["Invalid enum value"]}}}),
        ));
    }
    let params = if f0 {
        json!({"inputPath":audio,"method":method})
    } else {
        json!({"inputPath":audio})
    };
    let job = engine.start_job(JobType::Other, params, Some(Resource::Gpu), move |engine, job, token| async move {
        let plot = output(&engine, if f0 { "f0_plot" } else { "audio_analysis" }, "png");
        let txt = output(&engine, "f0_curve", "txt");
        let payload = if f0 { json!({"command":"f0_curve","id":job.id,"inputPath":audio,"method":method,"outputImage":plot,"outputTxt":txt}) } else { json!({"command":"analyze_audio","id":job.id,"inputPath":audio,"plotPath":plot}) };
        let mut stdout = String::new();
        let response = match engine.worker.request(payload, &token, |line| log(&engine, &job.id, line, &mut stdout)).await {
            Ok(response) => response,
            Err(error) => {
                if token.is_cancelled() { bail!("Stopped by user"); }
                engine.jobs.log(&job.id, &format!("Worker notice: {error}; running fallback runner..."));
                let args = if f0 { vec!["rvc/lib/tools/f0_curve.py".into(), "--input-path".into(), path_string(&audio), "--method".into(), method.as_str().unwrap().into(), "--output-image".into(), path_string(&plot), "--output-txt".into(), path_string(&txt)] } else { vec!["-c".into(), "import sys,json; from rvc.lib.tools.analyzer import analyze_audio; info,plot=analyze_audio(sys.argv[1],sys.argv[2]); print('APPLIO_JSON:'+json.dumps({'info':info,'plot':plot}))".into(), path_string(&audio), path_string(&plot)] };
                let stdout = cli(&engine, &job.id, args, &token, &mut stdout).await?;
                if f0 { Value::Null } else { parse_json(&stdout)? }
            }
        };
        let file = final_output(&engine, &plot, "png", &response, &["plot"])?;
        let result = if f0 { if !txt.is_file() { bail!("F0 extraction finished but no curve file was found."); } json!({"curveFile":engine.runtime.repo_relative(&txt)}) } else { json!({"info":response["info"]}) };
        Ok(JobResult::new(result, Some(file)))
    }).await.map_err(Error::internal)?;
    input.retain();
    Ok(accepted(job))
}
fn parse_json(stdout: &str) -> Result<Value> {
    let line = stdout
        .lines()
        .rev()
        .find_map(|line| line.strip_prefix("APPLIO_JSON:"))
        .context("Python did not report a JSON result")?;
    Ok(serde_json::from_str(line)?)
}
async fn model_info(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    ready(&engine).await?;
    if !input.body["pthPath"]
        .as_str()
        .is_some_and(|value| !value.is_empty())
    {
        let mut errors = infer_params::ValidationErrors::default();
        errors
            .field_errors
            .insert("pthPath".into(), vec!["Expected a nonempty string".into()]);
        return Err(errors.into());
    }
    let model = engine
        .runtime
        .require_file(&string(&input.body, "pthPath"))?;
    let job = engine.start_job(JobType::Other, json!({"pthPath":input.body["pthPath"]}), Some(Resource::Gpu), move |engine, job, token| async move {
        let mut stdout = String::new();
        let metadata = match engine.worker.request(json!({"command":"inspect_model", "id":job.id, "pthPath":model}), &token, |line| log(&engine, &job.id, line, &mut stdout)).await {
            Ok(response) => response["metadata"].clone(),
            Err(error) => {
                if token.is_cancelled() { bail!("Stopped by user"); }
                engine.jobs.log(&job.id, &format!("Worker notice: {error}; inspecting through CLI runner..."));
                let result = cli(&engine, &job.id, vec!["rvc/train/process/model_information.py".into(), path_string(&model)], &token, &mut stdout).await?;
                let mut metadata = serde_json::Map::new();
                for line in result.lines() { if let Some((key, value)) = line.split_once(':') { metadata.insert(key.trim().to_lowercase().split_whitespace().collect::<Vec<_>>().join("_"), json!(value.trim())); } }
                Value::Object(metadata)
            }
        };
        let name = metadata["model_name"].as_str().map(str::to_owned).unwrap_or_else(|| model.file_name().unwrap_or_default().to_string_lossy().into_owned());
        Ok(JobResult::new(json!({"metadata":metadata,"message":format!("Checkpoint \"{name}\" analyzed successfully.")}), None))
    }).await.map_err(Error::internal)?;
    Ok(accepted(job))
}
async fn raw_audio(
    State(engine): State<Arc<NativeEngine>>,
    Query(query): Query<HashMap<String, String>>,
    request: Request,
) -> Result<Response, Error> {
    let value = query
        .get("path")
        .filter(|value| !value.is_empty())
        .context("Missing path parameter")?;
    let path = engine.runtime.resolve_user_path(value)?;
    if !path.is_file() {
        return Err(Error(
            StatusCode::NOT_FOUND,
            json!({"error":"Audio file not found"}),
        ));
    }
    let response = ServeFile::new(path).oneshot(request).await.unwrap();
    Ok(response.into_response())
}

async fn blender(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    let mut input =
        uploads::parse(request, &engine.runtime.uploads, &uploads::blend_rules()).await?;
    ready(&engine).await?;
    let name = string(&input.body, "modelName");
    let mut errors = infer_params::ValidationErrors::default();
    if name.is_empty() || name.chars().count() > 120 {
        errors.field_errors.insert(
            "modelName".into(),
            vec!["String must contain between 1 and 120 character(s)".into()],
        );
    }
    let ratio = match input.body.get("ratio") {
        None => Some(0.5),
        Some(Value::Null) => Some(0.0),
        Some(Value::Bool(value)) => Some(if *value { 1.0 } else { 0.0 }),
        Some(Value::Number(value)) => value.as_f64(),
        Some(Value::String(value)) => {
            if value.trim().is_empty() {
                Some(0.0)
            } else {
                value.trim().parse().ok()
            }
        }
        _ => None,
    };
    if !ratio.is_some_and(|value| value.is_finite() && (0.0..=1.0).contains(&value)) {
        errors.field_errors.insert(
            "ratio".into(),
            vec!["Number must be between 0 and 1".into()],
        );
    }
    let mut models = Vec::new();
    for (file, field) in [("pth_file_1", "pthPath1"), ("pth_file_2", "pthPath2")] {
        let value = input
            .file(file)
            .map(path_string)
            .unwrap_or_else(|| string(&input.body, field));
        if !value.to_lowercase().ends_with(".pth") {
            errors.field_errors.insert(
                field.into(),
                vec!["Blending requires .pth voice models; ONNX files are not supported.".into()],
            );
        }
        models.push(value);
    }
    if !errors.field_errors.is_empty() {
        return Err(errors.into());
    }
    let model1 = engine.runtime.require_file(&models[0])?;
    let model2 = engine.runtime.require_file(&models[1])?;
    let ratio = ratio.unwrap();
    let safe: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || ['.', '_', '-'].contains(&c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    if safe.is_empty() || safe == "." || safe == ".." {
        return Err(Error::input("Model name must contain a filename"));
    }
    let job = engine.start_job(JobType::Other, json!({"modelName":name,"pthPath1":models[0],"pthPath2":models[1],"ratio":ratio}), Some(Resource::Gpu), move |engine, job, token| async move {
        engine.jobs.log(&job.id, &format!("Blending into logs/{safe}.pth (ratio {ratio})"));
        let mut stdout = String::new();
        let response = match engine.worker.request(json!({"command":"model_blender", "id":job.id, "modelName":safe,"pth1":model1,"pth2":model2,"ratio":ratio}), &token, |line| log(&engine, &job.id, line, &mut stdout)).await {
            Ok(response) => response,
            Err(error) => {
                if token.is_cancelled() { bail!("Stopped by user"); }
                engine.jobs.log(&job.id, &format!("Worker notice: {error}; running model blender through fallback runner..."));
                let result = cli(&engine, &job.id, vec!["-c".into(), "import sys,json; from rvc.train.process.model_blender import model_blender; r=model_blender(sys.argv[1],sys.argv[2],sys.argv[3],float(sys.argv[4])); msg,f=(r if isinstance(r,tuple) else (str(r),None)); print('APPLIO_JSON:'+json.dumps({'message':msg,'file':f}))".into(), safe, path_string(&model1), path_string(&model2), ratio.to_string()], &token, &mut stdout).await?;
                parse_json(&result)?
            }
        };
        let file = response["file"].as_str().context("Blending finished but no model was reported")?;
        let file = engine.runtime.require_file(file).with_context(|| string(&response, "message"))?;
        let message = string(&response, "message");
        engine.jobs.log(&job.id, &message);
        Ok(JobResult::new(json!({"message":message}), Some(engine.runtime.model_relative(&file))))
    }).await.map_err(Error::internal)?;
    input.retain();
    Ok(accepted(job))
}
