// Realtime HTTP, process generation and binary transport contract checks.
use crate::{
    engine::{EngineOptions, NativeEngine, RuntimeReadiness},
    processing_checks::Fixture,
    scheduler::Resource,
    ApiConfig,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::{sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

async fn fixture() -> Fixture {
    let mut fixture = Fixture::new(true);
    fixture.engine.shutdown().await.unwrap();
    let runtime = fixture.engine.runtime.clone();
    std::fs::write(runtime.code.join("uvicorn.py"), PYTHON).unwrap();
    let config = ApiConfig {
        code_root: runtime.code.clone(),
        data_root: runtime.data.clone(),
        config_dir: runtime.config_dir.clone(),
    };
    let port = std::net::TcpListener::bind("127.0.0.1:0")
        .unwrap()
        .local_addr()
        .unwrap()
        .port();
    fixture.engine = NativeEngine::open_with_options(
        runtime.clone(),
        Arc::new(RuntimeReadiness::new(runtime, true)),
        EngineOptions {
            realtime_port: Some(port),
            ..Default::default()
        },
    )
    .unwrap();
    fixture.app = crate::native::router(config, fixture.engine.clone());
    fixture
}
async fn running(fixture: &Fixture) {
    let (status, body) = fixture.request("/api/realtime/start", json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
}
async fn wait_file(path: &std::path::Path) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !path.is_file() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}
async fn http(fixture: &Fixture, path: &str) -> Value {
    let (status, body) = fixture
        .send(Request::get(path).body(Body::empty()).unwrap())
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body
}
#[tokio::test]
async fn native_realtime_start_reuses_process_prewarm_config_and_record_keep_contracts() {
    let fixture = fixture().await;
    assert_eq!(
        http(&fixture, "/api/realtime/status").await["running"],
        false
    );
    let (status, body) = fixture.request("/api/realtime/prewarm", json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    running(&fixture).await;
    let first = http(&fixture, "/api/realtime/status").await;
    assert_eq!(first["running"], true);
    assert_eq!(first["wsAudio"], "/api/realtime/ws-audio");
    let (status, body) = fixture.request("/api/realtime/start", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["reused"], true);
    assert_eq!(body["startedAt"], first["startedAt"]);
    let (status, body) = fixture
        .request("/api/realtime/record", json!({"record_button":"Start"}))
        .await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["record_button"], "Start");
    let (status,body)=fixture.send(Request::put("/api/realtime/config").header("content-type","application/json").body(Body::from(json!({"model_path":"logs/音声.pth","kwargs":{"pitch":2},"silent_threshold":-45}).to_string())).unwrap()).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, _) = fixture
        .send(
            Request::put("/api/realtime/config")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"kwargs":{"pitch":4}}"#))
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    let config = http(&fixture, "/api/realtime/config").await;
    assert_eq!(config["realtime"]["model_path"], "logs/音声.pth");
    assert_eq!(config["realtime"]["kwargs"], json!({"pitch":4}));
    let (status, _) = fixture.request("/api/realtime/stop", json!({})).await;
    assert_eq!(status, StatusCode::OK);
    let stopped = http(&fixture, "/api/realtime/status").await;
    assert_eq!(stopped["running"], false);
    assert_eq!(stopped["startedAt"], Value::Null);
    let (status, _) = fixture.request("/api/realtime/record", json!({})).await;
    assert_eq!(status, StatusCode::BAD_GATEWAY);
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn realtime_restarts_once_with_cuda_graphs_disabled_and_never_claims_foreign_listeners() {
    let fixture = fixture().await;
    std::fs::write(fixture.engine.runtime.data.join("rt-mode"), "graph").unwrap();
    running(&fixture).await;
    let starts = std::fs::read_to_string(fixture.engine.runtime.data.join("rt-starts")).unwrap();
    assert_eq!(starts.lines().collect::<Vec<_>>(), ["graphs", "eager"]);
    assert!(http(&fixture, "/api/realtime/status").await["logs"]
        .as_array()
        .unwrap()
        .iter()
        .any(|line| line.as_str().unwrap().contains("eager inference")));
    fixture.engine.realtime.stop().await.unwrap();
    running(&fixture).await;
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("rt-starts"))
            .unwrap()
            .lines()
            .last(),
        Some("eager")
    );
    fixture.engine.realtime.stop().await.unwrap();
    let foreign = tokio::net::TcpListener::bind((
        std::net::Ipv4Addr::LOCALHOST,
        fixture.engine.realtime.port,
    ))
    .await
    .unwrap();
    let (status, body) = fixture.request("/api/realtime/start", json!({})).await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{body}");
    assert!(body["error"].as_str().unwrap().contains("another process"));
    assert_eq!(
        http(&fixture, "/api/realtime/status").await["running"],
        false
    );
    fixture.engine.realtime.stop().await.unwrap();
    assert!(
        tokio::net::TcpStream::connect(foreign.local_addr().unwrap())
            .await
            .is_ok()
    );
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn stop_during_start_prevents_resurrection_and_gpu_jobs_reject_realtime_start() {
    let fixture = fixture().await;
    std::fs::write(fixture.engine.runtime.data.join("rt-mode"), "slow").unwrap();
    let app = fixture.app.clone();
    let starting = tokio::spawn(async move {
        use tower::ServiceExt;
        app.oneshot(
            Request::post("/api/realtime/start")
                .header("content-type", "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap()
    });
    wait_file(&fixture.engine.runtime.data.join("rt-starts")).await;
    let generation = fixture.engine.realtime.generation();
    fixture.engine.realtime.stop().await.unwrap();
    assert_eq!(
        starting.await.unwrap().status(),
        StatusCode::INTERNAL_SERVER_ERROR
    );
    assert!(fixture
        .engine
        .realtime
        .start(&fixture.engine, generation)
        .await
        .is_err());
    assert!(!fixture.engine.realtime.reachable().await);
    let token = CancellationToken::new();
    let gpu = fixture
        .engine
        .scheduler
        .acquire("training", Resource::Gpu, &token)
        .await
        .unwrap()
        .unwrap();
    let (status, _) = fixture.request("/api/realtime/start", json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    drop(gpu);
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn binary_audio_holds_gpu_until_the_owned_tree_stops_and_config_sockets_do_not_own_it() {
    let fixture = fixture().await;
    let conversion = fixture
        .start(
            "/api/inference",
            json!({"pthPath":"voice.pth","inputPath":"input.wav"}),
        )
        .await;
    assert_eq!(
        fixture.finish(&conversion).await.status,
        crate::jobs::JobStatus::Done
    );
    assert!(fixture.engine.worker.pid().is_some());
    running(&fixture).await;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("ws://{}", listener.local_addr().unwrap());
    let app = fixture.app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let (mut config, _) =
        tokio_tungstenite::connect_async(format!("{base}/api/realtime/change-config"))
            .await
            .unwrap();
    assert!(!fixture.engine.scheduler.status().realtime);
    config
        .send(tokio_tungstenite::tungstenite::Message::Text(
            r#"{"id":"formant","key":"formant_qfrency","value":2.5}"#.into(),
        ))
        .await
        .unwrap();
    assert_eq!(
        config.next().await.unwrap().unwrap().into_text().unwrap(),
        r#"{"id":"formant","key":"formant_qfrency","value":2.5}"#
    );
    config.close(None).await.unwrap();
    assert!(fixture.engine.realtime.active().is_some());
    let (mut audio, _) = tokio_tungstenite::connect_async(format!("{base}/api/realtime/ws-audio"))
        .await
        .unwrap();
    assert!(fixture.engine.scheduler.status().realtime);
    assert!(fixture.engine.worker.pid().is_none());
    let bytes = vec![0, 255, 128, 0, 10, 13, 1, 2];
    audio
        .send(tokio_tungstenite::tungstenite::Message::Binary(
            bytes.clone().into(),
        ))
        .await
        .unwrap();
    assert_eq!(
        audio.next().await.unwrap().unwrap().into_data().as_ref(),
        bytes
    );
    let conflict = tokio_tungstenite::connect_async(format!("{base}/api/realtime/ws-audio"))
        .await
        .unwrap_err();
    assert!(
        matches!(conflict,tokio_tungstenite::tungstenite::Error::Http(response) if response.status()==StatusCode::CONFLICT)
    );
    wait_file(&fixture.engine.runtime.data.join("rt-heartbeat")).await;
    let engine = fixture.engine.clone();
    let queued = tokio::spawn(async move {
        let token = CancellationToken::new();
        let lease = engine
            .scheduler
            .acquire("after-realtime", Resource::Gpu, &token)
            .await
            .unwrap()
            .unwrap();
        let before = std::fs::read(engine.runtime.data.join("rt-heartbeat")).unwrap();
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert_eq!(
            std::fs::read(engine.runtime.data.join("rt-heartbeat")).unwrap(),
            before,
            "GPU admitted before the realtime descendant stopped"
        );
        drop(lease);
    });
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(!queued.is_finished());
    audio.close(None).await.unwrap();
    tokio::time::timeout(Duration::from_secs(5), queued)
        .await
        .unwrap()
        .unwrap();
    assert!(!fixture.engine.realtime.reachable().await);
    assert!(!fixture.engine.scheduler.status().realtime);
    fixture.engine.shutdown().await.unwrap();
    server.abort();
}

#[tokio::test]
#[ignore = "Requires APPLIO_ENGINE_TEST_PYTHON pointing to the installed Python voice environment"]
async fn real_python_realtime_control_server_starts_and_stops_without_loading_a_voice_model() {
    let mut fixture = fixture().await;
    fixture.engine.shutdown().await.unwrap();
    let code = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let config = ApiConfig {
        code_root: code,
        data_root: fixture.engine.runtime.data.clone(),
        config_dir: fixture.engine.runtime.config_dir.clone(),
    };
    let python =
        std::env::var_os("APPLIO_ENGINE_TEST_PYTHON").expect("Set APPLIO_ENGINE_TEST_PYTHON");
    let runtime =
        crate::engine_runtime::EngineRuntime::with_python(&config, Some(python.into())).unwrap();
    fixture.engine = NativeEngine::open_with_options(
        runtime.clone(),
        Arc::new(RuntimeReadiness::new(runtime, true)),
        EngineOptions {
            realtime_port: Some(fixture.engine.realtime.port),
            ..Default::default()
        },
    )
    .unwrap();
    fixture.app = crate::native::router(config, fixture.engine.clone());
    running(&fixture).await;
    let (status, body) = fixture
        .request("/api/realtime/record", json!({"record_button":"Stop"}))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["type"], "warnings");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!(
        "ws://{}/api/realtime/change-config",
        listener.local_addr().unwrap()
    );
    let app = fixture.app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let (mut socket, _) = tokio_tungstenite::connect_async(url).await.unwrap();
    socket
        .send(tokio_tungstenite::tungstenite::Message::Text(
            r#"{"id":"native-control-check"}"#.into(),
        ))
        .await
        .unwrap();
    let reply = tokio::time::timeout(Duration::from_secs(5), socket.next())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let reply: Value = serde_json::from_str(&reply.into_text().unwrap()).unwrap();
    assert_eq!(reply["type"], "config_error");
    assert_eq!(reply["id"], "native-control-check");
    assert!(!fixture.engine.scheduler.status().realtime);
    socket.close(None).await.unwrap();
    fixture.engine.shutdown().await.unwrap();
    assert!(!fixture.engine.realtime.reachable().await);
    server.abort();
}

const PYTHON: &str = r#"
import base64,hashlib,json,os,socketserver,struct,subprocess,sys,time
from pathlib import Path
with open('rt-starts','a') as f: f.write(('eager' if os.environ.get('APPLIO_DISABLE_CUDA_GRAPHS')=='1' else 'graphs')+'\n')
mode=Path('rt-mode').read_text() if Path('rt-mode').is_file() else ''
if mode=='graph' and os.environ.get('APPLIO_DISABLE_CUDA_GRAPHS')!='1':
 print('capture failed',flush=True);sys.exit(86)
if mode=='slow':time.sleep(60)
child="from pathlib import Path; import time; exec(\"while True:\\n Path('rt-heartbeat').write_text(str(time.monotonic())); time.sleep(0.02)\")"
subprocess.Popen([sys.executable,'-c',child])
class Handler(socketserver.StreamRequestHandler):
 def handle(self):
  request=self.rfile.readline()
  if not request:return
  headers={}
  while True:
   line=self.rfile.readline()
   if line in (b'\r\n',b''):break
   k,v=line.decode().split(':',1);headers[k.lower()]=v.strip()
  if headers.get('upgrade','').lower()=='websocket':
   key=base64.b64encode(hashlib.sha1((headers['sec-websocket-key']+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').encode()).digest()).decode()
   self.wfile.write(('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+key+'\r\n\r\n').encode());self.wfile.flush()
   while True:
    head=self.rfile.read(2)
    if len(head)<2:return
    opcode=head[0]&15;size=head[1]&127
    if size==126:size=struct.unpack('!H',self.rfile.read(2))[0]
    elif size==127:size=struct.unpack('!Q',self.rfile.read(8))[0]
    mask=self.rfile.read(4) if head[1]&128 else b''
    data=self.rfile.read(size)
    if mask:data=bytes(v^mask[i%4] for i,v in enumerate(data))
    if opcode==8:return
    if opcode==9:opcode=10
    frame=bytes([128|opcode,len(data)]) if len(data)<126 else bytes([128|opcode,126])+struct.pack('!H',len(data))
    self.wfile.write(frame+data);self.wfile.flush()
  else:
   body=self.rfile.read(int(headers.get('content-length','0')))
   self.wfile.write(b'HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: '+str(len(body)).encode()+b'\r\nConnection: close\r\n\r\n'+body);self.wfile.flush()
class Server(socketserver.ThreadingTCPServer):
 allow_reuse_address=True
 daemon_threads=True
port=int(sys.argv[sys.argv.index('--port')+1])
with Server(('127.0.0.1',port),Handler) as server:
 print('Realtime fixture listening',flush=True);server.serve_forever()
"#;
