use crate::{
    processing_checks::Fixture,
    version_routes::{summarize, Asset, Release},
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
    routing::get,
    Router,
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tower::ServiceExt;

#[test]
fn release_comparison_keeps_unknown_versions_quiet_and_selects_platform_architecture() {
    let releases = vec![
        Release {
            tag_name: "v0.2.11".into(),
            assets: vec![
                Asset {
                    name: "Applio_arm64.exe".into(),
                    browser_download_url: "https://example.org/arm.exe".into(),
                },
                Asset {
                    name: "Applio_x64.exe".into(),
                    browser_download_url: "https://example.org/x64.exe".into(),
                },
            ],
            ..Default::default()
        },
        Release {
            tag_name: "v0.2.10".into(),
            ..Default::default()
        },
    ];
    let value = summarize("0.2.9", &releases, "win32", "x86_64", false);
    assert_eq!(value["status"], "behind");
    assert_eq!(value["versionsBehind"], 2);
    assert_eq!(value["isOutdated"], true);
    assert_eq!(value["downloadUrl"], "https://example.org/x64.exe");
    assert_eq!(
        summarize("unknown", &releases, "win32", "aarch64", false)["status"],
        "unknown"
    );
    assert_eq!(
        summarize("unknown", &releases, "win32", "aarch64", false)["isOutdated"],
        false
    );
    assert_eq!(
        summarize("0.2.11", &releases, "win32", "aarch64", false)["downloadUrl"],
        "https://example.org/arm.exe"
    );
    assert_eq!(
        summarize("1.0.0", &releases, "linux", "x86_64", true)["status"],
        "ahead"
    );
    assert_eq!(
        summarize("0.2.11", &releases, "win32", "x86_64", false)["status"],
        "up-to-date"
    );
}
#[tokio::test]
async fn release_lookup_is_cached_refreshable_and_reports_upstream_errors() {
    let fixture = Fixture::new(false);
    let calls = Arc::new(AtomicUsize::new(0));
    let count = calls.clone();
    let app = Router::new().route(
        "/releases",
        get(move || {
            let count = count.clone();
            async move {
                count.fetch_add(1, Ordering::SeqCst);
                axum::Json(json!([{"tag_name":"v999.0.0","assets":[]}]))
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/releases", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let app = crate::version_routes::router_with_url(fixture.engine.clone(), url);
    for suffix in ["", "", "?refresh=1"] {
        let response = app
            .clone()
            .oneshot(
                Request::get(format!("/api/settings/version-check{suffix}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value =
            serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes())
                .unwrap();
        assert_eq!(body["status"], "behind");
    }
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    server.abort();
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn packaged_update_returns_the_manual_installer_contract_without_spawning_git() {
    let fixture = Fixture::new(false);
    let (status, body) = fixture
        .request("/api/settings/apply-update", json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["success"], false);
    assert_eq!(body["method"], "manual");
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn repository_update_is_fast_forward_only_and_refuses_dirty_work_or_active_jobs() {
    use crate::process::{CommandSpec, ManagedProcess};
    use tokio_util::sync::CancellationToken;
    async fn git(path: &std::path::Path, args: &[&str]) {
        let spec = CommandSpec::new("git", path).args(args.iter().copied());
        let output = ManagedProcess::run(&spec, &CancellationToken::new(), |_, _| {})
            .await
            .unwrap();
        output.ensure_success().unwrap();
    }
    let fixture = Fixture::new(false);
    let code = &fixture.engine.runtime.code;
    std::fs::write(code.join("package.json"), r#"{"version":"0.2.9"}"#).unwrap();
    git(code, &["init", "-b", "main"]).await;
    git(code, &["config", "user.name", "Migration Fixture"]).await;
    git(code, &["config", "user.email", "fixture@example.invalid"]).await;
    git(code, &["add", "."]).await;
    git(code, &["commit", "-m", "Initial fixture"]).await;
    let origin = fixture._directory.path().join("origin.git");
    std::fs::create_dir(&origin).unwrap();
    git(&origin, &["init", "--bare", "--initial-branch=main"]).await;
    git(code, &["remote", "add", "origin", origin.to_str().unwrap()]).await;
    git(code, &["push", "-u", "origin", "main"]).await;
    let upstream = fixture._directory.path().join("upstream");
    git(
        fixture._directory.path(),
        &[
            "clone",
            origin.to_str().unwrap(),
            upstream.to_str().unwrap(),
        ],
    )
    .await;
    git(&upstream, &["config", "user.name", "Migration Fixture"]).await;
    git(
        &upstream,
        &["config", "user.email", "fixture@example.invalid"],
    )
    .await;
    std::fs::write(upstream.join("package.json"), r#"{"version":"0.2.10"}"#).unwrap();
    git(&upstream, &["add", "package.json"]).await;
    git(&upstream, &["commit", "-m", "Next fixture version"]).await;
    git(&upstream, &["push"]).await;
    let (status, body) = fixture
        .request("/api/settings/apply-update", json!({}))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["success"], true);
    assert_eq!(body["version"], "0.2.10");
    std::fs::write(code.join("package.json"), r#"{"version":"local-change"}"#).unwrap();
    let (status, body) = fixture
        .request("/api/settings/apply-update", json!({}))
        .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(body["error"].as_str().unwrap().contains("Commit or stash"));
    assert!(std::fs::read_to_string(code.join("package.json"))
        .unwrap()
        .contains("local-change"));
    let job = fixture
        .engine
        .jobs
        .create(crate::jobs::JobType::Other, json!({"test":true}))
        .unwrap();
    let (status, body) = fixture
        .request("/api/settings/apply-update", json!({}))
        .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(body["error"].as_str().unwrap().contains("Stop active jobs"));
    fixture.engine.jobs.cancel(&job.id, "test complete");
    assert!(fixture.engine.scheduler.status().active.is_empty());
    fixture.engine.shutdown().await.unwrap();
}
