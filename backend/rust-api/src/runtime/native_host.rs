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
    serve_with_ui(listener, None, config, stop, environment).await
}

pub async fn serve_with_ui(
    listener: tokio::net::TcpListener,
    web_listener: Option<tokio::net::TcpListener>,
    config: ApiConfig,
    stop: CancellationToken,
    environment: crate::app_runtime::Environment,
) -> Result<()> {
    let factory_config = config.clone();
    serve_with_factory_and_ui(listener, web_listener, config, stop, move || {
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
#[cfg(test)]
pub(crate) async fn serve_with_factory(
    listener: tokio::net::TcpListener,
    config: ApiConfig,
    stop: CancellationToken,
    create: impl FnMut() -> Result<Arc<NativeEngine>>,
) -> Result<()> {
    serve_with_factory_and_ui(listener, None, config, stop, create).await
}
async fn serve_with_factory_and_ui(
    listener: tokio::net::TcpListener,
    web_listener: Option<tokio::net::TcpListener>,
    config: ApiConfig,
    stop: CancellationToken,
    mut create: impl FnMut() -> Result<Arc<NativeEngine>>,
) -> Result<()> {
    // Keep this socket reserved through shutdown and reconstruction, including
    // pending folder migrations. No unrelated app can claim the API port.
    let reserved = listener.into_std()?;
    let web_reserved = web_listener
        .map(|listener| listener.into_std())
        .transpose()?;
    if web_reserved.is_some()
        && !config
            .code_root
            .join("frontend/web/out/index.html")
            .is_file()
    {
        anyhow::bail!("Exported UI is missing. Run pnpm build:web-services first.");
    }
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
        let api = crate::native::router(config.clone(), engine.clone());
        let web_router =
            crate::web_host::router(api.clone(), config.code_root.join("frontend/web/out"));
        let web_stop = drain.clone();
        let web_listener = web_reserved
            .as_ref()
            .map(|listener| tokio::net::TcpListener::from_std(listener.try_clone()?))
            .transpose()?;
        let web = async move {
            if let Some(listener) = web_listener {
                axum::serve(
                    listener.tap_io(|socket| {
                        let _ = socket.set_nodelay(true);
                    }),
                    web_router,
                )
                .with_graceful_shutdown(web_stop.cancelled_owned())
                .await
            } else {
                std::future::pending::<std::io::Result<()>>().await
            }
        };
        tokio::pin!(web);
        let server = axum::serve(
            listener.tap_io(|socket| {
                let _ = socket.set_nodelay(true);
            }),
            api,
        )
        .with_graceful_shutdown(drain.clone().cancelled_owned())
        .into_future();
        tokio::pin!(server);
        let result = tokio::select! {
            result=&mut server=>Some(result),
            result=&mut web=>Some(result),
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
        if web_reserved.is_some() {
            if let Ok(result) = tokio::time::timeout(Duration::from_secs(10), &mut web).await {
                result?;
            }
        }
        if stop.is_cancelled() {
            return Ok(());
        }
    }
}
