//! Amazon Voice Focus assets served from the application's own origin.
//!
//! The Chime SDK fetches its AudioWorklet processors, workers and WASM models
//! from `static.sdkassets.chime.aws` at runtime. That depends on cross-origin
//! behaviour that is engine- and environment-dependent: a cross-origin worker
//! can only be loaded indirectly through a blob URL, and cross-origin worklet
//! modules are not accepted everywhere either (measured: Chromium and Firefox
//! accept them, WebKit is the strict case). Whenever any of it fails, the
//! transformer never initializes and realtime input stays silent as soon as a
//! Voice Focus variant is selected. Proxying the assets through this loopback
//! host keeps every URL the SDK requests same-origin on all platforms, and it
//! keeps the webview's own network and CSP rules out of the equation.
//!
//! The upstream cache headers are passed through, so the multi-megabyte models
//! are cached by the webview and only travel once per cache lifetime.
use axum::{
    body::Body,
    extract::{OriginalUri, Path},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Router,
};
use regex::Regex;
use std::{sync::OnceLock, time::Duration};

const CDN: &str = "https://static.sdkassets.chime.aws";

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .expect("Voice Focus proxy client")
    })
}

/// Only the SDK's own assets are proxied: one of its three directories, a flat
/// file name, and the asset-group query string the SDK appends. Everything else
/// is rejected so this loopback route cannot be used as a general proxy.
fn upstream_path(path: &str, query: Option<&str>) -> Option<String> {
    static ASSET: OnceLock<Regex> = OnceLock::new();
    static QUERY: OnceLock<Regex> = OnceLock::new();
    let asset = ASSET.get_or_init(|| {
        Regex::new(r"^(processors|workers|wasm)/[A-Za-z0-9][A-Za-z0-9._-]{0,120}$").unwrap()
    });
    if !asset.is_match(path) {
        return None;
    }
    if let Some(query) = query {
        let allowed = QUERY.get_or_init(|| Regex::new(r"^[A-Za-z0-9=_.&%-]{0,200}$").unwrap());
        if !allowed.is_match(query) {
            return None;
        }
        if !query.is_empty() {
            return Some(format!("{path}?{query}"));
        }
    }
    Some(path.to_owned())
}

pub fn router() -> Router {
    Router::new().route("/voicefocus/{*path}", get(asset))
}

fn unreachable(url: &str, detail: impl std::fmt::Display) -> Response {
    eprintln!("Voice Focus asset {url} unavailable: {detail}");
    (
        StatusCode::BAD_GATEWAY,
        "Amazon Voice Focus assets are unreachable",
    )
        .into_response()
}

async fn asset(OriginalUri(uri): OriginalUri, Path(path): Path<String>) -> Response {
    let Some(path) = upstream_path(&path, uri.query()) else {
        return (StatusCode::NOT_FOUND, "Unknown Voice Focus asset").into_response();
    };
    let url = format!("{CDN}/{path}");
    let upstream = match client().get(&url).send().await {
        Ok(response) => response,
        Err(error) => return unreachable(&url, error),
    };
    if !upstream.status().is_success() {
        return unreachable(&url, upstream.status());
    }
    let mut headers = axum::http::HeaderMap::new();
    for name in [
        header::CONTENT_TYPE,
        header::CONTENT_LENGTH,
        header::CACHE_CONTROL,
        header::ETAG,
    ] {
        if let Some(value) = upstream.headers().get(&name) {
            headers.insert(name, value.clone());
        }
    }
    let mut response = Response::new(Body::from_stream(upstream.bytes_stream()));
    *response.headers_mut() = headers;
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn proxies_only_sdk_assets() {
        for (path, query) in [
            ("wasm/voicefocus-default-c20-v1_simd.wasm", None),
            ("wasm/bench-v1_simd.wasm", None),
            ("workers/worker-v1.js", Some("assetGroup=stable-v1")),
            ("processors/worklet-inline-processor-v1.js", None),
        ] {
            let expected = match query {
                Some(query) => format!("{path}?{query}"),
                None => path.to_owned(),
            };
            assert_eq!(
                upstream_path(path, query).as_deref(),
                Some(expected.as_str())
            );
        }
        for path in [
            "",
            "wasm",
            "wasm/",
            "wasm/../voices.txt",
            "wasm/nested/model.wasm",
            "../../etc/passwd",
            "http://example.test/x.js",
            "other/model.wasm",
        ] {
            assert!(
                upstream_path(path, None).is_none(),
                "{path} must not be proxied"
            );
        }
        assert!(upstream_path("wasm/model.wasm", Some("assetGroup=<script>")).is_none());
        assert!(upstream_path("wasm/model.wasm", Some("assetGroup=stable-v1&x=1")).is_some());
    }

    /// Requires network access to the Amazon CDN: proves the route returns the
    /// exact upstream bytes with the MIME type the SDK's loaders require.
    #[tokio::test]
    #[ignore = "requires network access to the Amazon Voice Focus CDN"]
    async fn serves_cdn_assets_unchanged() {
        use tower::ServiceExt;
        for (path, content_type) in [
            ("/voicefocus/workers/worker-v1.js", "application/javascript"),
            (
                "/voicefocus/wasm/voicefocus-default-c20-v1.wasm",
                "application/wasm",
            ),
        ] {
            let request = axum::http::Request::builder()
                .uri(path)
                .body(Body::empty())
                .unwrap();
            let response = router().oneshot(request).await.unwrap();
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            assert_eq!(response.headers()[header::CONTENT_TYPE], content_type);
            let served = axum::body::to_bytes(response.into_body(), usize::MAX)
                .await
                .unwrap();
            let upstream = client()
                .get(format!("{CDN}/{}", path.trim_start_matches("/voicefocus/")))
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap();
            assert_eq!(served, upstream, "{path} must be served unmodified");
        }
    }
}
