//! FIFO resource admission with cancellation-safe, RAII-owned permits.
//!
//! GPU work and realtime are mutually exclusive. Network downloads admit two
//! concurrent jobs; model installs and dataset reviews each admit one.
use anyhow::{bail, Result};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, VecDeque},
    sync::{Arc, Mutex},
};
use tokio::sync::oneshot;
use tokio_util::sync::CancellationToken;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Resource {
    Gpu,
    Network,
    ModelDownload,
    DatasetReview,
}
impl Resource {
    fn capacity(self) -> usize {
        if self == Self::Network {
            2
        } else {
            1
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct SchedulingStatus {
    pub realtime: bool,
    pub active: Vec<String>,
    pub queued: Vec<String>,
}

struct Waiting {
    id: String,
    resource: Resource,
    ready: oneshot::Sender<()>,
    background: Option<CancellationToken>,
}
#[derive(Default)]
struct State {
    active: HashMap<String, Resource>,
    waiting: VecDeque<Waiting>,
    realtime: bool,
    background: HashMap<String, CancellationToken>,
}
#[derive(Clone, Default)]
pub struct Scheduler(Arc<Mutex<State>>, Arc<tokio::sync::Notify>);

impl Scheduler {
    pub fn status(&self) -> SchedulingStatus {
        let state = self.0.lock().unwrap();
        let mut active: Vec<_> = state.active.keys().cloned().collect();
        active.sort();
        SchedulingStatus {
            realtime: state.realtime,
            active,
            queued: state.waiting.iter().map(|w| w.id.clone()).collect(),
        }
    }
    pub fn gpu_busy(&self) -> bool {
        self.0
            .lock()
            .unwrap()
            .active
            .values()
            .any(|r| *r == Resource::Gpu)
    }

    pub async fn acquire(
        &self,
        id: &str,
        resource: Resource,
        cancelled: &CancellationToken,
    ) -> Result<Option<Lease>> {
        self.acquire_inner(id, resource, cancelled, false).await
    }

    pub async fn acquire_background_gpu(
        &self,
        id: &str,
        token: &CancellationToken,
    ) -> Result<Option<Lease>> {
        self.acquire_inner(id, Resource::Gpu, token, true).await
    }

    async fn acquire_inner(
        &self,
        id: &str,
        resource: Resource,
        cancelled: &CancellationToken,
        background: bool,
    ) -> Result<Option<Lease>> {
        if cancelled.is_cancelled() {
            return Ok(None);
        }
        let (ready, receiver) = oneshot::channel();
        {
            let mut state = self.0.lock().unwrap();
            if state.active.contains_key(id) || state.waiting.iter().any(|w| w.id == id) {
                bail!("Job already owns or is waiting for a resource: {id}");
            }
            if resource == Resource::Gpu && !background {
                for token in state.background.values() {
                    token.cancel();
                }
            }
            let waiting = Waiting {
                id: id.to_owned(),
                resource,
                ready,
                background: background.then(|| cancelled.clone()),
            };
            if !background && resource == Resource::Gpu {
                let position = state
                    .waiting
                    .iter()
                    .position(|item| item.background.is_some())
                    .unwrap_or(state.waiting.len());
                state.waiting.insert(position, waiting);
            } else {
                state.waiting.push_back(waiting);
            }
            drain(&mut state);
        }
        // A future can be dropped while queued OR after admission but before it
        // is polled again. Both cases must return the slot to the scheduler.
        let mut pending = Pending {
            scheduler: self.clone(),
            id: id.to_owned(),
            armed: true,
        };
        tokio::select! {
            biased;
            _ = cancelled.cancelled() => Ok(None),
            result = receiver => {
                result.map_err(|_| anyhow::anyhow!("Scheduler stopped before admitting job"))?;
                if cancelled.is_cancelled() { return Ok(None); }
                pending.armed = false;
                Ok(Some(Lease { scheduler: self.clone(), id: id.to_owned() }))
            }
        }
    }

    /// Realtime gets priority over waiting work but never interrupts active GPU
    /// work. The returned guard keeps the GPU unavailable until the engine has
    /// actually stopped and the guard is dropped.
    pub fn begin_realtime(&self) -> Option<RealtimeLease> {
        let mut state = self.0.lock().unwrap();
        if state.realtime || state.active.values().any(|r| *r == Resource::Gpu) {
            return None;
        }
        state.realtime = true;
        Some(RealtimeLease {
            scheduler: self.clone(),
        })
    }

    /// Speculative preloading must never queue ahead of requested GPU work.
    pub fn try_gpu(&self, id: &str) -> Option<Lease> {
        self.try_gpu_inner(id, None)
    }

    fn try_gpu_inner(&self, id: &str, background: Option<CancellationToken>) -> Option<Lease> {
        let mut state = self.0.lock().unwrap();
        if state.realtime
            || state.active.contains_key(id)
            || state
                .active
                .values()
                .any(|resource| *resource == Resource::Gpu)
            || state
                .waiting
                .iter()
                .any(|waiting| waiting.resource == Resource::Gpu || waiting.id == id)
        {
            return None;
        }
        state.active.insert(id.to_owned(), Resource::Gpu);
        if let Some(token) = background {
            state.background.insert(id.to_owned(), token);
        }
        Some(Lease {
            scheduler: self.clone(),
            id: id.to_owned(),
        })
    }

    pub fn try_background_gpu(&self, id: &str, token: &CancellationToken) -> Option<Lease> {
        self.try_gpu_inner(id, Some(token.clone()))
    }

    pub async fn preempt_background_gpu(&self, stopped: &CancellationToken) -> Result<()> {
        loop {
            let changed = self.1.notified();
            tokio::pin!(changed);
            changed.as_mut().enable();
            {
                let state = self.0.lock().unwrap();
                for token in state.background.values() {
                    token.cancel();
                }
                if state.background.is_empty() {
                    return Ok(());
                }
            }
            tokio::select! {
                _ = stopped.cancelled() => bail!("Stopped by user"),
                _ = changed => {},
            }
        }
    }

    fn remove(&self, id: &str) {
        let mut state = self.0.lock().unwrap();
        state.waiting.retain(|w| w.id != id);
        state.active.remove(id);
        state.background.remove(id);
        drain(&mut state);
        self.1.notify_waiters();
    }
}

fn drain(state: &mut State) {
    let mut index = 0;
    while index < state.waiting.len() {
        let waiting = &state.waiting[index];
        if waiting.ready.is_closed() {
            state.waiting.remove(index);
            continue;
        }
        let used = state
            .active
            .values()
            .filter(|r| **r == waiting.resource)
            .count();
        if used >= waiting.resource.capacity()
            || (waiting.resource == Resource::Gpu && state.realtime)
        {
            index += 1;
            continue;
        }
        let waiting = state.waiting.remove(index).unwrap();
        state.active.insert(waiting.id.clone(), waiting.resource);
        if let Some(token) = waiting.background {
            state.background.insert(waiting.id.clone(), token);
        }
        if waiting.ready.send(()).is_err() {
            state.active.remove(&waiting.id);
            state.background.remove(&waiting.id);
        }
    }
}

struct Pending {
    scheduler: Scheduler,
    id: String,
    armed: bool,
}
impl Drop for Pending {
    fn drop(&mut self) {
        if self.armed {
            self.scheduler.remove(&self.id);
        }
    }
}
pub struct Lease {
    scheduler: Scheduler,
    id: String,
}
impl Drop for Lease {
    fn drop(&mut self) {
        self.scheduler.remove(&self.id);
    }
}
pub struct RealtimeLease {
    scheduler: Scheduler,
}
impl Drop for RealtimeLease {
    fn drop(&mut self) {
        let mut state = self.scheduler.0.lock().unwrap();
        state.realtime = false;
        drain(&mut state);
    }
}
