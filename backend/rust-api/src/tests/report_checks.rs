use crate::processing_checks::Fixture;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::json;
use tower::ServiceExt;

#[tokio::test]
async fn report_identity_uses_installed_code_and_native_system_information() {
    let fixture = Fixture::new(false);
    std::fs::write(
        fixture.engine.runtime.code.join("assets/ecosystem.json"),
        json!({"projects":{"desktop":{"issues":"https://example.org/new-app/issues"}}}).to_string(),
    )
    .unwrap();
    std::fs::write(
        fixture.engine.runtime.data.join("assets/ecosystem.json"),
        json!({"projects":{"desktop":{"issues":"https://stale.invalid/issues"}}}).to_string(),
    )
    .unwrap();
    std::fs::write(
        fixture.engine.runtime.code.join("backend/revision.json"),
        r#"{"commit":"native-fixture"}"#,
    )
    .unwrap();
    let (status, body) = fixture
        .send(
            Request::get("/api/report/info")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["runtime"], "Rust / Axum");
    assert!(body.get("node").is_none());
    assert_eq!(body["version"], env!("CARGO_PKG_VERSION"));
    assert_eq!(body["backendRevision"], "native-fixture");
    assert_eq!(body["issueUrl"], "https://example.org/new-app/issues/new");
    assert!(body["cpus"].as_u64().unwrap() > 0);
    assert!(body["totalMemGB"].as_u64().unwrap() > 0);
    assert!(body["python"].as_str().unwrap().starts_with("Python"));
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn screen_report_upload_decodes_video_and_serves_ranges_without_affecting_other_json_limits()
{
    use base64::Engine;
    let fixture = Fixture::new(false);
    std::fs::write(
        fixture.engine.runtime.code.join("assets/ecosystem.json"),
        json!({"projects":{"desktop":{"issues":"https://example.org/issues"}}}).to_string(),
    )
    .unwrap();
    // Larger than the old global Express JSON limit, still within the explicit
    // report route's documented 200 MB encoded clip limit.
    let bytes = vec![87; 2 * 1024 * 1024];
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let (status, body) = fixture
        .request(
            "/api/report/upload",
            json!({"dataUrl":format!("data:video/webm;base64,{data}")}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let file = body["file"].as_str().unwrap();
    assert_eq!(
        std::fs::read(fixture.engine.runtime.data.join(file)).unwrap(),
        bytes
    );
    let name = file.rsplit('/').next().unwrap();
    let response = fixture
        .app
        .clone()
        .oneshot(
            Request::get(format!("/outputs/{name}"))
                .header("range", "bytes=1-3")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .as_ref(),
        b"WWW"
    );
    for data in [
        "data:audio/webm;base64,V1dX",
        "data:video/webm;base64,!!!!",
        "data:video/webm;invalid,V1dX",
    ] {
        let (status, _) = fixture
            .request("/api/report/upload", json!({"dataUrl":data}))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let (status, _) = fixture
        .request(
            "/api/realtime/config",
            json!({"large":"x".repeat(3*1024*1024)}),
        )
        .await;
    assert_eq!(status, StatusCode::METHOD_NOT_ALLOWED);
    let (status, _) = fixture
        .request("/api/download", json!({"large":"x".repeat(3*1024*1024)}))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        std::fs::read_dir(&fixture.engine.runtime.outputs)
            .unwrap()
            .filter(|entry| entry.as_ref().is_ok_and(|e| e.path().is_file()))
            .count(),
        1
    );
    fixture.engine.shutdown().await.unwrap();
}
