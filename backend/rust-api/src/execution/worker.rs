//! Serial, reusable Python inference worker with the engine's existing JSON
//! protocol. Cancellation, task abortion and idle shutdown own the process tree.
use crate::process::{CommandSpec, ManagedProcess, ProcessEvent, Stream};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicU32, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::time::Instant;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

struct Session {
    process: ManagedProcess,
    ready: bool,
    last_used: Instant,
}
struct Inner {
    spec: CommandSpec,
    session: tokio::sync::Mutex<Option<Session>>,
    stopping: Mutex<CancellationToken>,
    pid: AtomicU32,
    startup_timeout: Duration,
}

#[derive(Clone)]
pub struct InferenceWorker(Arc<Inner>);

impl InferenceWorker {
    pub fn new(spec: CommandSpec) -> Self {
        Self::with_timeouts(spec, Duration::from_secs(90), Duration::from_secs(5 * 60))
    }

    pub fn with_timeouts(
        spec: CommandSpec,
        startup_timeout: Duration,
        idle_timeout: Duration,
    ) -> Self {
        let worker = Self(Arc::new(Inner {
            spec,
            session: tokio::sync::Mutex::new(None),
            stopping: Mutex::new(CancellationToken::new()),
            pid: AtomicU32::new(0),
            startup_timeout,
        }));
        let weak = Arc::downgrade(&worker.0);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(idle_timeout.max(Duration::from_millis(10))).await;
                let Some(inner) = weak.upgrade() else {
                    break;
                };
                let Ok(mut slot) = inner.session.try_lock() else {
                    continue;
                };
                if slot
                    .as_ref()
                    .is_some_and(|session| session.last_used.elapsed() >= idle_timeout)
                {
                    if let Some(mut session) = slot.take() {
                        let _ = session.process.stop().await;
                    }
                    inner.pid.store(0, Ordering::SeqCst);
                }
            }
        });
        worker
    }

    pub fn pid(&self) -> Option<u32> {
        match self.0.pid.load(Ordering::SeqCst) {
            0 => None,
            pid => Some(pid),
        }
    }

    pub async fn request(
        &self,
        mut payload: Value,
        cancelled: &CancellationToken,
        mut on_log: impl FnMut(&str),
    ) -> Result<Value> {
        let command = payload["command"]
            .as_str()
            .context("Worker command is required")?
            .to_owned();
        if ![
            "infer",
            "infer_batch",
            "tts",
            "analyze_audio",
            "f0_curve",
            "model_blender",
            "inspect_model",
            "preload_model",
            "warmup",
            "ping",
            "unload",
        ]
        .contains(&command.as_str())
        {
            bail!("Unknown inference worker command: {command}");
        }
        let id = payload["id"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        payload["id"] = json!(id);
        let stopping = self.0.stopping.lock().unwrap().clone();
        let mut slot = tokio::select! {
            biased;
            _ = cancelled.cancelled() => bail!("Stopped by user"),
            _ = stopping.cancelled() => bail!("Inference worker stopped"),
            slot = self.0.session.lock() => slot,
        };
        // Own the process outside the slot while this future is active. If the
        // future is aborted, its local process is dropped and killed, rather
        // than leaving a busy interpreter resident in the shared slot.
        let mut session = match slot.take() {
            Some(session) => session,
            None => Session {
                process: ManagedProcess::spawn(&self.0.spec)?,
                ready: false,
                last_used: Instant::now(),
            },
        };
        self.0
            .pid
            .store(session.process.id().unwrap_or(0), Ordering::SeqCst);
        let mut pid_guard = PidGuard {
            pid: &self.0.pid,
            keep: false,
        };
        let startup_deadline = Instant::now() + self.0.startup_timeout;
        let mut healthy = true;
        let result: Result<Value> = async {
            while !session.ready {
                let event = tokio::select! {
                    biased;
                    _ = cancelled.cancelled() => { healthy = false; bail!("Stopped by user"); },
                    _ = stopping.cancelled() => { healthy = false; bail!("Inference worker stopped"); },
                    _ = tokio::time::sleep_until(startup_deadline) => { healthy = false; bail!("Inference worker startup timed out after {} seconds", self.0.startup_timeout.as_secs()); },
                    event = session.process.next_event() => event,
                };
                match parse_event(event.map_err(|error| WorkerTransportError(error.to_string()))?, &mut on_log)? {
                    Some(message) if message["type"] == "ready" => session.ready = true,
                    Some(message) if message["type"] == "error" => { healthy = false; bail!("{}", worker_error(&message)); },
                    _ => {}
                }
            }
            session.process.send_json(&payload).await?;
            let expected = if command == "warmup" {
                // Warmup emits logs but has no completion event. A following
                // ping runs on the same serial Python queue and proves it ended.
                session.process.send_json(&json!({"command": "ping", "id": id})).await?;
                "pong"
            } else if command == "ping" { "pong" } else if command == "unload" { "unloaded" } else { "done" };
            loop {
                let event = tokio::select! {
                    biased;
                    _ = cancelled.cancelled() => { healthy = false; bail!("Stopped by user"); },
                    _ = stopping.cancelled() => { healthy = false; bail!("Inference worker stopped"); },
                    event = session.process.next_event() => event,
                };
                let Some(message) = parse_event(event.map_err(|error| WorkerTransportError(error.to_string()))?, &mut on_log)? else { continue; };
                if message["id"].as_str().is_some_and(|message_id| message_id != id) { continue; }
                match message["type"].as_str() {
                    Some("log") => { if let Some(log) = message["message"].as_str() { on_log(log); } },
                    Some("error") => bail!("{}", worker_error(&message)),
                    Some(kind) if kind == expected => return Ok(message),
                    _ => {}
                }
            }
        }.await;
        if result
            .as_ref()
            .is_err_and(|error| error.downcast_ref::<WorkerTransportError>().is_some())
        {
            healthy = false;
        }
        // A closed stdin or other I/O error also makes this session unusable.
        if result
            .as_ref()
            .is_err_and(|error| error.downcast_ref::<std::io::Error>().is_some())
        {
            healthy = false;
        }
        if healthy {
            session.last_used = Instant::now();
            *slot = Some(session);
            pid_guard.keep = true;
        } else {
            let _ = session.process.stop().await;
        }
        result
    }

    pub async fn stop(&self) -> Result<()> {
        let previous = {
            let mut token = self.0.stopping.lock().unwrap();
            std::mem::replace(&mut *token, CancellationToken::new())
        };
        previous.cancel();
        let mut slot = self.0.session.lock().await;
        if let Some(mut session) = slot.take() {
            session.process.stop().await?;
        }
        self.0.pid.store(0, Ordering::SeqCst);
        Ok(())
    }
}

struct PidGuard<'a> {
    pid: &'a AtomicU32,
    keep: bool,
}
impl Drop for PidGuard<'_> {
    fn drop(&mut self) {
        if !self.keep {
            self.pid.store(0, Ordering::SeqCst);
        }
    }
}

#[derive(Debug)]
struct WorkerTransportError(String);
impl std::fmt::Display for WorkerTransportError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for WorkerTransportError {}

fn parse_event(event: ProcessEvent, on_log: &mut impl FnMut(&str)) -> Result<Option<Value>> {
    match event {
        ProcessEvent::Exited(code) => {
            Err(WorkerTransportError(format!("Inference worker exited with code {code:?}")).into())
        }
        ProcessEvent::OutputClosed => {
            Err(WorkerTransportError("Inference worker closed its output".into()).into())
        }
        ProcessEvent::Line(stream, line) => {
            if stream == Stream::Stdout {
                if let Ok(message) = serde_json::from_str::<Value>(&line) {
                    if message["_applio_ipc"] == true {
                        return Ok(Some(message));
                    }
                }
            }
            if !line.trim().is_empty() {
                on_log(&line);
            }
            Ok(None)
        }
    }
}
fn worker_error(message: &Value) -> String {
    let error = message["error"].as_str().unwrap_or("Worker task failed");
    match message["traceback"]
        .as_str()
        .filter(|trace| !trace.is_empty())
    {
        Some(traceback) => format!("{error}\n{traceback}"),
        None => error.into(),
    }
}
