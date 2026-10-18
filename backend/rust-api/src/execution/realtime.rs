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
/// Written for the lifetime of a realtime engine process so a later run can
/// recognize an engine that outlived its app (forced quit or crash).
#[derive(serde::Deserialize, serde::Serialize)]
struct ProcessRecord {
    pid: u32,
    port: u16,
}

// A Python name alone is not proof of ownership: recorded pids can be reused.
// Require our exact entry point, app directory and port before signaling.
#[cfg(any(unix, test))]
fn is_realtime_command(args: &[std::ffi::OsString], code: &std::path::Path, port: u16) -> bool {
    let python = args
        .first()
        .and_then(|arg| std::path::Path::new(arg).file_name())
        .is_some_and(|name| {
            name.to_string_lossy()
                .to_ascii_lowercase()
                .contains("python")
        });
    let pair = |flag: &str, value: &std::ffi::OsStr| {
        args.windows(2)
            .any(|args| args[0] == flag && args[1] == value)
    };
    python
        && pair("-m", std::ffi::OsStr::new("uvicorn"))
        && args
            .iter()
            .any(|arg| arg == "backend.python.realtime.service:app")
        && pair("--app-dir", code.as_os_str())
        && pair("--port", std::ffi::OsStr::new(&port.to_string()))
}

#[cfg(unix)]
async fn owned_realtime_pids(code: std::path::PathBuf, port: u16) -> Vec<u32> {
    tokio::task::spawn_blocking(move || {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
        let mut system = System::new();
        system.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
        );
        system
            .processes()
            .iter()
            .filter(|(_, process)| is_realtime_command(process.cmd(), &code, port))
            .map(|(pid, _)| pid.as_u32())
            .collect()
    })
    .await
    .unwrap_or_default()
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
    fn record_path(&self) -> std::path::PathBuf {
        self.runtime.config_dir.join("realtime.pid")
    }
    /// Record the engine pid so a future run can reclaim the port when this
    /// app is killed before it could stop its child.
    fn record_process(&self, pid: u32) {
        let record = ProcessRecord {
            pid,
            port: self.port,
        };
        if let Ok(text) = serde_json::to_string(&record) {
            let _ = std::fs::write(self.record_path(), text);
        }
    }
    fn clear_process_record(&self) {
        let _ = std::fs::remove_file(self.record_path());
    }
    #[cfg(unix)]
    async fn wait_for_port_release(&self, limit: Duration) -> bool {
        let deadline = tokio::time::Instant::now() + limit;
        loop {
            if !self.reachable().await {
                return true;
            }
            if tokio::time::Instant::now() >= deadline {
                return false;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }
    /// Recognize leftovers even when an older build or a forced exit left no
    /// pid record. Unrelated Python services must never be terminated.
    #[cfg(unix)]
    async fn reap_stale_process(&self) -> bool {
        let pids = owned_realtime_pids(self.runtime.code.clone(), self.port).await;
        if pids.is_empty() {
            return false;
        }
        for pid in pids {
            self.log(&format!(
                "Reclaiming realtime port {} from a previous run (pid {}).",
                self.port, pid
            ));
            crate::process::signal_process(pid, false);
        }
        if !self.wait_for_port_release(Duration::from_secs(3)).await {
            // Refresh identity before escalation; a terminated process's pid
            // may already belong to something else.
            for pid in owned_realtime_pids(self.runtime.code.clone(), self.port).await {
                crate::process::signal_process(pid, true);
            }
        }
        let released = self.wait_for_port_release(Duration::from_secs(2)).await;
        if released {
            self.clear_process_record();
        } else {
            self.log(&format!(
                "Realtime port {} is still occupied after cleanup.",
                self.port
            ));
        }
        released
    }
    #[cfg(not(unix))]
    async fn reap_stale_process(&self) -> bool {
        false
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
            // A previous run may have been unable to stop its engine (forced
            // quit, crash). Reclaim the port when the recorded process is ours.
            self.reap_stale_process().await;
            if self.reachable().await {
                bail!("The realtime port is already in use by another process.");
            }
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
        if let Some(pid) = process.id() {
            self.record_process(pid);
        }
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
                                Ok(next)=>{
                                    if let Some(pid)=next.id(){manager.record_process(pid);}
                                    owned.process=Some(next);closed=false;continue;
                                },
                                Err(error)=>manager.log(&format!("Realtime restart failed: {error}")),
                            }
                        } else {manager.log(&format!("Realtime engine exited with code {code:?}"));}
                        break;
                    },
                    Err(error)=>{manager.log(&format!("Realtime process failed: {error}"));let _=process.stop().await;break;},
                }
            }
            manager.clear_process_record();
        }).await?;
        Ok((started_at, false))
    }
    fn command(&self) -> Result<crate::process::CommandSpec> {
        // The repo entry point re-exports the pinned engine's app while
        // caching model loads across connections and prewarming the pipeline.
        let app_dir = self.runtime.code.to_string_lossy().into_owned();
        let mut spec = self.runtime.python_command([
            "-m",
            "uvicorn",
            "--app-dir",
            app_dir.as_str(),
            "backend.python.realtime.service:app",
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::{ffi::OsString, path::Path};

    fn command() -> Vec<OsString> {
        [
            "/usr/bin/python3",
            "-m",
            "uvicorn",
            "--app-dir",
            "/Applications/Applio.app/Contents/Resources/app",
            "backend.python.realtime.service:app",
            "--host",
            "127.0.0.1",
            "--port",
            "8001",
        ]
        .into_iter()
        .map(OsString::from)
        .collect()
    }

    #[test]
    fn recognizes_only_this_apps_realtime_command() {
        let code = Path::new("/Applications/Applio.app/Contents/Resources/app");
        let args = command();
        assert!(is_realtime_command(&args, code, 8001));
        assert!(!is_realtime_command(&args, code, 8002));
        assert!(!is_realtime_command(&args, Path::new("/other/app"), 8001));
        for index in [0, 2, 5] {
            let mut unrelated = args.clone();
            unrelated[index] = "unrelated".into();
            assert!(!is_realtime_command(&unrelated, code, 8001));
        }
        assert!(!is_realtime_command(&[], code, 8001));
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn discovers_recordless_engine_and_releases_its_port() {
        let directory = tempfile::tempdir().unwrap();
        // A tiny stand-in uvicorn uses only Python's standard library.
        std::fs::write(
            directory.path().join("uvicorn.py"),
            r#"
import socket, sys, time
listener = socket.socket()
listener.bind(('127.0.0.1', int(sys.argv[sys.argv.index('--port') + 1])))
listener.listen()
time.sleep(60)
"#,
        )
        .unwrap();
        let listener = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let code = directory.path().to_path_buf();
        let spec = crate::process::CommandSpec::new("python3", &code).args([
            OsString::from("-m"),
            "uvicorn".into(),
            "--app-dir".into(),
            code.clone().into_os_string(),
            "backend.python.realtime.service:app".into(),
            "--port".into(),
            port.to_string().into(),
        ]);
        let mut process = ManagedProcess::spawn(&spec).unwrap();
        let pid = process.id().unwrap();
        tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                if tokio::net::TcpStream::connect((std::net::Ipv4Addr::LOCALHOST, port))
                    .await
                    .is_ok()
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(25)).await;
            }
        })
        .await
        .expect("test listener did not start");
        assert!(owned_realtime_pids(code.clone(), port).await.contains(&pid));
        assert!(!owned_realtime_pids(code, port - 1).await.contains(&pid));
        crate::process::signal_process(pid, false);
        tokio::time::timeout(Duration::from_secs(5), process.wait())
            .await
            .unwrap()
            .unwrap();
        let _released = std::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).unwrap();
    }
}
