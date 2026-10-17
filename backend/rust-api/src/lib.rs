//! Native HTTP API and desktop engine services.
pub use axum::Router;
use std::path::PathBuf;

pub mod bridge;
pub mod execution;
pub mod inference;
pub mod routes;
pub mod runtime;
pub mod setup;
pub mod training;

// Preserve the crate API used by the desktop and standalone launchers.
pub use bridge::{
    bridge_gateway, bridge_mode, bridge_page, bridge_policy, bridge_sessions, bridge_tunnel,
};
pub use execution::{
    download, engine, engine_runtime, gpu_runtime, jobs, process, python_runtime, realtime,
    scheduler, service, uploads, worker,
};
pub use inference::infer_params;
pub(crate) use routes::catalog::LANGUAGES;
pub use routes::{
    batch_routes, dataset_routes, download_routes, job_routes, model_routes, native, plugin_routes,
    processing_routes, realtime_routes, report_routes, settings_routes, setup_routes,
    tensorboard_routes, training_routes, uvr_routes, version_routes,
};
pub use runtime::{app_runtime, cleaner, locale, metadata_cache, native_host, storage, web_host};
pub use setup::{setup_install, setup_requirements};
pub use training::{training_artifacts, training_params};

pub async fn serve(listener: tokio::net::TcpListener, router: Router) -> anyhow::Result<()> {
    use axum::serve::ListenerExt;
    axum::serve(
        listener.tap_io(|stream| {
            let _ = stream.set_nodelay(true);
        }),
        router,
    )
    .await?;
    Ok(())
}

#[derive(Clone)]
pub struct ApiConfig {
    pub code_root: PathBuf,
    pub data_root: PathBuf,
    pub config_dir: PathBuf,
}
