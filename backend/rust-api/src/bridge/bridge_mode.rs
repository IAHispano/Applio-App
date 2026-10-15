//! Owned Bridge Mode generations. Startup is shared by concurrent callers;
//! stop cancels installation, DNS probing, the gateway and the tunnel tree.
use crate::{
    bridge_gateway::{Gateway, PairingLanguage},
    bridge_sessions::Device,
    bridge_tunnel,
    process::{CommandSpec, ManagedProcess, ProcessEvent},
};
use anyhow::{bail, Result};
use futures_util::future::BoxFuture;
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
    time::Duration,
};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub trait TunnelProvider: Send + Sync {
    fn install<'a>(
        &'a self,
        cache: &'a Path,
        token: &'a CancellationToken,
    ) -> BoxFuture<'a, Result<PathBuf>>;
    fn command(&self, binary: &Path, port: u16, config: &Path) -> CommandSpec {
        bridge_tunnel::command(binary, port, config)
    }
    fn reachable<'a>(
        &'a self,
        origin: &'a str,
        token: &'a CancellationToken,
    ) -> BoxFuture<'a, bool>;
}
pub struct Cloudflare;
impl TunnelProvider for Cloudflare {
    fn install<'a>(
        &'a self,
        cache: &'a Path,
        token: &'a CancellationToken,
    ) -> BoxFuture<'a, Result<PathBuf>> {
        Box::pin(bridge_tunnel::install(cache, token))
    }
    fn reachable<'a>(
        &'a self,
        origin: &'a str,
        token: &'a CancellationToken,
    ) -> BoxFuture<'a, bool> {
        Box::pin(bridge_tunnel::reachable(origin, token))
    }
}
#[derive(Clone)]
pub struct Options {
    pub cache_dir: PathBuf,
    pub web_port: u16,
    pub api_port: u16,
    pub font_path: Option<PathBuf>,
    pub language: PairingLanguage,
    pub on_request: Arc<dyn Fn(Device) + Send + Sync>,
}
struct Session {
    id: Uuid,
    stop: CancellationToken,
    ready: watch::Receiver<Option<Value>>,
    done: watch::Receiver<bool>,
    task: Option<tokio::task::JoinHandle<()>>,
}
struct State {
    generation: u64,
    status: &'static str,
    message: Option<String>,
    link: Option<String>,
    expires: Option<u64>,
    origin: Option<String>,
    gateway: Option<Arc<Gateway>>,
    session: Option<Session>,
}
impl Default for State {
    fn default() -> Self {
        Self {
            generation: 0,
            status: "stopped",
            message: None,
            link: None,
            expires: None,
            origin: None,
            gateway: None,
            session: None,
        }
    }
}
pub struct BridgeMode {
    options: Options,
    provider: Arc<dyn TunnelProvider>,
    root: CancellationToken,
    state: Mutex<State>,
    operation: tokio::sync::Mutex<()>,
}
impl BridgeMode {
    pub fn new(options: Options, root: CancellationToken) -> Arc<Self> {
        Self::with_provider(options, root, Arc::new(Cloudflare))
    }
    pub fn with_provider(
        options: Options,
        root: CancellationToken,
        provider: Arc<dyn TunnelProvider>,
    ) -> Arc<Self> {
        Arc::new(Self {
            options,
            provider,
            root,
            state: Mutex::default(),
            operation: tokio::sync::Mutex::new(()),
        })
    }
    pub fn state(&self) -> Value {
        let state = self.state.lock().unwrap();
        let mut value = json!({"status":state.status,"devices":state.gateway.as_ref().map(|g|g.sessions.list()).unwrap_or_default()});
        if let Some(message) = &state.message {
            value["message"] = json!(message);
        }
        if let Some(link) = &state.link {
            value["link"] = json!(link);
        }
        if let Some(expires) = state.expires {
            value["inviteExpiresAt"] = json!(expires);
        }
        value
    }
    pub async fn start(self: &Arc<Self>) -> Result<Value> {
        let generation = self.state.lock().unwrap().generation;
        let operation = self.operation.lock().await;
        if self.root.is_cancelled() {
            bail!("Bridge Mode is shutting down.");
        }
        let pending = {
            let state = self.state.lock().unwrap();
            if state.generation != generation {
                drop(state);
                return Ok(self.state());
            }
            if state.status == "sharing" {
                drop(state);
                return Ok(self.state());
            }
            state.session.as_ref().map(|session| {
                (
                    session.stop.clone(),
                    session.ready.clone(),
                    session.done.clone(),
                )
            })
        };
        if let Some((stop, mut ready, mut done)) = pending {
            if !*done.borrow() && !stop.is_cancelled() {
                drop(operation);
                while ready.borrow().is_none() {
                    if ready.changed().await.is_err() {
                        break;
                    }
                }
                return Ok(ready.borrow().clone().unwrap_or_else(|| self.state()));
            }
            while !*done.borrow() {
                if done.changed().await.is_err() {
                    break;
                }
            }
        }
        let id = Uuid::new_v4();
        let stop = self.root.child_token();
        let (ready, receiver) = watch::channel(None);
        let (done, completed) = watch::channel(false);
        {
            let mut state = self.state.lock().unwrap();
            if state.generation != generation || self.root.is_cancelled() {
                drop(state);
                return Ok(self.state());
            }
            state.status = "starting";
            state.message = Some("Preparing the internet tunnel…".into());
            state.link = None;
            state.expires = None;
            state.origin = None;
            state.gateway = None;
            state.session = Some(Session {
                id,
                stop: stop.clone(),
                ready: receiver.clone(),
                done: completed,
                task: None,
            });
        }
        let owner = Arc::downgrade(self);
        let options = self.options.clone();
        let provider = self.provider.clone();
        let task = tokio::spawn(async move {
            let mut owned = Actor {
                owner: owner.clone(),
                id,
                stop: stop.clone(),
                ready,
                done,
                process: None,
                gateway: None,
                server: None,
            };
            let result = open(&owner, id, &options, provider.as_ref(), &stop, &mut owned).await;
            owned.cleanup().await;
            if let Some(owner) = owner.upgrade() {
                let mut state = owner.state.lock().unwrap();
                if state.session.as_ref().is_some_and(|s| s.id == id) {
                    state.gateway = None;
                    state.origin = None;
                    state.link = None;
                    state.expires = None;
                    if stop.is_cancelled() {
                        state.status = "stopped";
                        state.message = None;
                    } else {
                        state.status = "error";
                        state.message=Some(result.err().map_or_else(||"The internet tunnel disconnected. Start sharing again to create a new link.".into(),|e|e.to_string()));
                    }
                }
            }
        });
        {
            let mut state = self.state.lock().unwrap();
            if let Some(session) = state.session.as_mut().filter(|s| s.id == id) {
                session.task = Some(task);
            } else {
                task.abort();
            }
        }
        drop(operation);
        let mut ready = receiver;
        while ready.borrow().is_none() {
            if ready.changed().await.is_err() {
                break;
            }
        }
        let result = ready.borrow().clone().unwrap_or_else(|| self.state());
        Ok(result)
    }
    pub async fn stop(&self) -> Result<Value> {
        let pending = {
            let mut state = self.state.lock().unwrap();
            state.generation += 1;
            state.status = "stopped";
            state.message = None;
            state.link = None;
            state.expires = None;
            state.origin = None;
            if let Some(gateway) = state.gateway.take() {
                gateway.stop();
            }
            state.session.as_ref().map(|session| {
                session.stop.cancel();
                (session.id, session.done.clone())
            })
        };
        if let Some((id, mut done)) = pending {
            if tokio::time::timeout(Duration::from_secs(10), async {
                while !*done.borrow() {
                    if done.changed().await.is_err() {
                        break;
                    }
                }
            })
            .await
            .is_err()
            {
                let task = {
                    let mut state = self.state.lock().unwrap();
                    state
                        .session
                        .as_mut()
                        .filter(|s| s.id == id)
                        .and_then(|s| s.task.take())
                };
                if let Some(task) = task {
                    task.abort();
                    let _ = task.await;
                }
            }
        }
        Ok(self.state())
    }
    pub fn new_invite(&self) -> Result<Value> {
        let mut state = self.state.lock().unwrap();
        if state.status != "sharing" {
            bail!("Start Bridge Mode first.");
        }
        let gateway = state
            .gateway
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Start Bridge Mode first."))?;
        if gateway.stopped.is_cancelled() {
            bail!("Bridge Mode is stopped.");
        }
        let invite = gateway.sessions.new_invite()?;
        state.link = Some(format!(
            "{}/bridge#invite={}",
            state.origin.as_deref().unwrap(),
            invite.token
        ));
        state.expires = Some(invite.expires_at);
        drop(state);
        Ok(self.state())
    }
    pub fn approve(&self, id: &str) -> Result<Value> {
        validate_id(id)?;
        let gateway = {
            let state = self.state.lock().unwrap();
            if state.status != "sharing" {
                bail!("Bridge Mode is stopped.");
            }
            state.gateway.clone().unwrap()
        };
        gateway.sessions.approve(id)?;
        Ok(self.state())
    }
    pub fn revoke(&self, id: &str) -> Result<Value> {
        validate_id(id)?;
        if let Some(gateway) = self.state.lock().unwrap().gateway.clone() {
            gateway.sessions.revoke(id);
        }
        Ok(self.state())
    }
}
impl Drop for BridgeMode {
    fn drop(&mut self) {
        let state = self.state.get_mut().unwrap();
        if let Some(session) = &mut state.session {
            session.stop.cancel();
            if let Some(task) = session.task.take() {
                task.abort();
            }
        }
        if let Some(gateway) = state.gateway.take() {
            gateway.stop();
        }
    }
}
fn validate_id(id: &str) -> Result<()> {
    if id.len() != 32
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
    {
        bail!("Invalid device.");
    }
    Ok(())
}
struct Actor {
    owner: Weak<BridgeMode>,
    id: Uuid,
    stop: CancellationToken,
    ready: watch::Sender<Option<Value>>,
    done: watch::Sender<bool>,
    process: Option<ManagedProcess>,
    gateway: Option<Arc<Gateway>>,
    server: Option<tokio::task::JoinHandle<Result<()>>>,
}
impl Actor {
    async fn cleanup(&mut self) {
        if let Some(gateway) = &self.gateway {
            gateway.stop();
        }
        if let Some(process) = self.process.as_mut() {
            let _ = process.stop().await;
        }
        drop(self.process.take());
        if let Some(mut server) = self.server.take() {
            if tokio::time::timeout(Duration::from_secs(2), &mut server)
                .await
                .is_err()
            {
                server.abort();
                let _ = server.await;
            }
        }
    }
}
impl Drop for Actor {
    fn drop(&mut self) {
        drop(self.process.take());
        if let Some(gateway) = self.gateway.take() {
            gateway.stop();
        }
        if let Some(server) = self.server.take() {
            server.abort();
        }
        if let Some(owner) = self.owner.upgrade() {
            let mut state = owner.state.lock().unwrap();
            if state.session.as_ref().is_some_and(|s| s.id == self.id) {
                state.gateway = None;
                state.link = None;
                state.expires = None;
                state.origin = None;
                if state.status == "starting" || state.status == "sharing" {
                    state.status = if self.stop.is_cancelled() {
                        "stopped"
                    } else {
                        "error"
                    };
                    state.message =
                        (!self.stop.is_cancelled()).then(|| "Bridge task interrupted.".into());
                }
            }
            drop(state);
            if self.ready.borrow().is_none() {
                self.ready.send_replace(Some(owner.state()));
            }
        }
        self.done.send_replace(true);
    }
}
async fn open(
    owner: &Weak<BridgeMode>,
    id: Uuid,
    options: &Options,
    provider: &dyn TunnelProvider,
    stop: &CancellationToken,
    owned: &mut Actor,
) -> Result<()> {
    let binary = provider.install(&options.cache_dir, stop).await?;
    if stop.is_cancelled() {
        return Ok(());
    }
    tokio::fs::create_dir_all(&options.cache_dir).await?;
    let config = options.cache_dir.join("bridge-config.yml");
    let mut file_options = tokio::fs::OpenOptions::new();
    file_options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        file_options.mode(0o600);
    }
    let mut file = file_options.open(&config).await?;
    use tokio::io::AsyncWriteExt;
    file.write_all(b"{}\n").await?;
    drop(file);
    let font = if let Some(path) = &options.font_path {
        Some(tokio::fs::read(path).await?)
    } else {
        None
    };
    if stop.is_cancelled() {
        return Ok(());
    }
    let gateway = Gateway::new(
        options.web_port,
        options.api_port,
        font,
        options.language.clone(),
        options.on_request.clone(),
        stop.child_token(),
    )?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    owned.gateway = Some(gateway.clone());
    let serving = gateway.clone();
    owned.server = Some(tokio::spawn(async move { serving.serve(listener).await }));
    if let Some(owner) = owner.upgrade() {
        let mut state = owner.state.lock().unwrap();
        if state.session.as_ref().is_some_and(|s| s.id == id) {
            state.gateway = Some(gateway.clone());
        }
    }
    if stop.is_cancelled() {
        return Ok(());
    }
    owned.process = Some(ManagedProcess::spawn(
        &provider.command(&binary, port, &config),
    )?);
    let origin = bridge_tunnel::wait_origin(owned.process.as_mut().unwrap(), stop).await?;
    gateway.set_origin(&origin)?;
    if let Some(owner) = owner.upgrade() {
        let mut state = owner.state.lock().unwrap();
        if state.session.as_ref().is_some_and(|s| s.id == id) {
            state.message = Some("Waiting for the private link to become reachable…".into());
        }
    }
    let deadline = tokio::time::Instant::now() + Duration::from_secs(60);
    let mut reachable = false;
    while tokio::time::Instant::now() < deadline && !stop.is_cancelled() {
        reachable = provider.reachable(&origin, stop).await;
        if reachable {
            break;
        }
        tokio::select! {_=stop.cancelled()=>break,_=tokio::time::sleep(Duration::from_secs(2))=>{}}
    }
    if stop.is_cancelled() {
        return Ok(());
    }
    if !reachable {
        bail!("The internet tunnel connected, but its public link is unreachable. Try again or check your network/DNS settings.");
    }
    if let Some(owner) = owner.upgrade() {
        let mut state = owner.state.lock().unwrap();
        if state.session.as_ref().is_some_and(|s| s.id == id) {
            state.status = "sharing";
            state.message = None;
            state.origin = Some(origin);
            let invite = gateway.sessions.new_invite()?;
            state.link = Some(format!(
                "{}/bridge#invite={}",
                state.origin.as_deref().unwrap(),
                invite.token
            ));
            state.expires = Some(invite.expires_at);
        }
        drop(state);
        owned.ready.send_replace(Some(owner.state()));
    }
    let mut closed = false;
    loop {
        let process = owned.process.as_mut().unwrap();
        let event = tokio::select! {biased;_=stop.cancelled()=>return Ok(()),event=async{if closed{process.wait().await.map(ProcessEvent::Exited)}else{process.next_event().await}}=>event?};
        match event {
            ProcessEvent::Line(_, _) => {}
            ProcessEvent::OutputClosed => closed = true,
            ProcessEvent::Exited(_) => {
                bail!("The internet tunnel disconnected. Start sharing again to create a new link.")
            }
        }
    }
}
