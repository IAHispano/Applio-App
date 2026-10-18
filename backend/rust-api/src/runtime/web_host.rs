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
