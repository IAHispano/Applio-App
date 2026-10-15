//! Realtime process generations and GPU ownership. The lease belongs to the
//! supervisor, so a dropped request/socket can never admit GPU work before its
//! Python process tree has stopped.
use crate::{
    engine::NativeEngine,
    engine_runtime::EngineRuntime,
    process::{ManagedProcess, ProcessEvent, Stream},
    scheduler::RealtimeLease,
};
use anyhow::{bail, Result};
use serde_json::{json, Value};
use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::sync::watch;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

struct Session {
    id: Uuid,
    stop: CancellationToken,
    done: watch::Receiver<bool>,
    started_at: String,
}
#[derive(Default)]
struct State {
    generation: u64,
    session: Option<Session>,
    lease: Option<RealtimeLease>,
    logs: VecDeque<String>,
}
pub struct Realtime {
    runtime: EngineRuntime,
    pub port: u16,
    state: Mutex<State>,
    operation: tokio::sync::Mutex<()>,
    graphs_disabled: AtomicBool,
}
struct Completion {
    manager: Arc<Realtime>,
    id: Uuid,
    done: watch::Sender<bool>,
}
struct OwnedProcess {
    process: Option<ManagedProcess>,
    _completion: Completion,
}
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        drop(self.process.take());
    }
}
impl Drop for Completion {
    fn drop(&mut self) {
        // The supervisor declares its process after this guard. Rust drops the
        // process first even if the supervisor task is aborted during an await.
        let mut state = self.manager.state.lock().unwrap();
        if state
            .session
            .as_ref()
            .is_some_and(|session| session.id == self.id)
        {
            state.lease.take();
        }
        self.done.send_replace(true);
    }
}
pub struct AudioSession {
    manager: Arc<Realtime>,
    id: Uuid,
    pub stopped: CancellationToken,
}
impl Drop for AudioSession {
    fn drop(&mut self) {
        let state = self.manager.state.lock().unwrap();
        if let Some(session) = state.session.as_ref().filter(|s| s.id == self.id) {
            session.stop.cancel();
        }
    }
}
impl Realtime {
    pub fn new(runtime: EngineRuntime, port: Option<u16>) -> Arc<Self> {
        Arc::new(Self {
            runtime,
            port: port
                .or_else(|| std::env::var("RT_PORT").ok().and_then(|v| v.parse().ok()))
                .unwrap_or(8001),
            state: Mutex::default(),
            operation: tokio::sync::Mutex::new(()),
            graphs_disabled: AtomicBool::new(false),
        })
    }
    pub fn generation(&self) -> u64 {
        self.state.lock().unwrap().generation
    }
    pub fn active(&self) -> Option<(String, CancellationToken)> {
        let state = self.state.lock().unwrap();
        state
            .session
            .as_ref()
            .filter(|s| !*s.done.borrow() && !s.stop.is_cancelled())
            .map(|s| (s.started_at.clone(), s.stop.clone()))
    }
    pub fn status(&self) -> Value {
        let state = self.state.lock().unwrap();
        json!({"startedAt":state.session.as_ref().map(|s|&s.started_at),"wsAudio":"/api/realtime/ws-audio","wsConfig":"/api/realtime/change-config","logs":state.logs.iter().skip(state.logs.len().saturating_sub(30)).collect::<Vec<_>>()})
    }
    fn log(&self, line: &str) {
        let mut state = self.state.lock().unwrap();
        state.logs.push_back(line.chars().take(2000).collect());
        while state.logs.len() > 200 {
            state.logs.pop_front();
        }
    }
    pub async fn reachable(&self) -> bool {
        tokio::time::timeout(
            Duration::from_millis(150),
            tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, self.port)),
        )
        .await
        .is_ok_and(|r| r.is_ok())
    }
    pub async fn start(
        self: &Arc<Self>,
        engine: &Arc<NativeEngine>,
        expected: u64,
    ) -> Result<(String, bool)> {
        let _operation = self.operation.lock().await;
        let root = engine.cancellation_token();
        if root.is_cancelled() {
            bail!("Applio is shutting down");
        }
        let pending = {
            let state = self.state.lock().unwrap();
            if state.generation != expected {
                bail!("Realtime start cancelled by stop");
            }
            if let Some(session) = &state.session {
                if !*session.done.borrow() && !session.stop.is_cancelled() {
                    return Ok((session.started_at.clone(), true));
                }
                Some(session.done.clone())
            } else {
                None
            }
        };
        if let Some(mut done) = pending {
            while !*done.borrow() {
                if done.changed().await.is_err() {
                    break;
                }
            }
        }
        if self.reachable().await {
            bail!("The realtime port is already in use by another process.");
        }
        let (done, receiver) = watch::channel(false);
        let id = Uuid::new_v4();
        let stop = root.child_token();
        let started_at = crate::jobs::timestamp();
        let completion = Completion {
            manager: self.clone(),
            id,
            done,
        };
        let command = self.command()?;
        {
            let mut state = self.state.lock().unwrap();
            if state.generation != expected || root.is_cancelled() {
                bail!("Realtime start cancelled by stop");
            }
            state.logs.clear();
            state.session = Some(Session {
                id,
                stop: stop.clone(),
                done: receiver,
                started_at: started_at.clone(),
            });
        }
        // Register completion before spawning. Concurrent stop/shutdown waits
        // even while the OS is still starting the interpreter.
        if stop.is_cancelled() {
            bail!("Realtime start cancelled by stop");
        }
        let process = ManagedProcess::spawn(&command)?;
        let manager = self.clone();
        let owned = OwnedProcess {
            process: Some(process),
            _completion: completion,
        };
        engine.spawn_background(async move {
            let mut owned=owned;
            let mut closed=false;
            loop {
                let process=owned.process.as_mut().unwrap();
                let event=tokio::select! {
                    biased;
                    _=stop.cancelled()=>{let _=process.stop().await;break;},
                    event=async {if closed {process.wait().await.map(ProcessEvent::Exited)} else {process.next_event().await}}=>event,
                };
                match event {
                    Ok(ProcessEvent::Line(stream,line))=>manager.log(&if stream==Stream::Stderr {format!("[stderr] {line}")} else {line}),
                    Ok(ProcessEvent::OutputClosed)=>closed=true,
                    Ok(ProcessEvent::Exited(code))=>{
                        let _=process.stop().await;
                        if code==Some(86) && !stop.is_cancelled() && !manager.graphs_disabled.swap(true,Ordering::SeqCst) {
                            manager.log("Restarting realtime with eager inference after an unsupported CUDA graph.");
                            let replacement=manager.command().and_then(|spec|ManagedProcess::spawn(&spec));
                            match replacement {
                                Ok(next)=>{owned.process=Some(next);closed=false;continue;},
                                Err(error)=>manager.log(&format!("Realtime restart failed: {error}")),
                            }
                        } else {manager.log(&format!("Realtime engine exited with code {code:?}"));}
                        break;
                    },
                    Err(error)=>{manager.log(&format!("Realtime process failed: {error}"));let _=process.stop().await;break;},
                }
            }
        }).await?;
        Ok((started_at, false))
    }
    fn command(&self) -> Result<crate::process::CommandSpec> {
        let mut spec = self.runtime.python_command([
            "-m",
            "uvicorn",
            "rvc.realtime.client:app",
            "--host",
            "127.0.0.1",
            "--port",
            &self.port.to_string(),
        ])?;
        spec.env.insert(
            "APPLIO_ENABLE_CUDA_GRAPHS".into(),
            std::env::var_os("APPLIO_ENABLE_CUDA_GRAPHS").unwrap_or_else(|| "1".into()),
        );
        if self.graphs_disabled.load(Ordering::SeqCst) {
            spec.env
                .insert("APPLIO_DISABLE_CUDA_GRAPHS".into(), "1".into());
        }
        Ok(spec)
    }
    pub fn begin_audio(self: &Arc<Self>, engine: &NativeEngine) -> Option<AudioSession> {
        let mut state = self.state.lock().unwrap();
        let session = state
            .session
            .as_ref()
            .filter(|s| !*s.done.borrow() && !s.stop.is_cancelled())?;
        let (id, stopped) = (session.id, session.stop.clone());
        if state.lease.is_some() {
            return None;
        }
        state.lease = Some(engine.scheduler.begin_realtime()?);
        Some(AudioSession {
            manager: self.clone(),
            id,
            stopped,
        })
    }
    pub async fn stop(&self) -> Result<()> {
        let pending = {
            let mut state = self.state.lock().unwrap();
            state.generation += 1;
            state.session.as_ref().map(|session| {
                session.stop.cancel();
                (session.id, session.done.clone())
            })
        };
        if let Some((id, mut done)) = pending {
            tokio::time::timeout(Duration::from_secs(10), async {
                while !*done.borrow() {
                    if done.changed().await.is_err() {
                        break;
                    }
                }
            })
            .await
            .map_err(|_| anyhow::anyhow!("Realtime did not stop in time"))?;
            let mut state = self.state.lock().unwrap();
            if state
                .session
                .as_ref()
                .is_some_and(|session| session.id == id)
            {
                state.session = None;
            }
        }
        Ok(())
    }
}
