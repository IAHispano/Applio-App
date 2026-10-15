//! Owned long-running services. Startup is idempotent, stop waits for the
//! process tree, and engine shutdown/task abortion cannot leave a child behind.
use crate::{
    engine::NativeEngine,
    process::{CommandSpec, ManagedProcess, ProcessEvent},
};
use anyhow::{bail, Result};
use std::{sync::Arc, time::Duration};
use tokio::sync::{watch, Mutex};
use tokio_util::sync::CancellationToken;

struct Session {
    cancelled: CancellationToken,
    done: watch::Receiver<Option<String>>,
    started_at: String,
    pid: u32,
}
#[derive(Clone, Debug, Default)]
pub struct Status {
    pub running: bool,
    pub started_at: Option<String>,
    pub pid: Option<u32>,
    pub error: Option<String>,
}
#[derive(Default)]
pub struct BackgroundService {
    state: Mutex<Option<Session>>,
}
struct Completion(Option<watch::Sender<Option<String>>>);
impl Completion {
    fn finish(&mut self, message: String) {
        if let Some(sender) = self.0.take() {
            sender.send_replace(Some(message));
        }
    }
}
impl Drop for Completion {
    fn drop(&mut self) {
        self.finish("Service task interrupted".into());
    }
}
impl BackgroundService {
    pub async fn status(&self) -> Status {
        let state = self.state.lock().await;
        match state.as_ref() {
            Some(session) => {
                let error = session.done.borrow().clone();
                Status {
                    running: error.is_none(),
                    started_at: Some(session.started_at.clone()),
                    pid: error.is_none().then_some(session.pid),
                    error,
                }
            }
            None => Status::default(),
        }
    }
    pub async fn start(&self, engine: &Arc<NativeEngine>, spec: &CommandSpec) -> Result<String> {
        let root = engine.cancellation_token();
        if root.is_cancelled() {
            bail!("Applio is shutting down");
        }
        let mut state = self.state.lock().await;
        if let Some(session) = state
            .as_ref()
            .filter(|session| session.done.borrow().is_none())
        {
            return Ok(session.started_at.clone());
        }
        let mut process = ManagedProcess::spawn(spec)?;
        let pid = process.id().unwrap_or_default();
        let (sender, done) = watch::channel(None);
        let mut completed = Completion(Some(sender));
        let cancelled = CancellationToken::new();
        let stop = cancelled.clone();
        let started_at = crate::jobs::timestamp();
        engine.spawn_background(async move{
            let mut last=String::new();let mut closed=false;
            let message=loop{
                let event=tokio::select!{
                    biased;
                    _=root.cancelled()=>{let _=process.stop().await;break "Stopped with Applio".into();},
                    _=stop.cancelled()=>{let _=process.stop().await;break "Stopped".into();},
                    event=async{if closed{process.wait().await.map(ProcessEvent::Exited)}else{process.next_event().await}}=>event,
                };
                match event{
                    Ok(ProcessEvent::Line(_,line))=>{if !line.trim().is_empty(){last=line.trim().chars().rev().take(2000).collect::<String>().chars().rev().collect();}},
                    Ok(ProcessEvent::Exited(code))=>{
                        let _=process.stop().await;
                        while let Ok(Some((_,line)))=process.next_line().await {if !line.trim().is_empty(){last=line.trim().chars().rev().take(2000).collect::<String>().chars().rev().collect();}}
                        break if last.is_empty(){format!("Service exited with code {code:?}")}else{format!("Service exited with code {code:?}: {last}")};
                    },
                    Ok(ProcessEvent::OutputClosed)=>closed=true,
                    Err(error)=>{let _=process.stop().await;break error.to_string();},
                }
            };
            // Drop/stop the process before announcing completion to restart.
            drop(process);completed.finish(message);
        }).await?;
        *state = Some(Session {
            cancelled,
            done,
            started_at: started_at.clone(),
            pid,
        });
        Ok(started_at)
    }
    pub async fn stop(&self) -> Result<()> {
        let mut state = self.state.lock().await;
        if let Some(session) = state.as_mut() {
            session.cancelled.cancel();
            tokio::time::timeout(Duration::from_secs(10), async {
                while session.done.borrow().is_none() {
                    if session.done.changed().await.is_err() {
                        break;
                    }
                }
            })
            .await
            .map_err(|_| anyhow::anyhow!("Service did not stop in time"))?;
        }
        *state = None;
        Ok(())
    }
}
impl Drop for BackgroundService {
    fn drop(&mut self) {
        if let Some(session) = self.state.get_mut().as_ref() {
            session.cancelled.cancel();
        }
    }
}
