use crate::{engine::NativeEngine, process::ManagedProcess, processing_routes::Error};
use anyhow::{Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    http::StatusCode,
    routing::{get, post},
    Json, Router,
};
use base64::Engine;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    sync::{Arc, OnceLock},
    time::Duration,
};
use sysinfo::System;
use tokio::io::AsyncWriteExt;
use uuid::Uuid;
const MAX_CLIP: usize = 200 * 1024 * 1024;
struct Reports {
    engine: Arc<NativeEngine>,
    python: tokio::sync::Mutex<Option<String>>,
}
pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/report/info", get(info))
        .route("/api/report/upload", post(upload))
        .route("/api/diagnostics", get(diagnostics))
        .layer(DefaultBodyLimit::disable())
        .with_state(Arc::new(Reports {
            engine,
            python: tokio::sync::Mutex::new(None),
        }))
}
fn issue_url(engine: &NativeEngine) -> Result<String> {
    let identity: Value = serde_json::from_slice(&std::fs::read(
        engine.runtime.code.join("assets/ecosystem.json"),
    )?)?;
    Ok(format!(
        "{}/new",
        identity["projects"]["desktop"]["issues"]
            .as_str()
            .context("Missing desktop issue URL")?
            .trim_end_matches('/')
    ))
}
async fn probe(engine: &NativeEngine, args: &[&str]) -> Result<String> {
    let command = engine.runtime.python_command(args.iter().copied())?;
    let token = engine.cancellation_token();
    let output = tokio::time::timeout(
        Duration::from_secs(60),
        ManagedProcess::run(&command, &token, |_, _| {}),
    )
    .await
    .context("Python diagnostics timed out")??;
    Ok(format!("{}{}", output.stdout, output.stderr)
        .trim()
        .to_owned())
}
async fn info(State(state): State<Arc<Reports>>) -> Result<Json<Value>, Error> {
    let engine = &state.engine;
    let mut cached = state.python.lock().await;
    if cached.is_none() {
        if let Ok(version) = probe(engine, &["--version"]).await {
            *cached = Some(version);
        }
    }
    let python = cached.clone().unwrap_or_default();
    drop(cached);
    let code = engine.runtime.code.clone();
    let backend = tokio::fs::read(code.join("backend/revision.json"))
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .and_then(|v| v["commit"].as_str().map(str::to_owned))
        .unwrap_or_else(|| "unknown".into());
    static SYSTEM: OnceLock<Value> = OnceLock::new();
    let system=tokio::task::spawn_blocking(||SYSTEM.get_or_init(|| {
        let mut system=System::new();system.refresh_memory();
        json!({"platform":format!("{} {} ({})",std::env::consts::OS,System::kernel_version().unwrap_or_else(||"unknown".into()),std::env::consts::ARCH),"cpus":std::thread::available_parallelism().map_or(1,usize::from),"totalMemGB":(system.total_memory() as f64 / 1024_f64.powi(3)).round() as u64})
    }).clone()).await.map_err(Error::internal)?;
    Ok(Json(
        json!({"app":"Applio","version":env!("CARGO_PKG_VERSION"),"backendRevision":backend,"scheduling":engine.scheduler.status(),"platform":system["platform"],"runtime":"Rust / Axum","python":python,"cpus":system["cpus"],"totalMemGB":system["totalMemGB"],"issueUrl":issue_url(engine).map_err(Error::internal)?,"time":crate::jobs::timestamp()}),
    ))
}
async fn diagnostics(State(state): State<Arc<Reports>>) -> Result<Json<Value>, Error> {
    let python = probe(&state.engine, &["--version"])
        .await
        .map_err(Error::internal)?;
    let torch = probe(
        &state.engine,
        &["-c", "import torch; print(torch.__version__)"],
    )
    .await
    .unwrap_or_else(|error| error.to_string());
    Ok(Json(
        json!({"pythonVersion":python,"torchVersion":torch,"repoRoot":state.engine.runtime.data}),
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Clip {
    data_url: String,
}
struct Staging(std::path::PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        crate::uploads::active_uploads().remove(&self.0);
        let _ = std::fs::remove_file(&self.0);
    }
}
async fn upload(State(state): State<Arc<Reports>>, request: Request) -> Result<Json<Value>, Error> {
    let bytes = axum::body::to_bytes(request.into_body(), MAX_CLIP + 256)
        .await
        .map_err(|_| {
            Error(
                StatusCode::PAYLOAD_TOO_LARGE,
                json!({"error":"Clip too large (200MB max)"}),
            )
        })?;
    let clip: Clip = serde_json::from_slice(&bytes)
        .map_err(|_| Error::input("dataUrl must be a data:video/* URL"))?;
    drop(bytes);
    let data = clip
        .data_url
        .strip_prefix("data:video/")
        .ok_or_else(|| Error::input("dataUrl must be a data:video/* URL"))?;
    let (mime, encoded) = data
        .split_once(";base64,")
        .ok_or_else(|| Error::input("Malformed data URL"))?;
    if mime.is_empty()
        || !mime
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '+' | '-'))
        || encoded.is_empty()
    {
        return Err(Error::input("Malformed data URL"));
    }
    if encoded.len() > MAX_CLIP {
        return Err(Error(
            StatusCode::PAYLOAD_TOO_LARGE,
            json!({"error":"Clip too large (200MB max)"}),
        ));
    }
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .map_err(|_| Error::input("Malformed video base64 data"))?;
    let extension = if mime.to_ascii_lowercase().contains("mp4") {
        "mp4"
    } else {
        "webm"
    };
    let engine = &state.engine;
    let issue_url = issue_url(engine).map_err(Error::internal)?;
    let target = engine.runtime.outputs.join(format!(
        "web_report_{}_{}.{}",
        chrono::Utc::now().timestamp_millis(),
        Uuid::new_v4(),
        extension
    ));
    tokio::fs::create_dir_all(&engine.runtime.outputs)
        .await
        .map_err(Error::internal)?;
    let staging = Staging(
        engine
            .runtime
            .outputs
            .join(format!(".applio-report-{}.tmp", Uuid::new_v4())),
    );
    crate::uploads::active_uploads().insert(staging.0.clone());
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&staging.0)
        .map_err(Error::internal)?;
    let mut file = tokio::fs::File::from_std(file);
    file.write_all(&decoded).await.map_err(Error::internal)?;
    file.sync_all().await.map_err(Error::internal)?;
    drop(file);
    crate::storage::replace_file(&staging.0, &target).map_err(Error::internal)?;
    Ok(Json(
        json!({"ok":true,"file":engine.runtime.repo_relative(&target),"issueUrl":issue_url}),
    ))
}
