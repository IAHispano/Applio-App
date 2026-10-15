// Pairing gateway and streamed proxy contract checks.
use crate::{
    bridge_gateway::{Gateway, COOKIE},
    bridge_sessions::Device,
};
use axum::{
    body::{Body, Bytes},
    http::{Request, StatusCode},
    routing::{get, post},
    Router,
};
use futures_util::StreamExt;
use http_body_util::BodyExt;
use serde_json::json;
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

async fn server(app: Router) -> (u16, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (port, task)
}
fn gateway(web: u16, api: u16) -> (Arc<Gateway>, Arc<Mutex<Vec<Device>>>) {
    let requests = Arc::new(Mutex::new(Vec::new()));
    let requested = requests.clone();
    let gateway = Gateway::new(
        web,
        api,
        Some(b"fixture font".to_vec()),
        Arc::new(|| ("en_US".into(), json!({}))),
        Arc::new(move |device| requested.lock().unwrap().push(device)),
        CancellationToken::new(),
    )
    .unwrap();
    gateway.set_origin("https://bridge.example").unwrap();
    (gateway, requests)
}
fn request(method: &str, path: &str, cookie: Option<&str>, body: Body) -> Request<Body> {
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("host", "bridge.example")
        .header("origin", "https://bridge.example");
    if let Some(cookie) = cookie {
        request = request.header("cookie", cookie);
    }
    request.body(body).unwrap()
}
async fn pair(gateway: &Arc<Gateway>) -> String {
    let invite = gateway.sessions.new_invite().unwrap();
    let mut request = request(
        "POST",
        "/bridge/pair",
        None,
        Body::from(json!({"invite":invite.token,"name":"Phone"}).to_string()),
    );
    request
        .headers_mut()
        .insert("content-type", "application/json".parse().unwrap());
    let response = gateway.router().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let cookie = response.headers()["set-cookie"].to_str().unwrap();
    assert!(cookie.contains("Secure; HttpOnly; SameSite=Strict"));
    cookie.split(';').next().unwrap().into()
}
#[tokio::test]
async fn gateway_requires_approval_enforces_origin_capabilities_and_preserves_streamed_bytes() {
    let api = Router::new()
        .route(
            "/api/models",
            get(|request: Request<Body>| async move {
                let headers = request.headers();
                for name in [
                    "cookie",
                    "authorization",
                    "origin",
                    "x-forwarded-for",
                    "cf-connecting-ip",
                    "forwarded",
                    "x-remove",
                    "x-applio-compat-token",
                ] {
                    assert!(!headers.contains_key(name), "Leaked header {name}");
                }
                axum::http::Response::builder()
                    .header("set-cookie", "private=value")
                    .header("access-control-allow-origin", "*")
                    .header("connection", "x-upstream-private")
                    .header("x-upstream-private", "secret")
                    .header("content-type", "application/json")
                    .body(Body::from("{\"models\":[]}"))
                    .unwrap()
            }),
        )
        .route(
            "/api/inference",
            post(|request: Request<Body>| async move {
                let bytes = request.into_body().collect().await.unwrap().to_bytes();
                (StatusCode::ACCEPTED, bytes)
            }),
        );
    let (api_port, api_task) = server(api).await;
    let (web_port, web_task) =
        server(Router::new().fallback(|| async { "fixture web interface" })).await;
    let (gateway, requests) = gateway(web_port, api_port);
    let response = gateway
        .router()
        .oneshot(request("GET", "/bridge/syne.ttf", None, Body::empty()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "public, max-age=86400");
    let response = gateway
        .router()
        .oneshot(request("GET", "/api/models", None, Body::empty()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    let cookie = pair(&gateway).await;
    let device = requests.lock().unwrap()[0].clone();
    let response = gateway
        .router()
        .oneshot(request("GET", "/api/models", Some(&cookie), Body::empty()))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    gateway.sessions.approve(&device.id).unwrap();
    let mut req = request("GET", "/api/models", Some(&cookie), Body::empty());
    for (name, value) in [
        ("authorization", "Bearer private"),
        ("x-forwarded-for", "203.0.113.1"),
        ("cf-connecting-ip", "203.0.113.2"),
        ("forwarded", "for=203.0.113.3"),
        ("connection", "x-remove"),
        ("x-remove", "private"),
        ("x-applio-compat-token", "private"),
    ] {
        req.headers_mut().insert(
            axum::http::HeaderName::from_bytes(name.as_bytes()).unwrap(),
            value.parse().unwrap(),
        );
    }
    let response = gateway.router().oneshot(req).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    for name in [
        "set-cookie",
        "access-control-allow-origin",
        "connection",
        "x-upstream-private",
    ] {
        assert!(!response.headers().contains_key(name));
    }
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(response.headers()["x-frame-options"], "DENY");
    let payload = Bytes::from_static(b"\x00\xffmultipart\r\n\x80");
    let response = gateway
        .router()
        .oneshot(request(
            "POST",
            "/api/inference",
            Some(&cookie),
            Body::from(payload.clone()),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        payload
    );
    for (method, path) in [
        ("POST", "/api/setup/install"),
        ("PUT", "/api/settings"),
        ("POST", "/api/plugins/install"),
        ("GET", "/api/jobs/events"),
        ("POST", "/api/train/train"),
    ] {
        let response = gateway
            .router()
            .oneshot(request(method, path, Some(&cookie), Body::empty()))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::FORBIDDEN, "{method} {path}");
    }
    let mut req = request("POST", "/api/inference", Some(&cookie), Body::empty());
    req.headers_mut()
        .insert("origin", "https://foreign.example".parse().unwrap());
    assert_eq!(
        gateway.router().oneshot(req).await.unwrap().status(),
        StatusCode::FORBIDDEN
    );
    let response = gateway
        .router()
        .oneshot(request("GET", "/", Some(&cookie), Body::empty()))
        .await
        .unwrap();
    assert_eq!(
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .as_ref(),
        b"fixture web interface"
    );
    let response = gateway
        .router()
        .oneshot(request(
            "POST",
            "/bridge/logout",
            Some(&cookie),
            Body::empty(),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .contains("Max-Age=0"));
    assert!(gateway
        .sessions
        .find(Some(cookie.strip_prefix(&format!("{COOKIE}=")).unwrap()))
        .is_none());
    gateway.stop();
    api_task.abort();
    web_task.abort();
}
#[tokio::test]
async fn revoking_access_interrupts_an_inflight_download_and_new_requests_are_rejected() {
    let (port,server)=server(Router::new().route("/outputs/file",get(||async{
        let stream=async_stream::stream! {yield Ok::<_,std::io::Error>(Bytes::from_static(b"first"));tokio::time::sleep(Duration::from_secs(60)).await;yield Ok(Bytes::from_static(b"private tail"));};Body::from_stream(stream)
    }))).await;
    let (gateway, _) = gateway(port, port);
    let cookie = pair(&gateway).await;
    let id = gateway.sessions.list()[0].id.clone();
    gateway.sessions.approve(&id).unwrap();
    let response = gateway
        .router()
        .oneshot(request(
            "GET",
            "/outputs/file",
            Some(&cookie),
            Body::empty(),
        ))
        .await
        .unwrap();
    let mut stream = response.into_body().into_data_stream();
    assert_eq!(stream.next().await.unwrap().unwrap(), b"first".as_slice());
    gateway.sessions.revoke(&id);
    assert!(tokio::time::timeout(Duration::from_secs(1), stream.next())
        .await
        .unwrap()
        .is_none());
    assert_eq!(
        gateway
            .router()
            .oneshot(request(
                "GET",
                "/outputs/file",
                Some(&cookie),
                Body::empty()
            ))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    gateway.stop();
    server.abort();
}
#[tokio::test]
async fn pairing_rate_limit_path_validation_and_upload_limits_cannot_be_bypassed() {
    let (port, server) = server(Router::new().route(
        "/api/inference",
        post(|request: Request<Body>| async {
            match request.into_body().collect().await {
                Ok(_) => StatusCode::ACCEPTED,
                Err(_) => StatusCode::BAD_REQUEST,
            }
        }),
    ))
    .await;
    let (gateway, _) = gateway(port, port);
    let cookie = pair(&gateway).await;
    let device = gateway.sessions.list()[0].clone();
    gateway.sessions.approve(&device.id).unwrap();
    let mut req = request("POST", "/api/inference", Some(&cookie), Body::empty());
    req.headers_mut().insert(
        "content-length",
        (crate::bridge_gateway::MAX_UPLOAD + 1)
            .to_string()
            .parse()
            .unwrap(),
    );
    assert_eq!(
        gateway.router().oneshot(req).await.unwrap().status(),
        StatusCode::PAYLOAD_TOO_LARGE
    );
    let stream = async_stream::stream! {for _ in 0..1601 {yield Ok::<_,std::io::Error>(Bytes::from(vec![7;64*1024]));}};
    let response = gateway
        .router()
        .oneshot(request(
            "POST",
            "/api/inference",
            Some(&cookie),
            Body::from_stream(stream),
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    for path in [
        "/api/%6dodels",
        "/api/models//nested",
        "/outputs/%2e%2e/config",
        "/assets/foo%252e",
        "/assets/a%2fb",
        "/assets/%g0",
    ] {
        assert!(!crate::bridge_gateway::valid_path(path), "{path}");
    }
    assert!(crate::bridge_gateway::valid_path(
        "/outputs/voice%20%C3%A9.wav"
    ));
    for _ in 0..20 {
        let mut req = request("POST", "/bridge/pair", None, Body::from("{}"));
        req.headers_mut()
            .insert("content-type", "application/json".parse().unwrap());
        let response = gateway.router().oneshot(req).await.unwrap();
        if response.status() == StatusCode::TOO_MANY_REQUESTS {
            gateway.stop();
            server.abort();
            return;
        }
    }
    panic!("pairing rate limit did not apply");
}
