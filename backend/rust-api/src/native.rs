//! Native API routes, shared by the desktop shell and standalone server.
use crate::{engine::NativeEngine, ApiConfig, ApiState, Router};
use axum::{extract::State, http::header, routing::get, Json};
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router(config: ApiConfig, engine: Arc<NativeEngine>) -> Router {
    routes(config, engine, true)
}
fn routes(config: ApiConfig, engine: Arc<NativeEngine>, cors: bool) -> Router {
    let catalogs = Router::new()
        .route("/api/settings/version", get(crate::version))
        .route("/api/settings/themes", get(crate::themes))
        .route("/api/settings/theme", get(crate::theme))
        .route("/api/tts/voices", get(crate::voices))
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

#[cfg(test)]
mod checks {
    #[tokio::test]
    async fn every_captured_api_method_and_path_is_mounted_without_invoking_side_effects() {
        use axum::{
            body::Body,
            extract::{MatchedPath, Request},
            http::StatusCode,
            middleware::{from_fn, Next},
            response::IntoResponse,
        };
        use tower::ServiceExt;
        let fixture = crate::processing_checks::Fixture::new(false);
        let runtime = &fixture.engine.runtime;
        std::fs::create_dir_all(runtime.data.join("assets")).unwrap();
        std::fs::write(runtime.data.join("assets/fixture"), b"fixture-static").unwrap();
        std::fs::write(
            runtime.code.join("assets/applio-logo.svg"),
            b"fixture-static",
        )
        .unwrap();
        std::fs::write(runtime.outputs.join("fixture"), b"fixture-static").unwrap();
        let config = crate::ApiConfig {
            code_root: runtime.code.clone(),
            data_root: runtime.data.clone(),
            config_dir: runtime.config_dir.clone(),
        };
        let core = super::routes(config, fixture.engine.clone(), false);
        // Inspect matching before dispatch: inventory checks must never launch
        // installers, downloads, plugins, or other engine work.
        let app = core
            .clone()
            .layer(from_fn(|request: Request, _next: Next| async move {
                let matched = request
                    .extensions()
                    .get::<MatchedPath>()
                    .map(|p| p.as_str().to_owned());
                let mut response = StatusCode::NO_CONTENT.into_response();
                if let Some(path) = matched {
                    response
                        .headers_mut()
                        .insert("x-migration-route", path.parse().unwrap());
                }
                response
            }));
        let inventory: serde_json::Value =
            serde_json::from_str(include_str!("../../../docs/api-route-inventory.json")).unwrap();
        for route in inventory["routes"].as_array().unwrap() {
            let path = route["path"]
                .as_str()
                .unwrap()
                .split('/')
                .map(|part| {
                    if part.starts_with([':', '*']) {
                        "fixture"
                    } else {
                        part
                    }
                })
                .collect::<Vec<_>>()
                .join("/");
            if path.starts_with("/assets/") || path.starts_with("/outputs/") {
                use http_body_util::BodyExt;
                let response = core
                    .clone()
                    .oneshot(Request::get(&path).body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(response.status(), StatusCode::OK, "{path}");
                assert_eq!(
                    response
                        .into_body()
                        .collect()
                        .await
                        .unwrap()
                        .to_bytes()
                        .as_ref(),
                    b"fixture-static"
                );
                continue;
            }
            // Default OPTIONS enumerates MethodRouter handlers without running
            // any of them. Do this before the production CORS wrapper.
            let methods = core
                .clone()
                .oneshot(
                    Request::builder()
                        .method("OPTIONS")
                        .uri(&path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            let allowed = methods
                .headers()
                .get("allow")
                .and_then(|v| v.to_str().ok())
                .unwrap_or("");
            assert!(
                allowed
                    .split(',')
                    .any(|method| method.trim() == route["method"].as_str().unwrap()),
                "Missing method for {} {path}; allowed={allowed}",
                route["method"]
            );
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(route["method"].as_str().unwrap())
                        .uri(&path)
                        .body(Body::empty())
                        .unwrap(),
                )
                .await
                .unwrap();
            assert!(
                response.headers().contains_key("x-migration-route"),
                "Unported route {} {path}",
                route["method"]
            );
        }
        let response = app
            .oneshot(
                Request::get("/api/not-a-captured-route")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert!(!response.headers().contains_key("x-migration-route"));
        fixture.engine.shutdown().await.unwrap();
    }
}
