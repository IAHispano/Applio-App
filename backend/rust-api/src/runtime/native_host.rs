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
        if let Some(result) = result {
            engine.shutdown().await?;
            drop(guard);
            result?;
            return Ok(());
        }
        // Keep polling both servers while shutting down the engine so the
        // restart response can reach the Settings page immediately. Drain
        // concurrently; a stalled client must not delay each listener in turn.
        let (shutdown, api_result, web_result) = tokio::join!(
            engine.shutdown(),
            tokio::time::timeout(Duration::from_secs(10), &mut server),
            async {
                if web_reserved.is_some() {
                    tokio::time::timeout(Duration::from_secs(10), &mut web)
                        .await
                        .ok()
                } else {
                    None
                }
            }
        );
        shutdown?;
        drop(guard);
        if let Ok(result) = api_result {
            result?;
        }
        if let Some(result) = web_result {
            result?;
        }
        if stop.is_cancelled() {
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn settings_restart_acknowledges_before_cleanup_and_creates_new_generation() {
        let directory = tempfile::tempdir().unwrap();
        let config = ApiConfig {
            code_root: directory.path().join("code"),
            data_root: directory.path().join("data"),
            config_dir: directory.path().join("config"),
        };
        for (path, content) in [
            ("assets/config_template.json", "{}"),
            ("backend/applio/rvc/configs/config.py", ""),
            ("frontend/web/out/index.html", "<html></html>"),
        ] {
            let path = config.code_root.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, content).unwrap();
        }
        let factory_config = config.clone();
        let create = move || {
            let runtime = EngineRuntime::with_python(&factory_config, Some("python3".into()))?;
            let readiness = Arc::new(RuntimeReadiness::new(runtime.clone(), true));
            NativeEngine::open_with_options(
                runtime,
                readiness,
                EngineOptions {
                    no_env: true,
                    ..Default::default()
                },
            )
        };
        let first = create().unwrap();
        let old_id = first.instance_id.clone();
        let (release, blocked) = tokio::sync::oneshot::channel::<()>();
        first
            .spawn_background(async move {
                let _ = blocked.await;
            })
            .await
            .unwrap();
        let mut initial = Some(first);
        let api = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let web = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", web.local_addr().unwrap());
        let stop = CancellationToken::new();
        let host_stop = stop.clone();
        let host = tokio::spawn(async move {
            serve_with_factory_and_ui(api, Some(web), config, host_stop, move || {
                initial.take().map(Ok).unwrap_or_else(&create)
            })
            .await
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(2))
            .build()
            .unwrap();
        let response: serde_json::Value = client
            .post(format!("{origin}/api/settings/restart"))
            .send()
            .await
            .expect("restart response was blocked by engine cleanup")
            .error_for_status()
            .unwrap()
            .json()
            .await
            .unwrap();
        assert_eq!(response["instanceId"], old_id);
        release.send(()).unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if let Ok(response) = client.get(format!("{origin}/api/health")).send().await {
                    if let Ok(body) = response.json::<serde_json::Value>().await {
                        if body["instanceId"].as_str().is_some_and(|id| id != old_id) {
                            break;
                        }
                    }
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("API did not start a new generation");
        stop.cancel();
        tokio::time::timeout(Duration::from_secs(5), host)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
    }
}
