//! Continuous loopback port ownership with orderly API generations. Restarting
//! never overlaps two GPU coordinators, and dropped host futures request cleanup.
use crate::{
    engine::{EngineOptions, NativeEngine, RuntimeReadiness},
    engine_runtime::EngineRuntime,
    ApiConfig,
};
use anyhow::Result;
use axum::serve::ListenerExt;
use std::{future::IntoFuture, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

struct EngineGuard(Arc<NativeEngine>);
impl Drop for EngineGuard {
    fn drop(&mut self) {
        if self.0.is_stopped() {
            return;
        }
        self.0.request_shutdown();
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            let engine = self.0.clone();
            runtime.spawn(async move {
                if let Err(error) = engine.shutdown().await {
                    eprintln!("Native engine cleanup failed: {error:#}");
                }
            });
        }
    }
}
pub async fn serve(
    listener: tokio::net::TcpListener,
    config: ApiConfig,
    stop: CancellationToken,
) -> Result<()> {
    serve_with_environment(listener, config, stop, Default::default()).await
}
pub async fn serve_with_environment(
    listener: tokio::net::TcpListener,
    config: ApiConfig,
    stop: CancellationToken,
    environment: crate::app_runtime::Environment,
) -> Result<()> {
    let factory_config = config.clone();
    serve_with_factory(listener, config, stop, move || {
        let runtime = EngineRuntime::with_environment(&factory_config, None, environment.clone())?;
        let no_env = runtime.env("APPLIO_NO_ENV").is_some_and(|v| v == "1");
        let readiness = Arc::new(RuntimeReadiness::new(runtime.clone(), no_env));
        NativeEngine::open_with_options(
            runtime,
            readiness,
            EngineOptions {
                no_env,
                ..Default::default()
            },
        )
    })
    .await
}
pub(crate) async fn serve_with_factory(
    listener: tokio::net::TcpListener,
    config: ApiConfig,
    stop: CancellationToken,
    mut create: impl FnMut() -> Result<Arc<NativeEngine>>,
) -> Result<()> {
    // Keep this socket reserved through shutdown and reconstruction, including
    // pending folder migrations. No unrelated app can claim the API port.
    let reserved = listener.into_std()?;
    loop {
        if stop.is_cancelled() {
            return Ok(());
        }
        let engine = create()?;
        let guard = EngineGuard(engine.clone());
        engine.start_services().await?;
        let listener = tokio::net::TcpListener::from_std(reserved.try_clone()?)?;
        let drain = CancellationToken::new();
        let restart = engine.restart_token();
        let server = axum::serve(
            listener.tap_io(|socket| {
                let _ = socket.set_nodelay(true);
            }),
            crate::native::router(config.clone(), engine.clone()),
        )
        .with_graceful_shutdown(drain.clone().cancelled_owned())
        .into_future();
        tokio::pin!(server);
        let result = tokio::select! {
            result=&mut server=>Some(result),
            _=stop.cancelled()=>None,
            _=restart.cancelled()=>None,
        };
        engine.request_shutdown();
        drain.cancel();
        engine.shutdown().await?;
        drop(guard);
        if let Some(result) = result {
            result?;
            return Ok(());
        }
        // Generation SSE and realtime sockets close with engine cancellation.
        // A stalled arbitrary HTTP client still cannot prevent a restart.
        if let Ok(result) = tokio::time::timeout(Duration::from_secs(10), &mut server).await {
            result?;
        }
        if stop.is_cancelled() {
            return Ok(());
        }
    }
}
