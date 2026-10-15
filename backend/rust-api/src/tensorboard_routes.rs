//! TensorBoard lifecycle. A reachable port is only healthy when owned by our
//! process; a foreign listener is never adopted, restarted or terminated.
use crate::{engine::NativeEngine, processing_routes::Error, service::BackgroundService};
use anyhow::{bail, Result};
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio::sync::Mutex;
pub struct Tensorboard {
    engine: Arc<NativeEngine>,
    service: BackgroundService,
    port: u16,
    operation: Mutex<()>,
    generation: AtomicU64,
    starting: AtomicBool,
    start_timeout: Duration,
}
pub fn router(engine: Arc<NativeEngine>) -> Router {
    router_with_port(
        engine,
        std::env::var("TB_PORT")
            .ok()
            .and_then(|value| value.parse().ok())
            .unwrap_or(6007),
    )
}
pub fn router_with_port(engine: Arc<NativeEngine>, port: u16) -> Router {
    Router::new()
        .route("/api/tensorboard/status", get(status))
        .route("/api/tensorboard/start", post(start))
        .route("/api/tensorboard/restart", post(restart))
        .route("/api/tensorboard/stop", post(stop))
        .with_state(Arc::new(Tensorboard {
            engine,
            service: BackgroundService::default(),
            port,
            operation: Mutex::new(()),
            generation: AtomicU64::new(0),
            starting: AtomicBool::new(false),
            start_timeout: Duration::from_secs(20),
        }))
}
struct Starting<'a>(&'a AtomicBool);
impl Drop for Starting<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}
impl Tensorboard {
    fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
    async fn reachable(&self) -> bool {
        tokio::time::timeout(
            Duration::from_millis(1500),
            tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, self.port)),
        )
        .await
        .is_ok_and(|result| result.is_ok())
    }
    async fn stop(&self) -> Result<u64> {
        let generation = self
            .generation
            .fetch_add(1, Ordering::SeqCst)
            .wrapping_add(1);
        self.starting.store(false, Ordering::SeqCst);
        self.service.stop().await?;
        Ok(generation)
    }
    async fn start(&self, generation: u64) -> Result<Value> {
        let _operation = self.operation.lock().await;
        if self.generation.load(Ordering::SeqCst) != generation
            || self.engine.cancellation_token().is_cancelled()
        {
            bail!("TensorBoard start cancelled");
        }
        let status = self.service.status().await;
        if status.running && self.reachable().await {
            if self.generation.load(Ordering::SeqCst) != generation {
                self.service.stop().await?;
                bail!("TensorBoard start cancelled");
            }
            return Ok(json!({"ok":true,"url":self.url(),"startedAt":status.started_at}));
        }
        self.starting.store(true, Ordering::SeqCst);
        let _starting = Starting(&self.starting);
        self.service.stop().await?;
        for _ in 0..15 {
            if !self.reachable().await {
                break;
            }
            tokio::time::sleep(Duration::from_millis(200)).await;
        }
        if self.reachable().await {
            bail!(
                "TensorBoard port {} is already in use by another process",
                self.port
            );
        }
        if self.generation.load(Ordering::SeqCst) != generation {
            bail!("TensorBoard start cancelled");
        }
        let spec = self.engine.runtime.python_command([
            "-m".to_owned(),
            "tensorboard.main".into(),
            "--logdir".into(),
            self.engine.runtime.logs.to_string_lossy().into_owned(),
            "--host".into(),
            "127.0.0.1".into(),
            "--port".into(),
            self.port.to_string(),
        ])?;
        let started_at = self.service.start(&self.engine, &spec).await?;
        let deadline = tokio::time::Instant::now() + self.start_timeout;
        loop {
            if self.generation.load(Ordering::SeqCst) != generation {
                self.service.stop().await?;
                bail!("TensorBoard start cancelled");
            }
            let status = self.service.status().await;
            if !status.running {
                bail!("{}",status.error.unwrap_or_else(||"TensorBoard process exited immediately. Check logs or pip install tensorboard.".into()));
            }
            if self.reachable().await {
                if self.generation.load(Ordering::SeqCst) != generation
                    || self.engine.cancellation_token().is_cancelled()
                {
                    self.service.stop().await?;
                    bail!("TensorBoard start cancelled");
                }
                return Ok(json!({"ok":true,"url":self.url(),"startedAt":started_at}));
            }
            if tokio::time::Instant::now() >= deadline {
                self.service.stop().await?;
                bail!("TensorBoard did not come up in time.");
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
}
async fn status(State(state): State<Arc<Tensorboard>>) -> Json<Value> {
    let owned = state.service.status().await;
    Json(
        json!({"running":owned.running&&state.reachable().await,"starting":state.starting.load(Ordering::SeqCst),"url":state.url(),"startedAt":owned.started_at}),
    )
}
async fn start(State(state): State<Arc<Tensorboard>>) -> Result<Json<Value>, Error> {
    let generation = state.generation.load(Ordering::SeqCst);
    state
        .start(generation)
        .await
        .map(Json)
        .map_err(Error::internal)
}
async fn restart(State(state): State<Arc<Tensorboard>>) -> Result<Json<Value>, Error> {
    let generation = state.stop().await.map_err(Error::internal)?;
    state
        .start(generation)
        .await
        .map(Json)
        .map_err(Error::internal)
}
async fn stop(State(state): State<Arc<Tensorboard>>) -> Result<Json<Value>, Error> {
    state.stop().await.map_err(Error::internal)?;
    Ok(Json(json!({"ok":true})))
}
