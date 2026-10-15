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
        "/extra",
        "/audio-separator",
        "/jobs",
        "/jobs/view",
        "/settings",
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
}

#[cfg(test)]
mod checks {
    use super::*;
    use axum::{
        body::{to_bytes, Body},
        http::StatusCode,
    };
    use tower::ServiceExt;

    #[tokio::test]
    async fn static_routes_components_cache_ranges_and_legacy_jobs_work_without_a_node_server() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path();
        std::fs::create_dir_all(root.join("_next/static")).unwrap();
        std::fs::create_dir_all(root.join("jobs")).unwrap();
        std::fs::write(root.join("jobs/view.txt"), "job component").unwrap();
        std::fs::write(root.join("index.html"), "<h1>Applio</h1>").unwrap();
        std::fs::write(root.join("models.html"), "models").unwrap();
        std::fs::write(root.join("models.txt"), "component").unwrap();
        std::fs::write(root.join("_next/static/app.js"), "123456789").unwrap();
        let app = router(
            Router::new().route("/api/health", get(|| async { "native" })),
            root.into(),
        );
        for (url, expected) in [
            ("/", "<h1>Applio</h1>"),
            ("/models", "models"),
            ("/models/", "models"),
            ("/jobs/view.txt?_rsc=test", "job component"),
            ("/api/health", "native"),
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(url).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers()["permissions-policy"],
                "microphone=(self), camera=(), geolocation=()"
            );
            assert_eq!(
                to_bytes(response.into_body(), 1024).await.unwrap(),
                expected
            );
        }
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/models.txt?_rsc=fixture")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()["content-type"], "text/x-component");
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/_next/static/app.js")
                    .header("range", "bytes=1-3")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert!(response.headers()["cache-control"]
            .to_str()
            .unwrap()
            .contains("immutable"));
        assert_eq!(to_bytes(response.into_body(), 1024).await.unwrap(), "234");
        let response = app
            .clone()
            .oneshot(
                Request::builder()
                    .uri("/jobs/old-job")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.headers()["location"], "/jobs/view?id=old-job");
        for url in [
            "/missing",
            "/%2e%2e/Cargo.toml",
            "/_next/static/%2e%2e/%2e%2e/Cargo.toml",
        ] {
            let response = app
                .clone()
                .oneshot(Request::builder().uri(url).body(Body::empty()).unwrap())
                .await
                .unwrap();
            assert!(!response.status().is_success(), "{url}");
        }
    }
}
