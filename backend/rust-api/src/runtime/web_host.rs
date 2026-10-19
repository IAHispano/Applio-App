//! Exported React UI served beside the API, without a JavaScript server.
use axum::{
    extract::{Path, Request},
    middleware::{self, Next},
    response::{Redirect, Response},
    routing::get,
    Router,
};
use std::path::PathBuf;
use tower_http::services::{ServeDir, ServeFile};

pub fn router(api: Router, root: PathBuf) -> Router {
    let mut app = api;
    for route in [
        "/",
        "/inference",
        "/realtime",
        "/tts",
        "/models",
        "/train",
        "/voice-blender",
        "/tensorboard",
        "/api-access",
        "/your-data",
        "/extra",
        "/audio-separator",
        "/jobs",
        "/jobs/view",
        "/settings",
        "/bridge-mode",
        "/report",
        "/setup",
    ] {
        let file = if route == "/" {
            "index.html".into()
        } else {
            format!("{}.html", &route[1..])
        };
        app = app.route_service(route, ServeFile::new(root.join(&file)));
        if route != "/" {
            app = app.route_service(&format!("{route}/"), ServeFile::new(root.join(&file)));
            // Nested component files must win over the legacy /jobs/{id} redirect.
            app = app.route_service(
                &format!("{route}.txt"),
                ServeFile::new(root.join(format!("{}.txt", &route[1..]))),
            );
        }
    }
    app.route(
        "/convert",
        get(|| async { Redirect::permanent("/inference") }),
    )
    .route("/tools", get(|| async { Redirect::permanent("/extra") }))
    .route(
        "/jobs/{id}",
        get(|Path(id): Path<String>| async move {
            let query = reqwest::Url::parse_with_params("http://localhost/jobs/view", [("id", id)])
                .unwrap();
            Redirect::temporary(&format!("/jobs/view?{}", query.query().unwrap_or_default()))
        }),
    )
    .fallback_service(ServeDir::new(root).append_index_html_on_directories(false))
    .layer(middleware::from_fn(asset_headers))
}

async fn asset_headers(request: Request, next: Next) -> Response {
    let path = request.uri().path();
    let immutable = path.starts_with("/_next/static/");
    let component = path.ends_with(".txt")
        && !path.starts_with("/api/")
        && !path.starts_with("/assets/")
        && !path.starts_with("/outputs/");
    let mut response = next.run(request).await;
    if response.status().is_success() {
        if component {
            response
                .headers_mut()
                .insert("content-type", "text/x-component".parse().unwrap());
        }
        if immutable {
            response.headers_mut().insert(
                "cache-control",
                "public, max-age=31536000, immutable".parse().unwrap(),
            );
        } else {
            response
                .headers_mut()
                .entry("cache-control")
                .or_insert("no-cache".parse().unwrap());
        }
    }
    // Native permission callbacks identify the main webview. Prevent embedded
    // cross-origin pages (including TensorBoard plugins) from requesting media.
    response.headers_mut().insert(
        "permissions-policy",
        "microphone=(self), camera=(), geolocation=()"
            .parse()
            .unwrap(),
    );
    response
        .headers_mut()
        .insert("x-content-type-options", "nosniff".parse().unwrap());
    response
        .headers_mut()
        .insert("x-frame-options", "DENY".parse().unwrap());
    response.headers_mut().insert(
        "content-security-policy",
        "frame-ancestors 'none'; object-src 'none'; base-uri 'self'"
            .parse()
            .unwrap(),
    );
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{body::Body, http::StatusCode};
    use tower::ServiceExt;

    #[tokio::test]
    async fn bridge_management_serves_exported_page_and_navigation_payload() {
        let export = tempfile::tempdir().unwrap();
        std::fs::write(export.path().join("bridge-mode.html"), "Bridge management").unwrap();
        std::fs::write(export.path().join("bridge-mode.txt"), "Bridge payload").unwrap();
        let app = router(Router::new(), export.path().to_owned());
        for path in ["/bridge-mode", "/bridge-mode/", "/bridge-mode.txt"] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(path).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            let content_type = response.headers()["content-type"].to_str().unwrap();
            assert!(
                content_type.starts_with(if path.ends_with(".txt") {
                    "text/x-component"
                } else {
                    "text/html"
                }),
                "{path}: {content_type}"
            );
            let body = axum::body::to_bytes(response.into_body(), 1024)
                .await
                .unwrap();
            assert_eq!(
                body.as_ref(),
                if path.ends_with(".txt") {
                    b"Bridge payload".as_slice()
                } else {
                    b"Bridge management".as_slice()
                }
            );
        }
    }
}
