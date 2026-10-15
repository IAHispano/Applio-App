use crate::{processing_checks::Fixture, service::BackgroundService, Router};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tower::ServiceExt;

fn fixture() -> Fixture {
    let fixture = Fixture::new(true);
    let code = &fixture.engine.runtime.code;
    std::fs::create_dir_all(code.join("tensorboard")).unwrap();
    std::fs::write(code.join("tensorboard/__init__.py"), "").unwrap();
    std::fs::write(code.join("tensorboard/main.py"), TENSORBOARD).unwrap();
    std::fs::write(code.join("assets/discord_presence.py"), PRESENCE).unwrap();
    std::fs::write(code.join("assets/__init__.py"), "").unwrap();
    fixture
}
fn port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port()
}
async fn send(app: &Router, path: &str, post: bool) -> (StatusCode, Value) {
    let request = if post {
        Request::post(path)
    } else {
        Request::get(path)
    }
    .body(Body::empty())
    .unwrap();
    let response = app.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    (status, serde_json::from_slice(&bytes).unwrap())
}
async fn wait_file(path: &Path) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !path.exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("service did not start");
}
async fn reachable(port: u16) -> bool {
    tokio::time::timeout(
        Duration::from_millis(100),
        tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port)),
    )
    .await
    .is_ok_and(|result| result.is_ok())
}

#[tokio::test]
async fn tensorboard_start_is_idempotent_and_restart_stop_preserve_http_contracts() {
    let fixture = fixture();
    let port = port();
    let app = crate::tensorboard_routes::router_with_port(fixture.engine.clone(), port);
    let (status, initial) = send(&app, "/api/tensorboard/status", false).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(initial["running"], false);
    assert_eq!(initial["starting"], false);
    assert_eq!(initial["startedAt"], Value::Null);
    let (first, second) = tokio::join!(
        send(&app, "/api/tensorboard/start", true),
        send(&app, "/api/tensorboard/start", true)
    );
    assert_eq!(first.0, StatusCode::OK, "{}", first.1);
    assert_eq!(second.0, StatusCode::OK, "{}", second.1);
    assert_eq!(first.1["startedAt"], second.1["startedAt"]);
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("tb-starts"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    let (_, status) = send(&app, "/api/tensorboard/status", false).await;
    assert_eq!(status["running"], true);
    assert_eq!(status["starting"], false);
    let body = reqwest::Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(format!("http://127.0.0.1:{port}"))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(body, "Fixture TensorBoard");
    let cli: Value = serde_json::from_slice(
        &std::fs::read(fixture.engine.runtime.data.join("tb-args.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(cli[1], json!(fixture.engine.runtime.logs));
    assert_eq!(cli[3], "127.0.0.1");
    let (status, restarted) = send(&app, "/api/tensorboard/restart", true).await;
    assert_eq!(status, StatusCode::OK, "{restarted}");
    assert_ne!(restarted["startedAt"], first.1["startedAt"]);
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("tb-starts"))
            .unwrap()
            .lines()
            .count(),
        2
    );
    let (status, body) = send(&app, "/api/tensorboard/stop", true).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert!(!reachable(port).await);
    let (_, status) = send(&app, "/api/tensorboard/status", false).await;
    assert_eq!(status["running"], false);
    assert_eq!(status["startedAt"], Value::Null);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn stopping_a_pending_tensorboard_start_prevents_resurrection() {
    let fixture = fixture();
    let port = port();
    let app = crate::tensorboard_routes::router_with_port(fixture.engine.clone(), port);
    std::fs::write(fixture.engine.runtime.data.join("tb-delay"), "2").unwrap();
    let starting = app.clone();
    let task = tokio::spawn(async move { send(&starting, "/api/tensorboard/start", true).await });
    wait_file(&fixture.engine.runtime.data.join("tb-starts")).await;
    let (_, status) = send(&app, "/api/tensorboard/status", false).await;
    assert_eq!(status["starting"], true);
    assert_eq!(status["running"], false);
    let (status, _) = send(&app, "/api/tensorboard/stop", true).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = task.await.unwrap();
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(body["error"].as_str().unwrap().contains("cancelled"));
    assert!(!reachable(port).await);
    let (_, status) = send(&app, "/api/tensorboard/status", false).await;
    assert_eq!(status["starting"], false);
    assert_eq!(status["running"], false);
    std::fs::remove_file(fixture.engine.runtime.data.join("tb-delay")).unwrap();
    let (status, body) = send(&app, "/api/tensorboard/start", true).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    fixture.engine.shutdown().await.unwrap();
    assert!(!reachable(port).await);
}

#[tokio::test]
async fn a_later_stop_cancels_a_restart_instead_of_starting_a_new_generation() {
    let fixture = fixture();
    let port = port();
    let app = crate::tensorboard_routes::router_with_port(fixture.engine.clone(), port);
    assert_eq!(
        send(&app, "/api/tensorboard/start", true).await.0,
        StatusCode::OK
    );
    let (restart, stop) = tokio::join!(
        send(&app, "/api/tensorboard/restart", true),
        send(&app, "/api/tensorboard/stop", true)
    );
    assert_eq!(stop.0, StatusCode::OK);
    assert_eq!(
        restart.0,
        StatusCode::INTERNAL_SERVER_ERROR,
        "{}",
        restart.1
    );
    assert!(restart.1["error"].as_str().unwrap().contains("cancelled"));
    assert!(!reachable(port).await);
    let (_, status) = send(&app, "/api/tensorboard/status", false).await;
    assert_eq!(status["starting"], false);
    assert_eq!(status["running"], false);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn tensorboard_errors_are_reported_and_foreign_listeners_are_never_owned() {
    let fixture = fixture();
    let port = port();
    let app = crate::tensorboard_routes::router_with_port(fixture.engine.clone(), port);
    std::fs::write(fixture.engine.runtime.data.join("tb-fail"), "yes").unwrap();
    let (status, body) = send(&app, "/api/tensorboard/start", true).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(body["error"]
        .as_str()
        .unwrap()
        .contains("fixture TensorBoard failure"));
    std::fs::remove_file(fixture.engine.runtime.data.join("tb-fail")).unwrap();
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port))
        .await
        .unwrap();
    let (_, status) = send(&app, "/api/tensorboard/status", false).await;
    assert_eq!(status["running"], false);
    let (status, body) = send(&app, "/api/tensorboard/start", true).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert!(body["error"].as_str().unwrap().contains("another process"));
    send(&app, "/api/tensorboard/stop", true).await;
    assert!(reachable(port).await);
    drop(listener);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn presence_start_stop_and_engine_shutdown_preserve_saved_preferences() {
    let fixture = fixture();
    // A legacy seeded script in writable data must not override installed code.
    std::fs::write(fixture.engine.runtime.data.join("assets/__init__.py"), "").unwrap();
    std::fs::write(
        fixture
            .engine
            .runtime
            .data
            .join("assets/discord_presence.py"),
        "raise RuntimeError('stale data-directory script')",
    )
    .unwrap();
    let (status, body) = fixture
        .request("/api/settings/presence", json!({"enabled":true}))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["running"], true);
    wait_file(&fixture.engine.runtime.data.join("presence-starts")).await;
    let first = fixture.engine.presence.status().await.pid;
    fixture
        .request("/api/settings/presence", json!({"enabled":true}))
        .await;
    assert_eq!(fixture.engine.presence.status().await.pid, first);
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("presence-starts"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    let (status, body) = fixture
        .request("/api/settings/presence/stop", json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["ok"], true);
    assert!(!fixture.engine.presence.status().await.running);
    assert_eq!(
        fixture.engine.runtime.config.load().unwrap()["discord_presence"],
        true
    );
    fixture
        .request("/api/settings/presence", json!({"enabled":true}))
        .await;
    assert!(fixture.engine.presence.status().await.running);
    fixture.engine.shutdown().await.unwrap();
    assert!(!fixture.engine.presence.status().await.running);
    assert!(fixture.engine.start_presence().await.is_err());
}

#[tokio::test]
async fn presence_disabled_preference_and_invalid_requests_keep_expected_responses() {
    let fixture = fixture();
    let before = std::fs::read(fixture.engine.runtime.config_dir.join("config.json")).unwrap();
    let (status, body) = fixture
        .request("/api/settings/presence", json!({"enabled":"true"}))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["details"]["fieldErrors"]["enabled"].is_array());
    assert_eq!(
        std::fs::read(fixture.engine.runtime.config_dir.join("config.json")).unwrap(),
        before
    );
    let (status, body) = fixture
        .request("/api/settings/presence", json!({"enabled":false}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["running"], false);
    assert_eq!(
        fixture.engine.runtime.config.load().unwrap()["discord_presence"],
        false
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn startup_services_are_idempotent_and_remain_owned_without_a_router() {
    let fixture = fixture();
    fixture
        .engine
        .runtime
        .config
        .update(json!({"discord_presence":true}))
        .unwrap();
    fixture.engine.start_services().await.unwrap();
    fixture.engine.start_services().await.unwrap();
    wait_file(&fixture.engine.runtime.data.join("presence-starts")).await;
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("presence-starts"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    assert!(fixture.engine.jobs.list().is_empty());
    fixture.engine.shutdown().await.unwrap();
    assert!(!fixture.engine.presence.status().await.running);
    assert!(fixture.engine.start_services().await.is_err());
}

#[tokio::test]
async fn startup_cleaner_removes_only_old_temporary_files_and_cancels_its_long_timer() {
    let fixture = fixture();
    let old = fixture.engine.runtime.uploads.join("old-upload.wav");
    let fresh = fixture.engine.runtime.uploads.join("fresh-upload.wav");
    let audio = fixture.engine.runtime.outputs.join("user-audio.wav");
    for file in [&old, &fresh, &audio] {
        std::fs::write(file, b"audio").unwrap();
    }
    let file = std::fs::OpenOptions::new().write(true).open(&old).unwrap();
    file.set_times(
        std::fs::FileTimes::new()
            .set_modified(std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(3600)),
    )
    .unwrap();
    drop(file);
    fixture.engine.start_services().await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert!(old.is_file());
    tokio::time::timeout(Duration::from_secs(30), async {
        while old.exists() {
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("initial maintenance did not run");
    assert!(fresh.is_file());
    assert!(audio.is_file());
    tokio::time::timeout(Duration::from_secs(2), fixture.engine.shutdown())
        .await
        .expect("maintenance timer did not cancel")
        .unwrap();
}

#[tokio::test]
async fn no_env_mode_keeps_presence_stopped_but_preserves_the_requested_preference() {
    let mut fixture = fixture();
    fixture.engine.shutdown().await.unwrap();
    let config = crate::ApiConfig {
        code_root: fixture.engine.runtime.code.clone(),
        data_root: fixture.engine.runtime.data.clone(),
        config_dir: fixture.engine.runtime.config_dir.clone(),
    };
    let runtime = fixture.engine.runtime.clone();
    let readiness =
        std::sync::Arc::new(crate::engine::RuntimeReadiness::new(runtime.clone(), true));
    fixture.engine = crate::engine::NativeEngine::open_with_options(
        runtime,
        readiness,
        crate::engine::EngineOptions {
            no_env: true,
            ..Default::default()
        },
    )
    .unwrap();
    fixture.app = crate::native::router(config, fixture.engine.clone());
    let (status, body) = fixture
        .request("/api/settings/presence", json!({"enabled":true}))
        .await;
    assert_eq!(status, StatusCode::BAD_GATEWAY, "{body}");
    assert_eq!(
        fixture.engine.runtime.config.load().unwrap()["discord_presence"],
        true
    );
    fixture.engine.start_services().await.unwrap();
    assert!(!fixture.engine.presence.status().await.running);
    assert!(!fixture.engine.runtime.data.join("presence-starts").exists());
    let (status, body) = fixture
        .send(
            Request::get("/api/settings/presence")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["running"], false);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn services_keep_running_after_output_closes_and_stop_on_engine_shutdown() {
    let fixture = fixture();
    let service = BackgroundService::default();
    let spec=fixture.engine.runtime.python_command(["-c","import sys,time; from pathlib import Path; sys.stdout.close(); sys.stderr.close(); Path('closed-ready').write_text('yes'); exec(\"while True:\\n Path('closed-heartbeat').write_text(str(time.monotonic())); time.sleep(0.02)\")"]).unwrap();
    service.start(&fixture.engine, &spec).await.unwrap();
    wait_file(&fixture.engine.runtime.data.join("closed-ready")).await;
    wait_file(&fixture.engine.runtime.data.join("closed-heartbeat")).await;
    assert!(service.status().await.running);
    fixture.engine.shutdown().await.unwrap();
    assert!(!service.status().await.running);
    let path = fixture.engine.runtime.data.join("closed-heartbeat");
    let first = std::fs::read_to_string(&path).unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(std::fs::read_to_string(path).unwrap(), first);
}

#[tokio::test]
#[ignore = "Requires APPLIO_ENGINE_TEST_PYTHON pointing to the installed Python voice environment"]
async fn real_tensorboard_http_service_is_owned_and_stops_with_the_engine() {
    let mut fixture = Fixture::new(true);
    fixture.engine.shutdown().await.unwrap();
    let python =
        std::env::var_os("APPLIO_ENGINE_TEST_PYTHON").expect("Set APPLIO_ENGINE_TEST_PYTHON");
    let config = crate::ApiConfig {
        code_root: fixture.engine.runtime.code.clone(),
        data_root: fixture.engine.runtime.data.clone(),
        config_dir: fixture.engine.runtime.config_dir.clone(),
    };
    let runtime =
        crate::engine_runtime::EngineRuntime::with_python(&config, Some(python.into())).unwrap();
    let ready = std::sync::Arc::new(crate::engine::RuntimeReadiness::new(runtime.clone(), true));
    fixture.engine = crate::engine::NativeEngine::open(runtime, ready).unwrap();
    let port = port();
    let app = crate::tensorboard_routes::router_with_port(fixture.engine.clone(), port);
    let (status, body) = send(&app, "/api/tensorboard/start", true).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(20))
        .build()
        .unwrap();
    let response = client
        .get(format!("http://127.0.0.1:{port}/"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response
        .text()
        .await
        .unwrap()
        .to_lowercase()
        .contains("tensorboard"));
    fixture.engine.shutdown().await.unwrap();
    assert!(!reachable(port).await);
}

const PRESENCE: &str = r#"
import os
from pathlib import Path
class RPCManager:
 @staticmethod
 def start_presence():
  with open('presence-starts','a') as f:f.write(str(os.getpid())+'\n')
"#;
const TENSORBOARD: &str = r#"
import sys,os,json,time
from pathlib import Path
from http.server import HTTPServer,BaseHTTPRequestHandler
def flag(name):return sys.argv[sys.argv.index(name)+1]
with open('tb-starts','a') as f:f.write(str(os.getpid())+'\n')
Path('tb-args.json').write_text(json.dumps(sys.argv[1:]))
if Path('tb-fail').exists():print('fixture TensorBoard failure',file=sys.stderr,flush=True);sys.exit(3)
if Path('tb-delay').exists():time.sleep(float(Path('tb-delay').read_text()))
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  self.send_response(200);self.end_headers();self.wfile.write(b'Fixture TensorBoard')
 def log_message(self,*args):pass
server=HTTPServer((flag('--host'),int(flag('--port'))),Handler)
server.serve_forever()
"#;
