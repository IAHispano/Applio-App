//! Native API routes, shared by the desktop shell and standalone server.
use super::catalog::{self, ApiState};
use crate::{engine::NativeEngine, ApiConfig, Router};
use axum::{extract::State, http::header, routing::get, Json};
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router(config: ApiConfig, engine: Arc<NativeEngine>) -> Router {
    routes(config, engine, true)
}
fn routes(config: ApiConfig, engine: Arc<NativeEngine>, cors: bool) -> Router {
    let catalogs = Router::new()
        .route("/api/settings/version", get(catalog::version))
        .route("/api/settings/themes", get(catalog::themes))
        .route("/api/settings/theme", get(catalog::theme))
        .route("/api/tts/voices", get(catalog::voices))
        .with_state(Arc::new(ApiState { config }));
    let health = Router::new()
        .route("/api/health", get(health))
        .with_state(engine.clone());
    let app = health
        .merge(catalogs)
        .merge(crate::job_routes::router_with_shutdown(
            engine.jobs.clone(),
            engine.scheduler.clone(),
            engine.cancellation_token(),
        ))
        .merge(crate::batch_routes::router(engine.clone()))
        .merge(crate::model_routes::router(engine.clone()))
        .merge(crate::uvr_routes::router(engine.clone()))
        .merge(crate::settings_routes::router(engine.clone()))
        .merge(crate::training_routes::router(engine.clone()))
        .merge(crate::dataset_routes::router(engine.clone()))
        .merge(crate::download_routes::router(engine.clone()))
        .merge(crate::plugin_routes::router(engine.clone()))
        .merge(crate::realtime_routes::router(engine.clone()))
        .merge(crate::report_routes::router(engine.clone()))
        .merge(crate::setup_routes::router(engine.clone()))
        .merge(crate::version_routes::router(engine.clone()))
        .merge(crate::tensorboard_routes::router(engine.clone()))
        .merge(crate::voicefocus_routes::router())
        .merge(crate::processing_routes::router(engine));
    if cors {
        app.layer(
            tower_http::cors::CorsLayer::new()
                .allow_origin([
                    "http://127.0.0.1:3000".parse().unwrap(),
                    "http://localhost:3000".parse().unwrap(),
                ])
                .allow_methods([
                    axum::http::Method::GET,
                    axum::http::Method::POST,
                    axum::http::Method::PUT,
                    axum::http::Method::DELETE,
                    axum::http::Method::OPTIONS,
                ])
                .allow_headers([header::CONTENT_TYPE, header::ACCEPT]),
        )
    } else {
        app
    }
}
async fn health(State(engine): State<Arc<NativeEngine>>) -> Json<Value> {
    Json(
        json!({"ok":true,"service":"applio-rust-api","runtime":"rust","compatibilityService":false,"repoRoot":engine.runtime.data,"python":engine.runtime.python_bin(),"time":chrono::Utc::now().to_rfc3339()}),
    )
}
