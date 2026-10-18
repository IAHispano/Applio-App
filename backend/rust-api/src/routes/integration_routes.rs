//! Local workflow API. OpenAI speech returns audio; extensions retain native jobs.
use super::integration_catalog::catalog as operation_catalog;
use crate::{
    engine::NativeEngine,
    jobs::{Job, JobStatus},
    processing_routes, uploads,
};
use axum::{
    body::Body,
    extract::{DefaultBodyLimit, Path, Request, State},
    http::{header, HeaderMap, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{any, get, post},
    Json, Router,
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{path::PathBuf, sync::Arc, time::Duration};
use subtle::ConstantTimeEq;
use tower::ServiceExt;
use tower_http::services::ServeFile;

#[derive(Clone)]
pub(crate) struct ApiCall;

pub fn router(engine: Arc<NativeEngine>, operations: Router) -> Router {
    let versioned = Router::new()
        .nest(
            "/applio",
            Router::new().fallback(any(move |request: Request| {
                dispatch(operations.clone(), request)
            })),
        )
        .route("/capabilities", get(|| async { Json(operation_catalog()) }))
        .route("/jobs/{id}/artifacts", get(artifacts))
        .route("/jobs/{id}/artifacts/{index}", get(artifact))
        .route("/models", get(models))
        .route("/audio/speech", post(speech))
        .route("/audio/conversions", post(conversion))
        .route("/jobs/{id}", get(job))
        .route("/jobs/{id}/cancel", post(cancel))
        .route("/jobs/{id}/content", get(content))
        .route("/openapi.json", get(|| async { Json(schema()) }))
        .fallback(|| async {
            failure(
                StatusCode::NOT_IMPLEMENTED,
                "This endpoint is not supported by Applio.",
                None,
            )
        })
        .layer(DefaultBodyLimit::disable())
        .layer(middleware::from_fn_with_state(engine.clone(), authorize));
    Router::new()
        .route("/api/integrations", get(status))
        .route(
            "/api/integrations/catalog",
            get(|| async { Json(operation_catalog()) }),
        )
        .route("/api/integrations/key", post(create_key).delete(revoke_key))
        .nest("/v1", versioned)
        .layer(middleware::from_fn(no_store))
        .with_state(engine)
}

async fn no_store(request: Request, next: Next) -> Response {
    let mut response = next.run(request).await;
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response
}

async fn dispatch(operations: Router, mut request: Request) -> Response {
    let path = request.uri().path();
    let external = format!("/v1/applio{path}");
    if !super::integration_catalog::allowed(request.method().as_str(), &external) {
        return failure(
            StatusCode::NOT_FOUND,
            "Unknown application operation or method. See /v1/capabilities.",
            None,
        );
    }
    let query = request
        .uri()
        .query()
        .map(|query| format!("?{query}"))
        .unwrap_or_default();
    let target = format!("/api{path}{query}");
    *request.uri_mut() = target.parse().unwrap();
    request.extensions_mut().insert(ApiCall);
    // Re-enter the same handlers in-process, retaining upload bodies, range
    // headers, SSE streams and WebSocket upgrade extensions.
    operations.oneshot(request).await.unwrap()
}

fn artifact_paths(engine: &NativeEngine, job: &Job) -> Vec<PathBuf> {
    fn candidates(value: &Value, output: &mut Vec<String>) {
        match value {
            Value::Object(fields) => {
                for (key, value) in fields {
                    if matches!(
                        key.as_str(),
                        "file"
                            | "output"
                            | "outputFile"
                            | "curveFile"
                            | "plot"
                            | "outputPath"
                            | "outputRvcPath"
                    ) {
                        if let Some(path) = value.as_str() {
                            output.push(path.to_owned());
                        }
                    }
                    if value.is_object() || value.is_array() {
                        candidates(value, output);
                    }
                }
            }
            Value::Array(values) => {
                for value in values {
                    candidates(value, output);
                }
            }
            _ => {}
        }
    }
    if job.status != JobStatus::Done {
        return Vec::new();
    }
    let mut paths: Vec<String> = job.output_file.iter().cloned().collect();
    if let Some(result) = &job.result {
        candidates(result, &mut paths);
    }
    let mut roots: Vec<_> = [&engine.runtime.outputs, &engine.runtime.logs]
        .iter()
        .filter_map(|root| std::fs::canonicalize(root).ok())
        .collect();
    if job.kind == crate::jobs::JobType::BatchInference {
        if let Some(root) = job
            .result
            .as_ref()
            .and_then(|r| r["outputFolder"].as_str())
            .and_then(|r| std::fs::canonicalize(r).ok())
        {
            roots.push(root);
        }
    }
    let audio_root = std::fs::canonicalize(engine.runtime.data.join("assets/audios")).ok();
    let mut found = Vec::new();
    for path in paths {
        if let Some(path) = engine
            .runtime
            .resolve_user_path(&path)
            .ok()
            .and_then(|path| std::fs::canonicalize(path).ok())
        {
            let downloadable = path
                .extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| {
                    let ext = ext.to_ascii_lowercase();
                    uploads::AUDIO_EXTENSIONS.contains(&ext.as_str())
                        || ["pth", "onnx", "index", "png", "jpg", "jpeg", "txt"]
                            .contains(&ext.as_str())
                });
            if path.is_file()
                && downloadable
                && (roots.iter().any(|root| path.starts_with(root))
                    || audio_root.as_ref().is_some_and(|root| {
                        path.starts_with(root)
                            && path
                                .extension()
                                .and_then(|ext| ext.to_str())
                                .is_some_and(|ext| {
                                    uploads::AUDIO_EXTENSIONS
                                        .contains(&ext.to_ascii_lowercase().as_str())
                                })
                    }))
                && !found.contains(&path)
            {
                found.push(path);
            }
        }
    }
    found
}

async fn resolved_artifacts(engine: Arc<NativeEngine>, id: &str) -> Option<Vec<PathBuf>> {
    let job = find_job(&engine, id)?;
    tokio::task::spawn_blocking(move || artifact_paths(&engine, &job))
        .await
        .ok()
}
async fn artifacts(State(engine): State<Arc<NativeEngine>>, Path(id): Path<String>) -> Response {
    match resolved_artifacts(engine, &id).await {
        Some(paths) => Json(json!({"artifacts":paths.iter().enumerate().map(|(index, path)| json!({"name":path.file_name().unwrap_or_default().to_string_lossy(),"size":path.metadata().map(|m|m.len()).unwrap_or_default(),"url":format!("/v1/jobs/{id}/artifacts/{index}")})).collect::<Vec<_>>()})).into_response(),
        None => failure(StatusCode::NOT_FOUND, "API job not found.", None),
    }
}
async fn artifact(
    State(engine): State<Arc<NativeEngine>>,
    Path((id, index)): Path<(String, usize)>,
    request: Request,
) -> Response {
    let Some(path) = resolved_artifacts(engine, &id)
        .await
        .and_then(|paths| paths.get(index).cloned())
    else {
        return failure(StatusCode::NOT_FOUND, "Job artifact not found.", None);
    };
    let disposition = uploads::attachment(path.file_name().unwrap_or_default());
    let mut response = ServeFile::new(path)
        .oneshot(request)
        .await
        .unwrap()
        .into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_DISPOSITION, disposition);
    response
}

fn failure(status: StatusCode, message: &str, param: Option<&str>) -> Response {
    (status, Json(json!({"error":{"message":message,"type":if status == StatusCode::UNAUTHORIZED {"authentication_error"} else if status.is_server_error() {"server_error"} else {"invalid_request_error"},"param":param,"code":status.as_u16().to_string()}}))).into_response()
}
fn native_error(error: processing_routes::Error) -> Response {
    if let Some((param, messages)) = error.1["details"]["fieldErrors"]
        .as_object()
        .and_then(|fields| fields.iter().next())
    {
        return failure(
            error.0,
            messages[0].as_str().unwrap_or("Invalid parameter."),
            Some(param),
        );
    }
    failure(
        error.0,
        error.1["error"].as_str().unwrap_or("Processing failed."),
        None,
    )
}
fn digest(key: &str) -> String {
    format!("{:x}", Sha256::digest(key.as_bytes()))
}
fn valid_key(headers: &HeaderMap, expected: Option<&str>) -> bool {
    let Some(expected) = expected.filter(|value| value.len() == 64) else {
        return false;
    };
    let Some(key) = headers
        .get(header::AUTHORIZATION)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.strip_prefix("Bearer "))
        .filter(|value| value.len() <= 128)
    else {
        return false;
    };
    bool::from(expected.as_bytes().ct_eq(digest(key).as_bytes()))
}
async fn authorize(
    State(engine): State<Arc<NativeEngine>>,
    request: Request,
    next: Next,
) -> Response {
    let config = match engine.runtime.config.load() {
        Ok(config) => config,
        Err(_) => {
            return failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "API configuration unavailable.",
                None,
            )
        }
    };
    let mut response = if valid_key(request.headers(), config["api_access"]["key_hash"].as_str()) {
        crate::jobs::API_REQUEST
            .scope(true, next.run(request))
            .await
    } else {
        failure(
            StatusCode::UNAUTHORIZED,
            "Create an API key in Applio and send it as a Bearer token.",
            None,
        )
    };
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    response.headers_mut().insert(
        "x-request-id",
        uuid::Uuid::new_v4().to_string().parse().unwrap(),
    );
    response
}
fn api_job(job: &Job) -> bool {
    job.params
        .as_ref()
        .is_some_and(|params| params["source"] == "api")
}
async fn status(
    State(engine): State<Arc<NativeEngine>>,
) -> Result<Json<Value>, processing_routes::Error> {
    let config = engine.runtime.config.load()?;
    let jobs: Vec<_> = engine.jobs.list().into_iter().filter(api_job).collect();
    Ok(Json(
        json!({"enabled":config["api_access"]["key_hash"].as_str().is_some(),"total":jobs.len(),"completed":jobs.iter().filter(|job|job.status == JobStatus::Done).count(),"active":jobs.iter().filter(|job|job.active()).count(),"failed":jobs.iter().filter(|job|job.status == JobStatus::Error).count(),"jobs":jobs.iter().take(10).map(|job|job.public_value(Some(10))).collect::<Vec<_>>(),"models":model_catalog(&engine).await.map_err(processing_routes::Error::internal)?.iter().map(|(id,path)|json!({"id":id,"name":path.file_stem().unwrap_or_default().to_string_lossy()})).collect::<Vec<_>>()}),
    ))
}
async fn create_key(
    State(engine): State<Arc<NativeEngine>>,
) -> Result<Json<Value>, processing_routes::Error> {
    let key = format!(
        "applio_{}",
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(crate::bridge_sessions::random::<32>()?)
    );
    engine.runtime.config.modify(|config| {
        config["api_access"] = json!({"key_hash":digest(&key)});
        Ok(())
    })?;
    Ok(Json(json!({"key":key})))
}
async fn revoke_key(
    State(engine): State<Arc<NativeEngine>>,
) -> Result<Json<Value>, processing_routes::Error> {
    engine.runtime.config.modify(|config| {
        if let Some(object) = config.as_object_mut() {
            object.remove("api_access");
        }
        Ok(())
    })?;
    Ok(Json(json!({"ok":true})))
}
async fn model_catalog(engine: &NativeEngine) -> anyhow::Result<Vec<(String, PathBuf)>> {
    let runtime = engine.runtime.clone();
    tokio::task::spawn_blocking(move || {
        Ok(super::model_routes::scan(&runtime.logs)?
            .0
            .into_iter()
            .map(|path| {
                let id = format!("applio-{}", &digest(&runtime.model_relative(&path))[..24]);
                (id, path)
            })
            .collect())
    })
    .await?
}

async fn models(State(engine): State<Arc<NativeEngine>>) -> Response {
    match model_catalog(&engine).await {
        Ok(models) => Json(json!({"object":"list","data":models.iter().map(|(id,_)|json!({"id":id,"object":"model","created":0,"owned_by":"applio"})).collect::<Vec<_>>()})).into_response(),
        Err(_) => failure(StatusCode::INTERNAL_SERVER_ERROR, "Could not list installed models.", None),
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Speech {
    model: String,
    input: String,
    voice: String,
    #[serde(default = "default_format")]
    response_format: String,
    #[serde(default = "default_speed")]
    speed: f64,
    #[serde(default)]
    instructions: Option<String>,
    #[serde(default)]
    stream_format: Option<String>,
}
fn default_format() -> String {
    "mp3".into()
}
fn default_speed() -> f64 {
    1.0
}
fn speech_params(
    body: &Speech,
    path: &std::path::Path,
) -> Result<Value, (&'static str, &'static str)> {
    if body.input.trim().is_empty() || body.input.chars().count() > 4096 {
        return Err(("Input must contain 1–4096 characters.", "input"));
    }
    if !matches!(body.response_format.as_str(), "mp3" | "wav" | "flac") {
        return Err((
            "Supported formats are mp3, wav and flac.",
            "response_format",
        ));
    }
    if !body.speed.is_finite() || !(0.25..=2.0).contains(&body.speed) {
        return Err(("Supported speed range is 0.25–2.0.", "speed"));
    }
    if body
        .instructions
        .as_ref()
        .is_some_and(|value| !value.is_empty())
    {
        return Err((
            "Instructions are not supported by this speech engine.",
            "instructions",
        ));
    }
    if body
        .stream_format
        .as_deref()
        .is_some_and(|value| value != "audio")
    {
        return Err((
            "Only the audio stream format is supported.",
            "stream_format",
        ));
    }
    Ok(
        json!({"pthPath":path,"inferenceEngine":if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("onnx")) {"onnx"} else {"torch"},"ttsText":body.input,"ttsVoice":body.voice,"ttsRate":((body.speed-1.0)*100.0).round() as i64,"exportFormat":body.response_format.to_uppercase()}),
    )
}
struct Waiting {
    engine: Arc<NativeEngine>,
    id: String,
}
impl Drop for Waiting {
    fn drop(&mut self) {
        if self
            .engine
            .jobs
            .get(&self.id)
            .is_some_and(|job| job.active())
        {
            self.engine.jobs.cancel(&self.id, "API request ended");
        }
    }
}
async fn speech(State(engine): State<Arc<NativeEngine>>, request: Request) -> Response {
    let bytes = match axum::body::to_bytes(request.into_body(), 64 * 1024).await {
        Ok(bytes) => bytes,
        Err(_) => {
            return failure(
                StatusCode::PAYLOAD_TOO_LARGE,
                "Speech request exceeds 64 KiB.",
                None,
            )
        }
    };
    let body: Speech = match serde_json::from_slice(&bytes) {
        Ok(body) => body,
        Err(_) => {
            return failure(
                StatusCode::BAD_REQUEST,
                "Invalid speech request. Provide model, input and voice.",
                None,
            )
        }
    };
    let catalog = match model_catalog(&engine).await {
        Ok(catalog) => catalog,
        Err(_) => {
            return failure(
                StatusCode::INTERNAL_SERVER_ERROR,
                "Could not list installed models.",
                None,
            )
        }
    };
    let Some((_, path)) = catalog.iter().find(|(id, _)| id == &body.model) else {
        return failure(
            StatusCode::NOT_FOUND,
            "Choose an installed model ID from /v1/models.",
            Some("model"),
        );
    };
    let params = match speech_params(&body, path) {
        Ok(params) => params,
        Err((message, param)) => return failure(StatusCode::BAD_REQUEST, message, Some(param)),
    };
    let voices = match std::fs::read(engine.runtime.backend.join("rvc/lib/tools/tts_voices.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
    {
        Some(voices) => voices,
        None => {
            return failure(
                StatusCode::SERVICE_UNAVAILABLE,
                "Voice catalog unavailable.",
                None,
            )
        }
    };
    if !voices
        .as_array()
        .is_some_and(|voices| voices.iter().any(|voice| voice["ShortName"] == body.voice))
    {
        return failure(
            StatusCode::BAD_REQUEST,
            "Choose a voice shortName from /api/tts/voices.",
            Some("voice"),
        );
    }
    let mut native = Request::builder()
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(params.to_string()))
        .unwrap();
    native.extensions_mut().insert(ApiCall);
    let accepted = match processing_routes::tts(State(engine.clone()), native).await {
        Ok((_, Json(accepted))) => accepted,
        Err(error) => return native_error(error),
    };
    let id = accepted["jobId"].as_str().unwrap().to_owned();
    let _waiting = Waiting {
        engine: engine.clone(),
        id: id.clone(),
    };
    let Some((_, mut events)) = engine.jobs.subscribe_job(&id) else {
        return failure(
            StatusCode::INTERNAL_SERVER_ERROR,
            "Speech job unavailable.",
            None,
        );
    };
    let shutdown = engine.cancellation_token();
    let wait = async {
        loop {
            let Some(job) = engine.jobs.get(&id) else {
                return failure(StatusCode::NOT_FOUND, "Speech job unavailable.", None);
            };
            if job.status == JobStatus::Done {
                return output_response(&engine, &job).await;
            }
            if job.status == JobStatus::Error {
                return failure(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    job.error.as_deref().unwrap_or("Speech generation failed."),
                    None,
                );
            }
            tokio::select! {
                _ = shutdown.cancelled() => return failure(StatusCode::SERVICE_UNAVAILABLE, "Applio is shutting down.", None),
                _ = events.recv() => {},
                _ = tokio::time::sleep(Duration::from_secs(1)) => {},
            }
        }
    };
    tokio::time::timeout(Duration::from_secs(600), wait)
        .await
        .unwrap_or_else(|_| {
            failure(
                StatusCode::GATEWAY_TIMEOUT,
                "Speech generation timed out. Use asynchronous conversion jobs for long workflows.",
                None,
            )
        })
}
async fn conversion(State(engine): State<Arc<NativeEngine>>, request: Request) -> Response {
    let mut input =
        match uploads::parse(request, &engine.runtime.uploads, &uploads::audio_rule()).await {
            Ok(input) => input,
            Err(error) => return failure(StatusCode::BAD_REQUEST, &error.to_string(), None),
        };
    if let Some(model) = input.body.get("model") {
        let Some(model) = model.as_str() else {
            return failure(
                StatusCode::BAD_REQUEST,
                "Model must be an installed model ID.",
                Some("model"),
            );
        };
        if input.body.get("pthPath").is_some() {
            return failure(
                StatusCode::BAD_REQUEST,
                "Provide model or pthPath, not both.",
                Some("model"),
            );
        }
        let catalog = match model_catalog(&engine).await {
            Ok(catalog) => catalog,
            Err(_) => {
                return failure(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Could not list installed models.",
                    None,
                )
            }
        };
        let Some((_, path)) = catalog.iter().find(|(id, _)| id == model) else {
            return failure(
                StatusCode::NOT_FOUND,
                "Choose an installed model ID from /v1/models.",
                Some("model"),
            );
        };
        input.body["pthPath"] = json!(path);
        if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("onnx"))
        {
            input.body["inferenceEngine"] = json!("onnx");
        }
    }
    if let Some(audio) = input.file("audio").map(std::path::Path::to_path_buf) {
        input.body["inputPath"] = json!(audio);
    }
    let mut native = Request::builder()
        .method("POST")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(input.body.to_string()))
        .unwrap();
    native.extensions_mut().insert(ApiCall);
    match processing_routes::inference(State(engine), native).await {
        Ok(accepted) => {
            input.retain();
            accepted.into_response()
        }
        Err(error) => native_error(error),
    }
}
fn find_job(engine: &NativeEngine, id: &str) -> Option<Job> {
    engine.jobs.get(id).filter(api_job)
}
async fn job(State(engine): State<Arc<NativeEngine>>, Path(id): Path<String>) -> Response {
    match find_job(&engine, &id) {
        Some(job) => Json(json!({"job":job.public_value(Some(20))})).into_response(),
        None => failure(StatusCode::NOT_FOUND, "API job not found.", None),
    }
}
async fn cancel(State(engine): State<Arc<NativeEngine>>, Path(id): Path<String>) -> Response {
    if find_job(&engine, &id).is_none() {
        return failure(StatusCode::NOT_FOUND, "API job not found.", None);
    }
    engine.jobs.cancel(&id, "Stopped by user");
    Json(json!({"ok":true})).into_response()
}
async fn content(State(engine): State<Arc<NativeEngine>>, Path(id): Path<String>) -> Response {
    match find_job(&engine, &id) {
        Some(job) if job.status == JobStatus::Done => output_response(&engine, &job).await,
        Some(_) => failure(
            StatusCode::CONFLICT,
            "Wait for the job to complete before downloading.",
            None,
        ),
        None => failure(StatusCode::NOT_FOUND, "API job not found.", None),
    }
}
async fn output_response(engine: &NativeEngine, job: &Job) -> Response {
    let path = job
        .output_file
        .as_ref()
        .and_then(|path| std::fs::canonicalize(engine.runtime.data.join(path)).ok());
    let root = std::fs::canonicalize(&engine.runtime.outputs).ok();
    let Some(path) = path
        .filter(|path| root.as_ref().is_some_and(|root| path.starts_with(root)) && path.is_file())
    else {
        return failure(
            StatusCode::NOT_FOUND,
            "Output audio is no longer available.",
            None,
        );
    };
    let mut response = ServeFile::new(&path)
        .oneshot(Request::builder().body(Body::empty()).unwrap())
        .await
        .unwrap()
        .into_response();
    response.headers_mut().insert(
        header::CONTENT_DISPOSITION,
        uploads::attachment(path.file_name().unwrap()),
    );
    response
        .headers_mut()
        .insert("x-applio-job-id", job.id.parse().unwrap());
    response
}

fn schema() -> Value {
    let mut schema = json!({"openapi":"3.1.0","info":{"title":"Applio Workflow API","version":"1.0.0","description":"OpenAI-compatible model listing and synchronous speech; Full native application workflows under /v1/applio. Loopback only. Native jobs support SSE and realtime uses WebSockets; speech SSE, chat and transcription are not supported."},"servers":[{"url":"/"}],"security":[{"bearerAuth":[]}],"components":{"securitySchemes":{"bearerAuth":{"type":"http","scheme":"bearer"}},"schemas":{"Speech":{"type":"object","additionalProperties":false,"required":["model","input","voice"],"properties":{"model":{"type":"string"},"input":{"type":"string","minLength":1,"maxLength":4096},"voice":{"type":"string"},"response_format":{"type":"string","enum":["mp3","wav","flac"],"default":"mp3"},"speed":{"type":"number","minimum":0.25,"maximum":2,"default":1},"stream_format":{"type":"string","enum":["audio"]}}}}},"paths":{
        "/v1/models":{"get":{"summary":"List installed voice models","responses":{"200":{"description":"OpenAI model list"}}}},
        "/v1/audio/speech":{"post":{"summary":"Generate speech and wait for audio (up to 600 seconds)","requestBody":{"required":true,"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Speech"}}}},"responses":{"200":{"description":"Audio bytes","content":{"audio/mpeg":{},"audio/wav":{},"audio/flac":{}}},"400":{"description":"Invalid or unsupported parameter"},"401":{"description":"Invalid key"},"504":{"description":"Timed out; job cancelled"}}}},
        "/v1/audio/conversions":{"post":{"summary":"Submit native conversion parameters and an audio upload","requestBody":{"required":true,"content":{"multipart/form-data":{"schema":{"type":"object","required":["audio"],"oneOf":[{"required":["model"]},{"required":["pthPath"]}],"properties":{"model":{"type":"string","description":"Installed model ID from /v1/models"},"audio":{"type":"string","format":"binary"},"pthPath":{"type":"string"},"pitch":{"type":"integer","minimum":-24,"maximum":24},"exportFormat":{"type":"string","enum":["WAV","MP3","FLAC","OGG","M4A"]}}}}}},"responses":{"202":{"description":"Queued, returns jobId; poll /v1/jobs/{id}"}}}},
        "/v1/jobs/{id}":{"get":{"summary":"Read API job status","parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string"}}],"responses":{"200":{"description":"Native job status, progress, logs and output"}}}},
        "/v1/jobs/{id}/content":{"get":{"summary":"Download completed output","parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string"}}],"responses":{"200":{"description":"Audio bytes"},"409":{"description":"Still processing"}}}},
        "/v1/jobs/{id}/cancel":{"post":{"summary":"Cancel queued or running work","parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string"}}],"responses":{"200":{"description":"Cancellation requested"}}}}
    }});
    super::integration_catalog::add_openapi(&mut schema);
    schema["paths"]["/v1/capabilities"] = json!({"get":{"summary":"Full native API catalog and parameters","responses":{"200":{"description":"Operation catalog"}}}});
    schema["paths"]["/v1/jobs/{id}/artifacts"] = json!({"get":{"summary":"List a completed API job’s output artifacts","parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string"}}],"responses":{"200":{"description":"Artifacts with name, size and authenticated URL"}}}});
    schema["paths"]["/v1/jobs/{id}/artifacts/{index}"] = json!({"get":{"summary":"Download an API job artifact","parameters":[{"name":"id","in":"path","required":true,"schema":{"type":"string"}},{"name":"index","in":"path","required":true,"schema":{"type":"integer","minimum":0}}],"responses":{"200":{"description":"Artifact bytes"}}}});
    schema
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn payload(response: Response) -> Value {
        serde_json::from_slice(
            &axum::body::to_bytes(response.into_body(), 1024 * 1024)
                .await
                .unwrap(),
        )
        .unwrap()
    }
    #[tokio::test]
    async fn authenticated_workflows_reuse_native_jobs_and_contracts_without_ml() {
        let root = tempfile::tempdir().unwrap();
        for (name, value) in [
            ("assets/config_template.json", "{}"),
            ("backend/applio/rvc/configs/config.py", ""),
            (
                "backend/applio/rvc/lib/tools/tts_voices.json",
                r#"[{"ShortName":"en-US-AriaNeural"}]"#,
            ),
        ] {
            let path = root.path().join(name);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, value).unwrap();
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
        // A protocol stand-in exercises admission, scheduling, output handling
        // and cancellation without importing ML packages or downloading models.
        let worker = root.path().join("backend/python/inference/runtime.py");
        std::fs::create_dir_all(worker.parent().unwrap()).unwrap();
        std::fs::write(&worker, r#"
import json, os, sys, time, wave
from pathlib import Path
print(json.dumps({'_applio_ipc':True,'type':'ready'}), flush=True)
for line in sys.stdin:
    request = json.loads(line)
    if request.get('ttsText') == 'cancel-this-request':
        time.sleep(30)
    if request.get('command') == 'model_blender':
        assert request['ratio'] == 0.25
        assert Path(request['pth1']).is_file() and Path(request['pth2']).is_file()
        destination = Path(os.environ['APPLIO_LOGS_DIR']) / (request['modelName'] + '.pth')
        destination.write_bytes(b'fixture-model')
        print(json.dumps({'_applio_ipc':True,'type':'done','id':request['id'],'file':str(destination),'message':'Blended'}), flush=True)
        continue
    if request.get('inputPath'):
        assert Path(request['inputPath']).read_bytes().startswith(b'RIFF')
    destination = Path(request.get('outputRvcPath') or request['outputPath'])
    destination.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(destination), 'wb') as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(16000)
        audio.writeframes(b'\0\0' * 160)
    print(json.dumps({'_applio_ipc':True,'type':'done','id':request['id'],'outputPath':str(destination),'outputRvcPath':str(destination)}), flush=True)
"#).unwrap();
        let download_script = root.path().join("backend/python/downloads/model.py");
        std::fs::create_dir_all(download_script.parent().unwrap()).unwrap();
        std::fs::write(
            download_script,
            r#"
import os
from pathlib import Path
root = Path(os.environ['APPLIO_LOGS_DIR']) / 'downloaded'
root.mkdir(exist_ok=True)
(root / 'downloaded.pth').write_bytes(b'fixture-download')
print('Model downloaded successfully.')
"#,
        )
        .unwrap();
        std::fs::write(
            runtime.logs.join("test.pth"),
            b"not loaded during API discovery",
        )
        .unwrap();
        let readiness = Arc::new(crate::engine::RuntimeReadiness::new(runtime.clone(), true));
        let engine = NativeEngine::open_with_options(
            runtime,
            readiness,
            crate::engine::EngineOptions {
                no_env: true,
                ..Default::default()
            },
        )
        .unwrap();
        let app = router(
            engine.clone(),
            super::super::native::operation_routes(config.clone(), engine.clone()),
        );
        let request = |method: &str, path: &str, key: Option<&str>, body: Value| {
            let mut request = Request::builder()
                .method(method)
                .uri(path)
                .header(header::CONTENT_TYPE, "application/json");
            if let Some(key) = key {
                request = request.header(header::AUTHORIZATION, format!("Bearer {key}"));
            }
            request.body(Body::from(body.to_string())).unwrap()
        };
        let response = app
            .clone()
            .oneshot(request("GET", "/v1/models", None, Value::Null))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert!(payload(response).await["error"]["message"].is_string());
        let response = app
            .clone()
            .oneshot(request("POST", "/api/integrations/key", None, Value::Null))
            .await
            .unwrap();
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let first = payload(response).await["key"].as_str().unwrap().to_owned();
        assert!(!engine
            .runtime
            .config
            .load()
            .unwrap()
            .to_string()
            .contains(&first));
        let response = app
            .clone()
            .oneshot(request("GET", "/v1/models", Some(&first), Value::Null))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let id = payload(response).await["data"][0]["id"]
            .as_str()
            .unwrap()
            .to_owned();
        let response = app
            .clone()
            .oneshot(request(
                "POST",
                "/v1/audio/speech",
                Some(&first),
                json!({"model":id,"input":"hello","voice":"en-US-AriaNeural","speed":4}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        assert_eq!(payload(response).await["error"]["param"], "speed");
        let response = tokio::time::timeout(Duration::from_secs(15), app.clone().oneshot(request(
            "POST", "/v1/audio/speech", Some(&first),
            json!({"model":id,"input":"hello","voice":"en-US-AriaNeural","response_format":"wav"}),
        ))).await.unwrap().unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let speech_id = response.headers()["x-applio-job-id"]
            .to_str()
            .unwrap()
            .to_owned();
        let audio = axum::body::to_bytes(response.into_body(), 1024 * 1024)
            .await
            .unwrap();
        assert!(audio.starts_with(b"RIFF"));
        assert_eq!(engine.jobs.get(&speech_id).unwrap().status, JobStatus::Done);
        let response = app
            .clone()
            .oneshot(request(
                "GET",
                &format!("/v1/jobs/{speech_id}/content"),
                Some(&first),
                Value::Null,
            ))
            .await
            .unwrap();
        assert_eq!(
            axum::body::to_bytes(response.into_body(), 1024 * 1024)
                .await
                .unwrap(),
            audio
        );
        let mut outside = engine.jobs.get(&speech_id).unwrap();
        outside.output_file = Some(
            engine
                .runtime
                .config_dir
                .join("config.json")
                .to_string_lossy()
                .into_owned(),
        );
        assert_eq!(
            output_response(&engine, &outside).await.status(),
            StatusCode::NOT_FOUND
        );
        let native_job = engine
            .jobs
            .create(crate::jobs::JobType::Other, json!({}))
            .unwrap();
        assert_eq!(
            app.clone()
                .oneshot(request(
                    "GET",
                    &format!("/v1/jobs/{}", native_job.id),
                    Some(&first),
                    Value::Null
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::NOT_FOUND
        );
        let boundary = "applio-api-workflow";
        let mut multipart = format!("--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{id}\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"exportFormat\"\r\n\r\nWAV\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"input.wav\"\r\nContent-Type: audio/wav\r\n\r\n").into_bytes();
        multipart.extend_from_slice(&audio);
        multipart.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/audio/conversions")
                    .header(header::AUTHORIZATION, format!("Bearer {first}"))
                    .header(
                        header::CONTENT_TYPE,
                        format!("multipart/form-data; boundary={boundary}"),
                    )
                    .body(Body::from(multipart))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let conversion_id = payload(response).await["jobId"]
            .as_str()
            .unwrap()
            .to_owned();
        tokio::time::timeout(Duration::from_secs(15), async {
            while engine.jobs.get(&conversion_id).unwrap().active() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            engine.jobs.get(&conversion_id).unwrap().status,
            JobStatus::Done
        );
        let response = app
            .clone()
            .oneshot(request(
                "GET",
                &format!("/v1/jobs/{conversion_id}"),
                Some(&first),
                Value::Null,
            ))
            .await
            .unwrap();
        assert_eq!(payload(response).await["job"]["status"], "done");
        async fn completed(engine: &NativeEngine, id: &str) -> Job {
            tokio::time::timeout(Duration::from_secs(15), async {
                loop {
                    let job = engine.jobs.get(id).unwrap();
                    if !job.active() {
                        return job;
                    }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .unwrap()
        }
        for path in [
            "/v1/capabilities",
            "/v1/applio/models",
            "/v1/applio/tts/voices",
            "/v1/applio/train/datasets",
            "/v1/applio/jobs",
            "/v1/applio/setup/status",
            "/v1/applio/settings",
        ] {
            assert_eq!(
                app.clone()
                    .oneshot(request("GET", path, None, Value::Null))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::UNAUTHORIZED,
                "{path}"
            );
            let response = app
                .clone()
                .oneshot(request("GET", path, Some(&first), Value::Null))
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
        }
        assert_eq!(
            app.clone()
                .oneshot(request(
                    "PUT",
                    "/v1/applio/settings",
                    Some(&first),
                    json!({"model_author":"API author"})
                ))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        assert_eq!(
            engine.runtime.config.load().unwrap()["model_author"],
            "API author"
        );
        for path in [
            "/v1/applio/integrations/key",
            "/v1/applio/outputs/private",
            "/v1/applio/settings/%2e%2e/integrations/key",
        ] {
            assert_eq!(
                app.clone()
                    .oneshot(request("POST", path, Some(&first), json!({})))
                    .await
                    .unwrap()
                    .status(),
                StatusCode::NOT_FOUND,
                "{path}"
            );
        }
        assert!(!crate::bridge_policy::api_allowed(
            "POST",
            "/v1/applio/download"
        ));
        let response = app
            .clone()
            .oneshot(request(
                "POST",
                "/v1/applio/download",
                Some(&first),
                json!({"modelLink":"file:///private"}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let response = app
            .clone()
            .oneshot(request(
                "POST",
                "/v1/applio/download",
                Some(&first),
                json!({"modelLink":"https://example.invalid/model.zip"}),
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let download_id = payload(response).await["jobId"]
            .as_str()
            .unwrap()
            .to_owned();
        let download = completed(&engine, &download_id).await;
        assert_eq!(download.status, JobStatus::Done, "{:?}", download.error);
        assert!(api_job(&download));
        let response = app.clone().oneshot(request("POST", "/v1/applio/voice-blender", Some(&first), json!({"modelName":"api-fusion", "pthPath1":"logs/test.pth", "pthPath2":"logs/test.pth", "ratio":0.25}))).await.unwrap();
        assert_eq!(response.status(), StatusCode::ACCEPTED);
        let blend_id = payload(response).await["jobId"]
            .as_str()
            .unwrap()
            .to_owned();
        let blend = completed(&engine, &blend_id).await;
        assert_eq!(blend.status, JobStatus::Done, "{:?}", blend.error);
        assert!(api_job(&blend));
        let response = app
            .clone()
            .oneshot(request(
                "GET",
                &format!("/v1/applio/jobs/{blend_id}"),
                Some(&first),
                Value::Null,
            ))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "native path parameters survive dispatch"
        );
        assert_eq!(payload(response).await["job"]["id"], blend_id);
        let response = app
            .clone()
            .oneshot(request(
                "GET",
                &format!("/v1/applio/jobs/{blend_id}/events"),
                Some(&first),
                Value::Null,
            ))
            .await
            .unwrap();
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/event-stream"
        );
        let events = axum::body::to_bytes(response.into_body(), 65536)
            .await
            .unwrap();
        assert!(String::from_utf8_lossy(&events).contains("done"));
        let response = app
            .clone()
            .oneshot(request(
                "GET",
                &format!("/v1/jobs/{blend_id}/artifacts"),
                Some(&first),
                Value::Null,
            ))
            .await
            .unwrap();
        let artifacts = payload(response).await;
        assert_eq!(artifacts["artifacts"][0]["name"], "api-fusion.pth");
        let file_url = artifacts["artifacts"][0]["url"].as_str().unwrap();
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri(file_url)
                    .header(header::AUTHORIZATION, format!("Bearer {first}"))
                    .header(header::RANGE, "bytes=0-3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            axum::body::to_bytes(response.into_body(), 1024)
                .await
                .unwrap(),
            "fixt"
        );
        assert_eq!(
            app.clone()
                .oneshot(request("GET", file_url, None, Value::Null))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        let response = app
            .clone()
            .oneshot(request(
                "DELETE",
                "/v1/applio/models/logs%2Fdownloaded%2Fdownloaded.pth",
                Some(&first),
                Value::Null,
            ))
            .await
            .unwrap();
        assert_eq!(
            response.status(),
            StatusCode::OK,
            "encoded model paths stay native path parameters"
        );
        assert!(!engine
            .runtime
            .logs
            .join("downloaded/downloaded.pth")
            .exists());
        // A real HTTP upgrade checks that in-process routing retains OnUpgrade.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let socket_app = app.clone();
        let server = tokio::spawn(async move {
            axum::serve(listener, socket_app).await.unwrap();
        });
        for (credential, expected) in [
            (None, StatusCode::UNAUTHORIZED),
            (Some(&first), StatusCode::BAD_GATEWAY),
        ] {
            use tokio_tungstenite::tungstenite::client::IntoClientRequest;
            let mut handshake = format!("ws://{address}/v1/applio/realtime/ws-audio")
                .into_client_request()
                .unwrap();
            if let Some(key) = credential {
                handshake.headers_mut().insert(
                    header::AUTHORIZATION,
                    format!("Bearer {key}").parse().unwrap(),
                );
            }
            let response = tokio_tungstenite::connect_async(handshake).await;
            match response {
                Err(tokio_tungstenite::tungstenite::Error::Http(response)) => {
                    assert_eq!(response.status(), expected)
                }
                other => panic!("Unexpected WebSocket response: {other:?}"),
            }
        }
        server.abort();
        let _ = server.await;
        let mut forged = blend.clone();
        forged.output_file = Some(
            engine
                .runtime
                .config_dir
                .join("config.json")
                .to_string_lossy()
                .into_owned(),
        );
        forged.result = Some(json!({"file":engine.runtime.config_dir.join("config.json")}));
        assert!(artifact_paths(&engine, &forged).is_empty());
        let audio_dir = engine.runtime.data.join("assets/audios");
        std::fs::create_dir_all(&audio_dir).unwrap();
        std::fs::write(audio_dir.join("downloaded.wav"), &audio).unwrap();
        forged.output_file = Some("assets/audios/downloaded.wav".into());
        forged.result = None;
        assert_eq!(artifact_paths(&engine, &forged).len(), 1);
        std::fs::write(audio_dir.join("private.json"), b"private").unwrap();
        forged.output_file = Some("assets/audios/private.json".into());
        assert!(artifact_paths(&engine, &forged).is_empty());
        let pending = tokio::spawn(app.clone().oneshot(request("POST", "/v1/audio/speech", Some(&first),json!({"model":id,"input":"cancel-this-request","voice":"en-US-AriaNeural","response_format":"wav"}))));
        let cancelled_id = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Some(job) = engine.jobs.list().into_iter().find(|job| {
                    job.params
                        .as_ref()
                        .is_some_and(|params| params["ttsText"] == "cancel-this-request")
                }) {
                    break job.id;
                }
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        pending.abort();
        let _ = pending.await;
        tokio::time::timeout(Duration::from_secs(10), async {
            while engine.jobs.get(&cancelled_id).unwrap().active() || engine.scheduler.gpu_busy() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(
            engine.jobs.get(&cancelled_id).unwrap().status,
            JobStatus::Error
        );
        let response = app
            .clone()
            .oneshot(request(
                "GET",
                "/v1/openapi.json",
                Some(&first),
                Value::Null,
            ))
            .await
            .unwrap();
        assert!(payload(response).await["paths"]["/v1/audio/conversions"].is_object());
        let response = app
            .clone()
            .oneshot(request("POST", "/api/integrations/key", None, Value::Null))
            .await
            .unwrap();
        let second = payload(response).await["key"].as_str().unwrap().to_owned();
        assert_ne!(first, second);
        assert_eq!(
            app.clone()
                .oneshot(request("GET", "/v1/models", Some(&first), Value::Null))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        assert_eq!(
            app.clone()
                .oneshot(request("GET", "/v1/models", Some(&second), Value::Null))
                .await
                .unwrap()
                .status(),
            StatusCode::OK
        );
        app.clone()
            .oneshot(request(
                "DELETE",
                "/api/integrations/key",
                None,
                Value::Null,
            ))
            .await
            .unwrap();
        assert_eq!(
            app.oneshot(request("GET", "/v1/models", Some(&second), Value::Null))
                .await
                .unwrap()
                .status(),
            StatusCode::UNAUTHORIZED
        );
        engine.shutdown().await.unwrap();
    }
    #[test]
    fn keys_fail_closed_and_never_accept_the_stored_hash_as_a_credential() {
        let mut headers = HeaderMap::new();
        let hash = digest("applio-secret");
        assert!(!valid_key(&headers, Some(&hash)));
        headers.insert(
            header::AUTHORIZATION,
            "Bearer applio-secret".parse().unwrap(),
        );
        assert!(valid_key(&headers, Some(&hash)));
        assert!(!valid_key(&headers, None));
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {hash}").parse().unwrap(),
        );
        assert!(!valid_key(&headers, Some(&hash)));
    }
    #[test]
    fn speech_contract_maps_native_units_and_rejects_unsupported_features() {
        let mut body: Speech = serde_json::from_value(
            json!({"model":"test","input":"Hello","voice":"en-US-AriaNeural","speed":1.5}),
        )
        .unwrap();
        let params = speech_params(&body, std::path::Path::new("voice.pth")).unwrap();
        assert_eq!(params["ttsRate"], 50);
        assert_eq!(params["exportFormat"], "MP3");
        body.speed = 4.0;
        assert_eq!(
            speech_params(&body, std::path::Path::new("voice.pth"))
                .unwrap_err()
                .1,
            "speed"
        );
        body.speed = 1.0;
        body.response_format = "pcm".into();
        assert!(speech_params(&body, std::path::Path::new("voice.pth")).is_err());
        body.response_format = "wav".into();
        body.input = "x".repeat(4097);
        assert!(speech_params(&body, std::path::Path::new("voice.pth")).is_err());
        assert!(schema()["paths"]["/v1/audio/speech"].is_object());
    }
}
