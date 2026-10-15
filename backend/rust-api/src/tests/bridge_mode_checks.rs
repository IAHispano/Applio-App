use crate::{
    bridge_mode::{BridgeMode, Options, TunnelProvider},
    process::CommandSpec,
};
use anyhow::Result;
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;

struct FixtureProvider {
    cwd: PathBuf,
    installs: AtomicUsize,
    port: AtomicUsize,
    allow_install: AtomicBool,
    reachable: AtomicBool,
    probe: AtomicUsize,
    exit: bool,
}
impl TunnelProvider for FixtureProvider {
    fn install<'a>(
        &'a self,
        _: &'a Path,
        token: &'a CancellationToken,
    ) -> BoxFuture<'a, Result<PathBuf>> {
        Box::pin(async move {
            self.installs.fetch_add(1, Ordering::SeqCst);
            while !self.allow_install.load(Ordering::SeqCst) {
                tokio::select! {_=token.cancelled()=>{tokio::time::sleep(Duration::from_millis(100)).await;anyhow::bail!("fixture cancelled")},_=tokio::time::sleep(Duration::from_millis(10))=>{}}
            }
            Ok(PathBuf::from(if cfg!(windows) {
                "python"
            } else {
                "python3"
            }))
        })
    }
    fn command(&self, binary: &Path, port: u16, _: &Path) -> CommandSpec {
        self.port.store(port as usize, Ordering::SeqCst);
        let code = if self.exit {
            "import sys;sys.exit(4)"
        } else {
            PROGRAM
        };
        CommandSpec::new(binary, &self.cwd).args(["-u", "-c", code])
    }
    fn reachable<'a>(&'a self, _: &'a str, _: &'a CancellationToken) -> BoxFuture<'a, bool> {
        Box::pin(async move {
            self.probe.fetch_add(1, Ordering::SeqCst);
            self.reachable.load(Ordering::SeqCst)
        })
    }
}
type Fixture = (
    tempfile::TempDir,
    Arc<BridgeMode>,
    Arc<FixtureProvider>,
    Arc<Mutex<Vec<crate::bridge_sessions::Device>>>,
);
fn fixture(allow: bool, reachable: bool, exit: bool) -> Fixture {
    let directory = tempfile::tempdir().unwrap();
    let provider = Arc::new(FixtureProvider {
        cwd: directory.path().to_owned(),
        installs: AtomicUsize::new(0),
        port: AtomicUsize::new(0),
        allow_install: AtomicBool::new(allow),
        reachable: AtomicBool::new(reachable),
        probe: AtomicUsize::new(0),
        exit,
    });
    let requests = Arc::new(Mutex::new(Vec::new()));
    let requested = requests.clone();
    let bridge = BridgeMode::with_provider(
        Options {
            cache_dir: directory.path().join("cache"),
            web_port: 1,
            api_port: 1,
            font_path: None,
            language: Arc::new(|| ("en_US".into(), json!({}))),
            on_request: Arc::new(move |device| requested.lock().unwrap().push(device)),
        },
        CancellationToken::new(),
        provider.clone(),
    );
    (directory, bridge, provider, requests)
}
async fn until(mut condition: impl FnMut() -> bool) {
    tokio::time::timeout(Duration::from_secs(5), async {
        while !condition() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
}
#[tokio::test]
async fn sharing_start_is_deduplicated_pairing_is_native_and_stop_owns_the_tunnel_tree() {
    let (directory, bridge, provider, requests) = fixture(true, true, false);
    let (first, second) = tokio::join!(bridge.start(), bridge.start());
    let first = first.unwrap();
    let second = second.unwrap();
    assert_eq!(first["status"], "sharing");
    assert_eq!(first["link"], second["link"]);
    assert_eq!(provider.installs.load(Ordering::SeqCst), 1);
    let invite = first["link"]
        .as_str()
        .unwrap()
        .split_once("#invite=")
        .unwrap()
        .1;
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let port = provider.port.load(Ordering::SeqCst);
    let base = format!("http://127.0.0.1:{port}");
    let response = client
        .post(format!("{base}/bridge/pair"))
        .header("host", "native-fixture.trycloudflare.com")
        .header("origin", "https://native-fixture.trycloudflare.com")
        .json(&json!({"invite":invite,"name":"Phone"}))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), reqwest::StatusCode::ACCEPTED);
    let cookie = response.headers()["set-cookie"]
        .to_str()
        .unwrap()
        .split(';')
        .next()
        .unwrap()
        .to_owned();
    let device = requests.lock().unwrap()[0].clone();
    assert_eq!(bridge.state()["devices"][0]["status"], "pending");
    bridge.approve(&device.id).unwrap();
    let session: Value = client
        .get(format!("{base}/bridge/session"))
        .header("host", "native-fixture.trycloudflare.com")
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(session["status"], "approved");
    assert_ne!(bridge.new_invite().unwrap()["link"], first["link"]);
    bridge.revoke(&device.id).unwrap();
    assert!(bridge.state()["devices"].as_array().unwrap().is_empty());
    until(|| directory.path().join("tunnel-heartbeat").is_file()).await;
    assert_eq!(bridge.stop().await.unwrap()["status"], "stopped");
    let heartbeat = std::fs::read(directory.path().join("tunnel-heartbeat")).unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(
        std::fs::read(directory.path().join("tunnel-heartbeat")).unwrap(),
        heartbeat
    );
    assert!(
        tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port as u16))
            .await
            .is_err()
    );
    assert_eq!(bridge.start().await.unwrap()["status"], "sharing");
    assert_eq!(provider.installs.load(Ordering::SeqCst), 2);
    bridge.stop().await.unwrap();
}
#[tokio::test]
async fn stop_during_install_or_edge_probe_prevents_a_late_invitation_and_allows_a_fresh_start() {
    for installing in [true, false] {
        let (_directory, bridge, provider, _) = fixture(!installing, false, false);
        let started = bridge.clone();
        let starting = tokio::spawn(async move { started.start().await.unwrap() });
        until(|| {
            if installing {
                provider.installs.load(Ordering::SeqCst) > 0
            } else {
                provider.probe.load(Ordering::SeqCst) > 0
            }
        })
        .await;
        assert_eq!(bridge.stop().await.unwrap()["status"], "stopped");
        assert_eq!(starting.await.unwrap()["status"], "stopped");
        assert!(bridge.state().get("link").is_none());
        provider.allow_install.store(true, Ordering::SeqCst);
        provider.reachable.store(true, Ordering::SeqCst);
        assert_eq!(bridge.start().await.unwrap()["status"], "sharing");
        bridge.stop().await.unwrap();
    }
}
#[tokio::test]
async fn early_tunnel_failure_is_reported_without_exposing_an_invitation() {
    let (_directory, bridge, _provider, _) = fixture(true, true, true);
    let state = bridge.start().await.unwrap();
    assert_eq!(state["status"], "error");
    assert!(state.get("link").is_none());
    assert!(state["message"]
        .as_str()
        .unwrap()
        .contains("stopped before connecting"));
    bridge.stop().await.unwrap();
}
#[tokio::test]
async fn a_later_stop_invalidates_a_start_waiting_for_previous_cleanup() {
    let (_directory, bridge, provider, _) = fixture(false, false, false);
    let initial = bridge.clone();
    let starting = tokio::spawn(async move { initial.start().await.unwrap() });
    until(|| provider.installs.load(Ordering::SeqCst) == 1).await;
    let previous = bridge.clone();
    let stopping = tokio::spawn(async move { previous.stop().await.unwrap() });
    until(|| bridge.state()["status"] == "stopped").await;
    let waiting = bridge.clone();
    let queued = tokio::spawn(async move { waiting.start().await.unwrap() });
    tokio::task::yield_now().await;
    bridge.stop().await.unwrap();
    assert_eq!(queued.await.unwrap()["status"], "stopped");
    assert_eq!(starting.await.unwrap()["status"], "stopped");
    stopping.await.unwrap();
    assert_eq!(provider.installs.load(Ordering::SeqCst), 1);
}
const PROGRAM: &str = r#"
import subprocess,sys,time
code="from pathlib import Path;import time;exec(\"while True:\\n Path('tunnel-heartbeat').write_text(str(time.monotonic()));time.sleep(0.02)\")"
subprocess.Popen([sys.executable,'-c',code])
print('https://native-fixture.trycloudflare.com',flush=True)
print('Registered tunnel connection',flush=True)
while True:time.sleep(1)
"#;
