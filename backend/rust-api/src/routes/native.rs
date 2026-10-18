//! Native API routes, shared by the desktop shell and standalone server.
use super::catalog::{self, ApiState};
use crate::{engine::NativeEngine, ApiConfig, Router};
use axum::{
    extract::{Request, State},
    http::{header, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::get,
    Json,
};
use serde_json::{json, Value};
use std::sync::Arc;

pub fn router(config: ApiConfig, engine: Arc<NativeEngine>) -> Router {
    routes(config, engine, true)
}
pub(crate) fn operation_routes(config: ApiConfig, engine: Arc<NativeEngine>) -> Router {
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
        .merge(crate::processing_routes::router(engine));
    app
}
fn routes(config: ApiConfig, engine: Arc<NativeEngine>, cors: bool) -> Router {
    let operations = operation_routes(config, engine.clone());
    let integrations = crate::routes::integration_routes::router(engine, operations.clone());
    let app = operations
        .merge(integrations)
        .layer(middleware::from_fn(local_request));
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

// CORS controls response visibility, not whether a form or WebSocket can
// trigger an operation. Check the browser boundary before running any handler.
async fn local_request(request: Request, next: Next) -> Response {
    if !local_request_allowed(&request) {
        return StatusCode::FORBIDDEN.into_response();
    }
    next.run(request).await
}

fn local_authority(value: &str) -> bool {
    value
        .parse::<axum::http::uri::Authority>()
        .is_ok_and(|authority| matches!(authority.host(), "127.0.0.1" | "localhost" | "[::1]"))
}

fn local_request_allowed(request: &Request) -> bool {
    let Some(host) = request
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
    else {
        return false;
    };
    if !local_authority(host) || request.uri().scheme().is_some() {
        return false;
    }
    if let Some(origin) = request.headers().get(header::ORIGIN) {
        let Ok(origin) = origin.to_str() else {
            return false;
        };
        return origin == "http://127.0.0.1:3000"
            || origin == "http://localhost:3000"
            || origin == format!("http://{host}");
    }
    // Origin is absent on cross-site navigations and some no-CORS requests.
    !request
        .headers()
        .get("sec-fetch-site")
        .is_some_and(|v| v == "cross-site")
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use tower::ServiceExt;

    #[tokio::test]
    async fn rejects_browser_attacks_before_get_post_and_websocket_handlers() {
        let app = Router::new()
            .fallback(|| async { StatusCode::NO_CONTENT })
            .layer(middleware::from_fn(local_request));
        for method in ["GET", "POST", "PUT", "DELETE"] {
            for (host, origin, site, expected) in [
                ("127.0.0.1:8000", None, None, StatusCode::NO_CONTENT),
                (
                    "localhost:3000",
                    Some("http://localhost:3000"),
                    Some("same-origin"),
                    StatusCode::NO_CONTENT,
                ),
                (
                    "127.0.0.1:8000",
                    Some("http://127.0.0.1:3000"),
                    Some("same-site"),
                    StatusCode::NO_CONTENT,
                ),
                (
                    "127.0.0.1:8000",
                    Some("http://localhost:3000"),
                    Some("cross-site"),
                    StatusCode::NO_CONTENT,
                ),
                ("rebind.example:8000", None, None, StatusCode::FORBIDDEN),
                (
                    "127.0.0.1.attacker.example:8000",
                    None,
                    None,
                    StatusCode::FORBIDDEN,
                ),
                (
                    "127.0.0.1:8000",
                    Some("https://attacker.example"),
                    None,
                    StatusCode::FORBIDDEN,
                ),
                ("127.0.0.1:8000", Some("null"), None, StatusCode::FORBIDDEN),
                (
                    "127.0.0.1:8000",
                    None,
                    Some("cross-site"),
                    StatusCode::FORBIDDEN,
                ),
                (
                    "127.0.0.1:8000",
                    Some("http://127.0.0.1:6007"),
                    Some("same-site"),
                    StatusCode::FORBIDDEN,
                ),
            ] {
                let mut request = Request::builder()
                    .method(method)
                    .uri("/api/realtime/ws-audio")
                    .header(header::HOST, host);
                if let Some(origin) = origin {
                    request = request.header(header::ORIGIN, origin);
                }
                if let Some(site) = site {
                    request = request.header("sec-fetch-site", site);
                }
                if method == "GET" {
                    request = request.header(header::UPGRADE, "websocket");
                }
                let response = app
                    .clone()
                    .oneshot(request.body(Body::empty()).unwrap())
                    .await
                    .unwrap();
                assert_eq!(
                    response.status(),
                    expected,
                    "{method} {host} {origin:?} {site:?}"
                );
            }
        }
        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN);
    }
}
async fn health(State(engine): State<Arc<NativeEngine>>) -> Json<Value> {
    Json(
        json!({"ok":true,"instanceId":engine.instance_id,"service":"applio-rust-api","runtime":"rust","compatibilityService":false,"repoRoot":engine.runtime.data,"python":engine.runtime.python_bin(),"time":chrono::Utc::now().to_rfc3339()}),
    )
}
