//! Native job state, cancellation, bounded history and event subscriptions.
//!
//! A terminal state cannot be overwritten by a late worker result. History is
//! published atomically and an older asynchronous write cannot replace a newer
//! revision. The serialized shape is the existing web application's contract.
use anyhow::{bail, Context, Result};
use chrono::{SecondsFormat, Utc};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tokio::sync::{broadcast, watch};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

// Request context follows the in-process API dispatch, never a caller payload.
tokio::task_local! { pub(crate) static API_REQUEST: bool; }

pub const MAX_JOBS: usize = 200;
pub(crate) const HISTORY_LOG_TAIL: usize = 20;
const MAX_LOGS: usize = 500;
const HISTORY_LOGS: usize = 100;
const EVENT_BUFFER: usize = 256;
const BATCH_PAGE_SIZE: usize = 20;

pub fn timestamp() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum JobType {
    Inference,
    BatchInference,
    Train,
    Tts,
    Download,
    Other,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum JobStatus {
    Queued,
    Running,
    Done,
    Error,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Job {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: JobType,
    pub status: JobStatus,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub started_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finished_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    pub logs: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_file: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_current: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stage_total: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub progress: Option<u8>,
}

impl Job {
    pub fn active(&self) -> bool {
        matches!(self.status, JobStatus::Queued | JobStatus::Running)
    }

    pub(crate) fn api_owned(&self) -> bool {
        self.params
            .as_ref()
            .is_some_and(|params| params["source"] == "api")
    }

    pub fn label(&self) -> &'static str {
        let p = self.params.as_ref().unwrap_or(&Value::Null);
        match p["step"].as_str() {
            Some("preprocess") => return "Dataset preprocessing",
            Some("extract") => return "Feature extraction",
            Some("index") => return "Index generation",
            Some("dataset-review") => return "Dataset quality review",
            Some("dataset-prepare") => return "Prepare reviewed dataset",
            _ => {}
        }
        match self.kind {
            JobType::Inference => "Voice conversion",
            JobType::BatchInference => "Batch conversion",
            JobType::Train => "Training",
            JobType::Tts => "Speech synthesis",
            JobType::Download => "Download",
            JobType::Other => {
                if p["setup"] == "prerequisites" {
                    "Model prerequisites"
                } else if truthy(&p["setup"]) {
                    "Engine setup"
                } else if truthy(&p["pthPath1"]) {
                    "Model blending"
                } else if truthy(&p["pthPath"]) {
                    "Model inspection"
                } else if truthy(&p["inputPath"]) && truthy(&p["method"]) {
                    "Pitch extraction"
                } else if truthy(&p["inputPath"])
                    && truthy(&p["model"])
                    && truthy(&p["outputFormat"])
                {
                    "Audio separation"
                } else if truthy(&p["url"]) {
                    "Audio download"
                } else if truthy(&p["plugin"]) {
                    "Plugin installation"
                } else if truthy(&p["inputPath"]) {
                    "Audio analysis"
                } else {
                    "Task"
                }
            }
        }
    }

    /// App-wide activity intentionally excludes filesystem paths, logs and results.
    pub fn summary(&self) -> Value {
        let mut value = json!({
            "id": self.id, "type": self.kind, "label": self.label(),
            "status": self.status, "createdAt": self.created_at,
            "stopped": self.status == JobStatus::Error && self.error.as_ref().is_some_and(|error| {
                let error = error.to_lowercase();
                ["stopped by user", "cancelled", "canceled"].iter().any(|needle| error.contains(needle))
            })
        });
        for (key, field) in [
            ("progress", self.progress.map(|v| json!(v))),
            ("stage", self.stage.as_ref().map(|v| json!(v))),
            ("stageCurrent", self.stage_current.map(|v| json!(v))),
            ("stageTotal", self.stage_total.map(|v| json!(v))),
        ] {
            if let Some(field) = field {
                value[key] = field;
            }
        }
        value
    }

    fn public_fields(&self) -> Value {
        let mut value = json!({
            "id": self.id, "type": self.kind, "status": self.status,
            "createdAt": self.created_at, "updatedAt": self.updated_at,
            "label": self.label(),
        });
        macro_rules! optional {
            ($($key:literal => $field:ident),* $(,)?) => {
                $(if let Some(field) = &self.$field { value[$key] = json!(field); })*
            };
        }
        optional! {
            "startedAt" => started_at, "finishedAt" => finished_at,
            "error" => error, "outputFile" => output_file,
            "stage" => stage, "stageCurrent" => stage_current,
            "stageTotal" => stage_total, "progress" => progress,
        }
        value
    }

    fn log_tail(&self, limit: usize) -> &[String] {
        &self.logs[self.logs.len().saturating_sub(limit)..]
    }

    fn history_card(&self) -> Value {
        let mut value = self.public_fields();
        value["logs"] = json!(self.log_tail(if self.active() { HISTORY_LOG_TAIL } else { 0 }));
        if let Some(params) = &self.params {
            let context = [
                "modelName",
                "pthPath",
                "model",
                "inputPath",
                "inputFolder",
                "modelLink",
                "url",
                "ttsVoice",
            ]
            .into_iter()
            .filter_map(|key| params[key].as_str().map(|field| (key, field)))
            .filter(|(_, field)| !field.is_empty())
            .take(3)
            .map(|(key, field)| (key.to_owned(), json!(field)))
            .collect::<serde_json::Map<_, _>>();
            if !context.is_empty() {
                value["params"] = Value::Object(context);
            }
        }
        if let Some(message) = self
            .result
            .as_ref()
            .and_then(|result| result["message"].as_str())
        {
            value["result"] = json!({"message": message});
        }
        value
    }

    pub fn public_value(&self, log_tail: Option<usize>) -> Value {
        let mut value = self.public_fields();
        value["logs"] = json!(self.log_tail(log_tail.unwrap_or(self.logs.len())));
        if let Some(details) = &self.error_details {
            value["errorDetails"] = json!(details);
        }
        if let Some(params) = &self.params {
            value["params"] = params.clone();
        }
        if let Some(result) = &self.result {
            value["result"] = result.clone();
        }
        value
    }

    fn batch_view(&self, page: usize) -> Value {
        let mut value = self.public_fields();
        value["logs"] = json!(self.log_tail(if self.status == JobStatus::Error {
            50
        } else {
            0
        }));
        if let Some(details) = &self.error_details {
            value["errorDetails"] = json!(details);
        }
        if let Some(params) = self.params.as_ref().and_then(Value::as_object) {
            value["params"] = Value::Object(
                params
                    .iter()
                    .filter(|(key, _)| {
                        !matches!(key.as_str(), "selectedFiles" | "excludedFiles" | "models")
                    })
                    .map(|(key, field)| (key.clone(), field.clone()))
                    .collect(),
            );
        }
        if let Some(result) = self.result.as_ref().filter(|result| result.is_object()) {
            let items = result["items"].as_array().map_or(&[][..], Vec::as_slice);
            let start = page.saturating_mul(BATCH_PAGE_SIZE).min(items.len());
            let end = start.saturating_add(BATCH_PAGE_SIZE).min(items.len());
            value["result"] = json!({
                "files": result["files"], "failed": result["failed"], "total": result["total"],
                "outputFolder": result["outputFolder"], "itemCount": items.len(),
                "pageSize": BATCH_PAGE_SIZE, "items": &items[start..end],
            });
        }
        value
    }
}

fn truthy(value: &Value) -> bool {
    match value {
        Value::Null | Value::Bool(false) => false,
        Value::String(s) => !s.is_empty(),
        Value::Number(n) => n.as_f64() != Some(0.0),
        _ => true,
    }
}

pub(crate) struct JobSubscription {
    pub snapshot: Arc<Job>,
    pub updates: Option<broadcast::Receiver<Arc<Job>>>,
}

pub(crate) struct BatchSubscription {
    pub snapshot: Arc<Value>,
    // A slow viewer can recover from the latest first page without a queue of
    // stale result snapshots. Other pages are read directly from the store.
    pub updates: Option<watch::Receiver<Arc<Value>>>,
}

struct Entry {
    ordinal: u64,
    job: Job,
    cancellation: CancellationToken,
    last_log_event: Option<Instant>,
    updates: Option<broadcast::Sender<Arc<Job>>>,
    batch_updates: Option<watch::Sender<Arc<Value>>>,
}

impl Entry {
    fn publish(&mut self) {
        let active = self.job.active();
        if let Some(updates) = self
            .updates
            .as_ref()
            .filter(|sender| sender.receiver_count() > 0)
        {
            let _ = updates.send(Arc::new(self.job.clone()));
        } else {
            self.updates = None;
        }
        if let Some(updates) = self.batch_updates.as_ref() {
            if updates.receiver_count() > 0 {
                updates.send_replace(Arc::new(self.job.batch_view(0)));
            }
            if updates.receiver_count() == 0 || !active {
                self.batch_updates = None;
            }
        }
        if !active {
            self.updates = None;
        }
    }
}

struct StoreState {
    jobs: HashMap<String, Entry>,
    revision: u64,
    activity_revision: u64,
    next_ordinal: u64,
    closed: bool,
}
struct Inner {
    state: Mutex<StoreState>,
    path: PathBuf,
    activity_instance: Uuid,
    activity: broadcast::Sender<Arc<Value>>,
    dirty: watch::Sender<u64>,
    active_revision: AtomicU64,
    persisted_revision: Arc<tokio::sync::Mutex<Option<u64>>>,
    sealed: CancellationToken,
}

#[derive(Clone)]
pub struct JobStore(Arc<Inner>);

impl JobStore {
    /// Call from an async runtime. Separate instances must never share a history
    /// file; the final Rust cutover uses the existing `jobs.json` path.
    pub fn open(path: PathBuf) -> Result<Self> {
        let jobs: HashMap<String, Entry> = load_history(&path)?
            .into_iter()
            .enumerate()
            .map(|(ordinal, job)| {
                let cancellation = CancellationToken::new();
                if !job.active() {
                    cancellation.cancel();
                }
                (
                    job.id.clone(),
                    Entry {
                        ordinal: ordinal as u64,
                        job,
                        cancellation,
                        last_log_event: None,
                        updates: None,
                        batch_updates: None,
                    },
                )
            })
            .collect();
        let (activity, _) = broadcast::channel(EVENT_BUFFER);
        let (dirty, mut changes) = watch::channel(0);
        let next_ordinal = jobs.len() as u64;
        let store = Self(Arc::new(Inner {
            state: Mutex::new(StoreState {
                jobs,
                revision: 0,
                activity_revision: 0,
                next_ordinal,
                closed: false,
            }),
            path,
            activity_instance: Uuid::new_v4(),
            activity,
            dirty,
            active_revision: AtomicU64::new(0),
            persisted_revision: Arc::new(tokio::sync::Mutex::new(None)),
            sealed: CancellationToken::new(),
        }));
        let weak = Arc::downgrade(&store.0);
        let sealed = store.0.sealed.clone();
        tokio::spawn(async move {
            loop {
                tokio::select! {biased;_=sealed.cancelled()=>break,result=changes.changed()=>if result.is_err(){break;}}
                tokio::select! {biased;_=sealed.cancelled()=>break,_=tokio::time::sleep(Duration::from_millis(500))=>{}}
                changes.borrow_and_update();
                let Some(inner) = weak.upgrade() else {
                    break;
                };
                if let Err(error) = JobStore(inner).flush().await {
                    eprintln!("Could not save job history: {error:#}");
                }
            }
        });
        Ok(store)
    }

    pub fn create(&self, kind: JobType, mut params: Value) -> Result<Job> {
        if API_REQUEST.try_with(|api| *api).unwrap_or(false) {
            params["source"] = serde_json::json!("api");
        }
        let mut state = self.0.state.lock().unwrap();
        if state.closed {
            bail!("Applio is shutting down");
        }
        if state.jobs.len() >= MAX_JOBS {
            let oldest = state
                .jobs
                .values()
                .filter(|entry| !entry.job.active())
                .min_by(|a, b| {
                    a.job
                        .created_at
                        .cmp(&b.job.created_at)
                        .then_with(|| a.ordinal.cmp(&b.ordinal))
                })
                .map(|entry| entry.job.id.clone());
            match oldest {
                Some(id) => {
                    state.jobs.remove(&id);
                }
                None => {
                    bail!("Too many active jobs. Finish or cancel a job before starting another.")
                }
            }
        }
        let now = timestamp();
        let job = Job {
            id: Uuid::new_v4().to_string(),
            kind,
            status: JobStatus::Queued,
            created_at: now.clone(),
            updated_at: now,
            started_at: None,
            finished_at: None,
            params: Some(params),
            logs: Vec::new(),
            result: None,
            error: None,
            error_details: None,
            output_file: None,
            stage: None,
            stage_current: None,
            stage_total: None,
            progress: None,
        };
        let ordinal = state.next_ordinal;
        state.next_ordinal += 1;
        state.jobs.insert(
            job.id.clone(),
            Entry {
                ordinal,
                job: job.clone(),
                cancellation: CancellationToken::new(),
                last_log_event: None,
                updates: None,
                batch_updates: None,
            },
        );
        self.0.active_revision.fetch_add(1, Ordering::Release);
        state.activity_revision += 1;
        self.changed(&mut state);
        self.publish_activity(&job);
        Ok(job)
    }

    fn changed(&self, state: &mut StoreState) {
        state.revision += 1;
        self.0.dirty.send_replace(state.revision);
    }
    fn publish_activity(&self, job: &Job) {
        if self.0.activity.receiver_count() > 0 {
            let _ = self.0.activity.send(Arc::new(job.summary()));
        }
    }

    pub fn get(&self, id: &str) -> Option<Job> {
        self.0
            .state
            .lock()
            .unwrap()
            .jobs
            .get(id)
            .map(|entry| entry.job.clone())
    }
    pub(crate) fn active_revision(&self) -> u64 {
        self.0.active_revision.load(Ordering::Acquire)
    }
    pub(crate) fn has_active_jobs(&self) -> bool {
        self.0
            .state
            .lock()
            .unwrap()
            .jobs
            .values()
            .any(|entry| entry.job.active())
    }
    pub fn active_params(&self) -> Vec<(String, Value)> {
        self.0
            .state
            .lock()
            .unwrap()
            .jobs
            .values()
            .filter(|entry| entry.job.active())
            .map(|entry| {
                (
                    entry.job.created_at.clone(),
                    entry.job.params.clone().unwrap_or(Value::Null),
                )
            })
            .collect()
    }
    pub fn list(&self) -> Vec<Job> {
        ordered_jobs(&self.0.state.lock().unwrap(), true)
    }
    pub fn public_list(&self, log_tail: usize) -> Vec<Value> {
        ordered_entries(&self.0.state.lock().unwrap(), true)
            .into_iter()
            .map(|entry| entry.job.public_value(Some(log_tail)))
            .collect()
    }
    pub(crate) fn history_cards(&self) -> Vec<Value> {
        ordered_entries(&self.0.state.lock().unwrap(), true)
            .into_iter()
            .map(|entry| entry.job.history_card())
            .collect()
    }
    pub(crate) fn integration_activity(&self) -> Value {
        let state = self.0.state.lock().unwrap();
        let mut active = 0;
        let mut completed = 0;
        let mut failed = 0;
        let mut jobs = Vec::new();
        for entry in ordered_entries(&state, true)
            .into_iter()
            .filter(|entry| entry.job.api_owned())
        {
            let job = &entry.job;
            match job.status {
                JobStatus::Queued | JobStatus::Running => active += 1,
                JobStatus::Done => completed += 1,
                JobStatus::Error => failed += 1,
            }
            if jobs.len() < 10 {
                jobs.push(job.public_value(Some(10)));
            }
        }
        json!({"total":active + completed + failed, "active":active, "completed":completed, "failed":failed, "jobs":jobs})
    }
    pub fn activity(&self) -> Vec<Value> {
        activity_summaries(&self.0.state.lock().unwrap())
    }
    pub(crate) fn activity_if_changed(
        &self,
        matches_tag: impl FnOnce(&str) -> bool,
    ) -> (String, Option<Vec<Value>>) {
        // Compare and capture under the same lock so the tag describes the response.
        let state = self.0.state.lock().unwrap();
        let tag = format!(
            "\"{}-{}\"",
            self.0.activity_instance, state.activity_revision
        );
        let summaries = (!matches_tag(&tag)).then(|| activity_summaries(&state));
        (tag, summaries)
    }
    pub(crate) fn dashboard(&self) -> Value {
        let state = self.0.state.lock().unwrap();
        let entries = ordered_entries(&state, true);
        let active_jobs = entries.iter().filter(|entry| entry.job.active()).count();
        let recent_jobs: Vec<_> = entries
            .iter()
            .take(4)
            .map(|entry| entry.job.summary())
            .collect();
        let latest_output = entries.iter().find_map(|entry| {
            let job = &entry.job;
            let output = job.output_file.as_deref()?;
            // Match the playable formats used by the web output player.
            let (_, extension) = output.rsplit_once('.')?;
            if job.status != JobStatus::Done
                || !matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "wav" | "mp3" | "flac" | "ogg" | "m4a" | "opus"
                )
            {
                return None;
            }
            let params = job.params.as_ref().unwrap_or(&Value::Null);
            Some(json!({
                "jobId": job.id, "outputFile": output, "label": job.label(),
                "createdAt": job.created_at, "model": params["pthPath"].as_str(),
                "index": params["indexPath"].as_str(),
            }))
        });
        json!({"activeJobs": active_jobs, "recentJobs": recent_jobs, "latestOutput": latest_output})
    }
    /// Register while holding the mutation lock, then capture the snapshot.
    /// Events received afterwards can never predate this initial snapshot.
    pub(crate) fn subscribe_job(&self, id: &str) -> Option<JobSubscription> {
        let mut state = self.0.state.lock().unwrap();
        let entry = state.jobs.get_mut(id)?;
        let updates = entry.job.active().then(|| {
            entry
                .updates
                .get_or_insert_with(|| broadcast::channel(EVENT_BUFFER).0)
                .subscribe()
        });
        Some(JobSubscription {
            snapshot: Arc::new(entry.job.clone()),
            updates,
        })
    }

    pub(crate) fn public_job(
        &self,
        id: &str,
        batch_page: Option<usize>,
        log_tail: Option<usize>,
    ) -> Option<Value> {
        let state = self.0.state.lock().unwrap();
        let job = &state.jobs.get(id)?.job;
        match batch_page {
            Some(page) => (job.kind == JobType::BatchInference).then(|| job.batch_view(page)),
            None => Some(job.public_value(log_tail)),
        }
    }

    pub(crate) fn subscribe_batch(&self, id: &str) -> Option<BatchSubscription> {
        let mut state = self.0.state.lock().unwrap();
        let entry = state.jobs.get_mut(id)?;
        if entry.job.kind != JobType::BatchInference {
            return None;
        }
        let snapshot = Arc::new(entry.job.batch_view(0));
        let updates = entry.job.active().then(|| {
            entry
                .batch_updates
                .get_or_insert_with(|| watch::channel(snapshot.clone()).0)
                .subscribe()
        });
        Some(BatchSubscription { snapshot, updates })
    }

    pub(crate) fn batch_output(&self, id: &str, index: usize) -> Option<(PathBuf, PathBuf)> {
        let state = self.0.state.lock().unwrap();
        let job = &state.jobs.get(id)?.job;
        if job.kind != JobType::BatchInference {
            return None;
        }
        let result = job.result.as_ref()?;
        let item = result["items"].get(index)?;
        (item["status"] == "done").then_some(())?;
        Some((
            result["outputFolder"].as_str()?.into(),
            item["output"].as_str()?.into(),
        ))
    }

    pub(crate) fn subscribe_activity(&self) -> (Vec<Value>, broadcast::Receiver<Arc<Value>>) {
        let state = self.0.state.lock().unwrap();
        let receiver = self.0.activity.subscribe();
        (activity_summaries(&state), receiver)
    }
    pub fn cancellation(&self, id: &str) -> Option<CancellationToken> {
        self.0
            .state
            .lock()
            .unwrap()
            .jobs
            .get(id)
            .map(|entry| entry.cancellation.clone())
    }

    fn update(&self, id: &str, update: impl FnOnce(&mut Job) -> bool) -> bool {
        let mut state = self.0.state.lock().unwrap();
        let Some(entry) = state.jobs.get_mut(id) else {
            return false;
        };
        if !entry.job.active() || !update(&mut entry.job) {
            return false;
        }
        entry.job.updated_at = timestamp();
        if !entry.job.active() {
            self.0.active_revision.fetch_add(1, Ordering::Release);
            entry.cancellation.cancel();
        }
        entry.publish();
        self.publish_activity(&entry.job);
        state.activity_revision += 1;
        self.changed(&mut state);
        true
    }

    pub fn running(&self, id: &str) {
        self.update(id, |job| {
            job.status = JobStatus::Running;
            job.started_at.get_or_insert_with(timestamp);
            job.stage.get_or_insert_with(|| "Preparing…".into());
            true
        });
    }
    pub fn stage(&self, id: &str, stage: &str, current: Option<u64>, total: Option<u64>) {
        self.update(id, |job| {
            if job.stage.as_deref() == Some(stage)
                && job.stage_current == current
                && job.stage_total == total
            {
                return false;
            }
            if job.stage.as_deref() != Some(stage) {
                job.progress = None;
            }
            job.stage = Some(stage.into());
            job.stage_current = current;
            job.stage_total = total;
            true
        });
    }
    pub fn progress(&self, id: &str, progress: f64) {
        self.set_progress(id, progress, false);
    }
    pub(crate) fn advance_progress(&self, id: &str, progress: f64) {
        self.set_progress(id, progress, true);
    }
    fn set_progress(&self, id: &str, progress: f64, only_increase: bool) {
        if !progress.is_finite() {
            return;
        }
        let progress = progress.round().clamp(0.0, 100.0) as u8;
        self.update(id, |job| {
            if job.progress == Some(progress)
                || only_increase && job.progress.is_some_and(|current| current > progress)
            {
                false
            } else {
                job.progress = Some(progress);
                true
            }
        });
    }
    pub fn result(&self, id: &str, result: Value) {
        self.update(id, |job| {
            job.result = Some(result);
            true
        });
    }
    pub(crate) fn update_result(&self, id: &str, update: impl FnOnce(&mut Value)) {
        self.update(id, |job| {
            let Some(result) = job.result.as_mut() else {
                return false;
            };
            update(result);
            true
        });
    }
    pub(crate) fn result_snapshot(&self, id: &str) -> Option<Value> {
        self.0
            .state
            .lock()
            .unwrap()
            .jobs
            .get(id)?
            .job
            .result
            .clone()
    }
    pub fn done(&self, id: &str, result: Value, output_file: Option<String>) {
        self.update(id, |job| {
            job.status = JobStatus::Done;
            job.result = Some(result);
            job.output_file = output_file;
            job.finished_at = Some(timestamp());
            true
        });
    }
    pub fn error(&self, id: &str, message: impl Into<String>, details: Option<String>) {
        self.fail(id, message.into(), details);
    }
    fn fail(&self, id: &str, message: String, details: Option<String>) -> bool {
        self.update(id, |job| {
            job.status = JobStatus::Error;
            job.error = Some(message);
            job.error_details = details.or_else(|| {
                (!job.logs.is_empty())
                    .then(|| job.logs[job.logs.len().saturating_sub(30)..].join("\n"))
            });
            job.finished_at = Some(timestamp());
            true
        })
    }
    pub fn cancel(&self, id: &str, reason: &str) -> bool {
        self.fail(id, reason.to_owned(), None)
    }
    pub fn cancel_all(&self, reason: &str) {
        for id in self.active_ids(|_| true) {
            self.cancel(&id, reason);
        }
    }

    pub(crate) fn active_ids(&self, matches: impl Fn(&Job) -> bool) -> Vec<String> {
        ordered_entries(&self.0.state.lock().unwrap(), true)
            .into_iter()
            .filter(|entry| entry.job.active() && matches(&entry.job))
            .map(|entry| entry.job.id.clone())
            .collect()
    }

    pub fn log(&self, id: &str, line: &str) {
        let clean = normalize_log_line(line);
        let mut state = self.0.state.lock().unwrap();
        let Some(entry) = state.jobs.get_mut(id) else {
            return;
        };
        if !entry.job.active() {
            return;
        }
        let replace = progress_description(&clean).is_some_and(|description| {
            entry
                .job
                .logs
                .last()
                .and_then(|line| progress_description(line))
                .as_ref()
                == Some(&description)
        });
        if replace {
            *entry.job.logs.last_mut().unwrap() = clean;
        } else {
            entry.job.logs.push(clean);
        }
        if entry.job.logs.len() > MAX_LOGS {
            entry.job.logs.drain(..entry.job.logs.len() - MAX_LOGS);
        }
        entry.job.updated_at = timestamp();
        if entry
            .last_log_event
            .is_none_or(|at| at.elapsed() >= Duration::from_millis(250))
        {
            entry.last_log_event = Some(Instant::now());
            entry.publish();
        }
        self.changed(&mut state);
    }

    pub fn conversion_output(&self, id: &str, output: &str) {
        const CONVERTING: &str = "Converting audio…";
        static SPLIT: OnceLock<Regex> = OnceLock::new();
        static CHUNK: OnceLock<Regex> = OnceLock::new();
        let split = SPLIT.get_or_init(|| Regex::new(r"Audio split into (\d+) chunks").unwrap());
        let chunk = CHUNK.get_or_init(|| Regex::new(r"Converted audio chunk (\d+)").unwrap());
        for line in output.split(['\r', '\n']) {
            let lower = line.to_lowercase();
            if line.contains("[applio-stage:synthesizing]") {
                self.stage(id, "Generating speech…", None, None);
            } else if lower.contains("tts audio generated") {
                self.stage(id, "Loading voice model…", None, None);
            } else if lower.contains("converting audio '") {
                self.stage(id, CONVERTING, None, None);
            }
            if let Some(total) = split
                .captures(line)
                .and_then(|c| c[1].parse::<u64>().ok())
                .filter(|n| *n > 0)
            {
                self.stage(id, CONVERTING, Some(0), Some(total));
                self.progress(id, 0.0);
            }
            if let Some(current) = chunk.captures(line).and_then(|c| c[1].parse::<u64>().ok()) {
                self.update(id, |job| {
                    let Some(total) = job
                        .stage_total
                        .filter(|total| *total > 0 && job.stage.as_deref() == Some(CONVERTING))
                    else {
                        return false;
                    };
                    let current = current.min(total);
                    let progress = (current as f64 * 100.0 / total as f64).round() as u8;
                    if job.stage_current == Some(current) && job.progress == Some(progress) {
                        return false;
                    }
                    job.stage_current = Some(current);
                    job.progress = Some(progress);
                    true
                });
            }
            if lower.contains("saving audio as") {
                self.stage(id, "Saving audio…", None, None);
            }
        }
    }

    pub async fn flush(&self) -> Result<()> {
        let persisted = self.0.persisted_revision.clone().lock_owned().await;
        if self.0.sealed.is_cancelled() {
            return Ok(());
        }
        let inner = self.0.clone();
        tokio::task::spawn_blocking(move || {
            // The writer keeps the lock if its caller is cancelled. Sealing
            // waits for the atomic replacement before another store can open.
            let mut persisted = persisted;
            let (revision, jobs) = {
                let state = inner.state.lock().unwrap();
                if *persisted == Some(state.revision) {
                    return Ok(());
                }
                let jobs: Vec<_> = ordered_entries(&state, false)
                    .into_iter()
                    .map(|entry| {
                        let mut job = entry.job.clone();
                        job.logs
                            .drain(..job.logs.len().saturating_sub(HISTORY_LOGS));
                        job
                    })
                    .collect();
                (state.revision, jobs)
            };
            let parent = inner
                .path
                .parent()
                .context("History has no parent directory")?;
            std::fs::create_dir_all(parent)?;
            let temporary = parent.join(format!(".jobs-{}.tmp", Uuid::new_v4()));
            let operation = (|| -> Result<()> {
                let mut options = std::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let file = options.open(&temporary)?;
                let mut writer = std::io::BufWriter::new(file);
                serde_json::to_writer(&mut writer, &jobs)?;
                use std::io::Write;
                writer.flush()?;
                writer.get_ref().sync_all()?;
                drop(writer);
                // The watch channel schedules the next snapshot if jobs changed
                // during I/O. Waiting for them to stop changing can starve writes.
                crate::storage::replace_file(&temporary, &inner.path)?;
                *persisted = Some(revision);
                Ok(())
            })();
            let _ = std::fs::remove_file(&temporary);
            operation
        })
        .await?
    }
}

impl JobStore {
    pub fn close_admission(&self) {
        self.0.state.lock().unwrap().closed = true;
    }
    /// Old HTTP connections may retain a stopped store, but must never publish
    /// over the history of the next API generation.
    pub async fn seal(&self) {
        self.close_admission();
        let _gate = self.0.persisted_revision.lock().await;
        self.0.sealed.cancel();
    }
}
fn activity_summaries(state: &StoreState) -> Vec<Value> {
    ordered_entries(state, true)
        .into_iter()
        .map(|entry| entry.job.summary())
        .collect()
}

fn ordered_jobs(state: &StoreState, descending: bool) -> Vec<Job> {
    ordered_entries(state, descending)
        .into_iter()
        .map(|entry| entry.job.clone())
        .collect()
}
fn ordered_entries(state: &StoreState, descending: bool) -> Vec<&Entry> {
    let mut entries: Vec<_> = state.jobs.values().collect();
    entries.sort_by(|a, b| {
        let dates = if descending {
            b.job.created_at.cmp(&a.job.created_at)
        } else {
            a.job.created_at.cmp(&b.job.created_at)
        };
        dates.then_with(|| a.ordinal.cmp(&b.ordinal))
    });
    entries
}

fn normalize_log_line(line: &str) -> String {
    static ANSI: OnceLock<Regex> = OnceLock::new();
    static BAR: OnceLock<Regex> = OnceLock::new();
    let ansi = ANSI.get_or_init(|| Regex::new(r"\x1b\[[0-9;?]*[a-zA-Z]").unwrap());
    let bar = BAR.get_or_init(|| Regex::new(r"(\d{1,3}(?:\.\d+)?%\s*\|)[^|\r\n]*\|").unwrap());
    let clean = ansi.replace_all(line, "");
    // Terminal-sized fill is meaningless in the UI and can exceed the log limit,
    // cutting off the counts, ETA and speed that the desktop actually renders.
    bar.replace_all(&clean, "${1}|")
        .chars()
        .take(2000)
        .collect()
}

fn progress_description(line: &str) -> Option<String> {
    static TRAINING_COUNTERS: OnceLock<Regex> = OnceLock::new();
    static PROGRESS: OnceLock<Regex> = OnceLock::new();
    let found = PROGRESS
        .get_or_init(|| Regex::new(r"\d{1,3}(?:\.\d+)?%\s*\|").unwrap())
        .find(line)?;
    let description = line[..found.start()].trim();
    let description = description
        .strip_prefix("[stdout]")
        .or_else(|| description.strip_prefix("[stderr]"))
        .unwrap_or(description);
    let counters = TRAINING_COUNTERS.get_or_init(|| {
        Regex::new(r"(?i)\s*\|\s*step=\d+(?:\s*\|\s*batch=\d+/\d+)?\s*\|?\s*$").unwrap()
    });
    // Changing counters are redraws of the same epoch, not new log entries.
    Some(counters.replace(description, "").trim().to_lowercase())
}

fn load_history(path: &Path) -> Result<Vec<Job>> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let load = (|| -> Result<Vec<Job>> {
        let mut jobs: Vec<Job> = serde_json::from_slice(&std::fs::read(path)?)?;
        if jobs.len() > MAX_JOBS {
            jobs.drain(..jobs.len() - MAX_JOBS);
        }
        for job in &mut jobs {
            Uuid::parse_str(&job.id).context("Invalid job ID in history")?;
            chrono::DateTime::parse_from_rfc3339(&job.created_at)
                .context("Invalid job timestamp in history")?;
            job.logs = job.logs[job.logs.len().saturating_sub(MAX_LOGS)..]
                .iter()
                .map(|line| line.chars().take(2000).collect())
                .collect();
            if job.active() {
                job.status = JobStatus::Error;
                job.error =
                    Some("Interrupted by app restart. Start the job again to continue.".into());
                let now = timestamp();
                job.updated_at = now.clone();
                job.finished_at = Some(now);
            }
        }
        Ok(jobs)
    })();
    match load {
        Ok(jobs) => Ok(jobs),
        Err(error) => {
            let backup = path.with_file_name(format!(
                "{}.{}.corrupt",
                path.file_name().unwrap_or_default().to_string_lossy(),
                Uuid::new_v4()
            ));
            // If preservation fails, surface the error and refuse to overwrite.
            std::fs::rename(path, &backup)
                .with_context(|| format!("Could not preserve damaged history: {error:#}"))?;
            eprintln!(
                "Preserved damaged history at {}: {error:#}",
                backup.display()
            );
            Ok(Vec::new())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::broadcast::error::TryRecvError;

    #[tokio::test]
    async fn training_progress_is_monotonic_and_conversion_chunks_publish_once() {
        let root = tempfile::tempdir().unwrap();
        let store = JobStore::open(root.path().join("jobs.json")).unwrap();
        let job = store.create(JobType::Train, json!({})).unwrap();
        store.advance_progress(&job.id, 52.6);
        store.advance_progress(&job.id, 51.1);
        assert_eq!(store.get(&job.id).unwrap().progress, Some(53));
        store.stage(&job.id, "Index", None, None);
        store.advance_progress(&job.id, 12.0);
        assert_eq!(store.get(&job.id).unwrap().progress, Some(12));

        let job = store.create(JobType::Inference, json!({})).unwrap();
        store.conversion_output(&job.id, "Audio split into 3 chunks");
        let mut updates = store.subscribe_job(&job.id).unwrap().updates.unwrap();
        store.conversion_output(&job.id, "Converted audio chunk 2");
        let progress = updates.try_recv().unwrap();
        assert_eq!(progress.stage_current, Some(2));
        assert_eq!(progress.stage_total, Some(3));
        assert_eq!(progress.progress, Some(67));
        store.conversion_output(&job.id, "Converted audio chunk 2");
        assert!(matches!(updates.try_recv(), Err(TryRecvError::Empty)));
        store.seal().await;
    }

    #[tokio::test]
    async fn integration_activity_counts_only_api_jobs_and_limits_details() {
        let root = tempfile::tempdir().unwrap();
        let store = JobStore::open(root.path().join("jobs.json")).unwrap();
        store
            .create(JobType::BatchInference, json!({"modelName": "desktop"}))
            .unwrap();
        API_REQUEST
            .scope(true, async {
                for number in 0..15 {
                    let job = store
                        .create(JobType::BatchInference, json!({"batch": number}))
                        .unwrap();
                    match number {
                        0 => store.error(&job.id, "Failed", None),
                        1 => store.running(&job.id),
                        2 => {}
                        _ => store.done(&job.id, json!({"items": [number]}), None),
                    }
                }
            })
            .await;
        let status = store.integration_activity();
        assert_eq!(status["total"], 15);
        assert_eq!(status["active"], 2);
        assert_eq!(status["completed"], 12);
        assert_eq!(status["failed"], 1);
        let jobs = status["jobs"].as_array().unwrap();
        assert_eq!(jobs.len(), 10);
        assert!(jobs.iter().all(|job| job["params"]["source"] == "api"));
        store.seal().await;
    }

    #[tokio::test]
    async fn active_revision_tracks_admission_and_exit_without_rebuilding_on_progress() {
        let root = tempfile::tempdir().unwrap();
        let store = JobStore::open(root.path().join("jobs.json")).unwrap();
        assert_eq!(store.active_revision(), 0);
        let job = store
            .create(JobType::Train, json!({"inputPath": "audio.wav"}))
            .unwrap();
        assert_eq!(store.active_revision(), 1);
        assert!(store.has_active_jobs());
        store.running(&job.id);
        store.log(&job.id, "processing");
        store.progress(&job.id, 50.0);
        assert_eq!(store.active_revision(), 1);
        assert!(store.cancel(&job.id, "Stopped by user"));
        assert_eq!(store.active_revision(), 2);
        assert!(!store.has_active_jobs());
        store.seal().await;
    }

    #[tokio::test]
    async fn batch_pages_keep_result_offsets_and_publish_the_latest_terminal_state() {
        let root = tempfile::tempdir().unwrap();
        let store = JobStore::open(root.path().join("jobs.json")).unwrap();
        let job = store
            .create(
                JobType::BatchInference,
                json!({"selectedFiles": ["voice.wav"], "inputFolder": "inputs"}),
            )
            .unwrap();
        let mut subscription = store.subscribe_batch(&job.id).unwrap().updates.unwrap();
        let items: Vec<_> = (0..24)
            .map(|index| {
                json!({
                    "input": format!("clip{index}.wav"), "status": "done",
                    "output": format!("outputs/clip{index}.wav"),
                })
            })
            .collect();
        store.result(
            &job.id,
            json!({"items": items, "files": 24, "failed":0, "total": 24, "outputFolder":"outputs"}),
        );
        let second = store.public_job(&job.id, Some(1), None).unwrap();
        assert_eq!(second["result"]["itemCount"], 24);
        assert_eq!(second["result"]["items"], json!(&items[20..]));
        assert_eq!(second["params"], json!({"inputFolder": "inputs"}));
        assert_eq!(
            store.public_job(&job.id, Some(usize::MAX), None).unwrap()["result"]["items"],
            json!([])
        );
        assert_eq!(
            store.batch_output(&job.id, 20),
            Some(("outputs".into(), "outputs/clip20.wav".into()))
        );
        store.done(&job.id, store.result_snapshot(&job.id).unwrap(), None);

        subscription.changed().await.unwrap();
        let terminal = subscription.borrow_and_update().clone();
        assert_eq!(terminal["status"], "done");
        assert_eq!(terminal["result"]["items"], json!(&items[..20]));
        assert!(subscription.changed().await.is_err());
        let full = store.public_job(&job.id, None, None).unwrap();
        assert_eq!(full["params"]["selectedFiles"], json!(["voice.wav"]));
        assert_eq!(full["result"]["items"], json!(items));
        store.seal().await;
    }

    #[tokio::test]
    async fn history_cards_keep_display_context_and_leave_full_details_on_demand() {
        let root = tempfile::tempdir().unwrap();
        let store = JobStore::open(root.path().join("jobs.json")).unwrap();
        let job = store
            .create(
                JobType::BatchInference,
                json!({
                    "modelName": "voice", "pthPath": "model.pth", "inputFolder": "inputs",
                    "modelLink": "another field", "selectedFiles": ["audio.wav"],
                }),
            )
            .unwrap();
        for number in 0..25 {
            store.log(&job.id, &format!("Line {number}"));
        }
        let active = &store.history_cards()[0];
        assert_eq!(active["logs"].as_array().unwrap().len(), HISTORY_LOG_TAIL);
        assert_eq!(active["logs"][0], "Line 5");
        assert_eq!(
            active["params"],
            json!({"modelName": "voice", "pthPath": "model.pth", "inputFolder": "inputs"})
        );

        let result = json!({"message": "Finished", "items": [{"output": "audio.wav"}]});
        store.done(&job.id, result.clone(), Some("audio.wav".into()));
        let finished = &store.history_cards()[0];
        assert_eq!(finished["logs"], json!([]));
        assert_eq!(finished["result"], json!({"message": "Finished"}));
        assert_eq!(finished["outputFile"], "audio.wav");
        let detail = store
            .public_job(&job.id, None, Some(HISTORY_LOG_TAIL))
            .unwrap();
        assert_eq!(detail, store.public_list(HISTORY_LOG_TAIL)[0]);
        assert_eq!(detail["result"], result);
        assert_eq!(detail["params"]["selectedFiles"], json!(["audio.wav"]));
        assert_eq!(
            store.public_job(&job.id, None, None).unwrap()["logs"]
                .as_array()
                .unwrap()
                .len(),
            25
        );
        store.seal().await;
    }

    #[test]
    fn sealing_waits_for_a_cancelled_flush_to_publish() {
        tokio::runtime::Builder::new_current_thread()
            .max_blocking_threads(1)
            .enable_all()
            .build()
            .unwrap()
            .block_on(async {
                let root = tempfile::tempdir().unwrap();
                let path = root.path().join("jobs.json");
                let store = JobStore::open(path.clone()).unwrap();
                let job = store.create(JobType::Train, json!({})).unwrap();
                for number in 0..=HISTORY_LOGS {
                    store.log(&job.id, &format!("Line {number}"));
                }
                store.done(&job.id, Value::Null, None);

                let (release, blocked) = std::sync::mpsc::channel();
                let blocker = tokio::task::spawn_blocking(move || blocked.recv().unwrap());
                let writer = tokio::spawn({
                    let store = store.clone();
                    async move { store.flush().await }
                });
                while store.0.persisted_revision.try_lock().is_ok() {
                    tokio::task::yield_now().await;
                }
                writer.abort();
                assert!(writer.await.unwrap_err().is_cancelled());
                assert!(store.0.persisted_revision.try_lock().is_err());

                release.send(()).unwrap();
                blocker.await.unwrap();
                store.seal().await;
                let saved = load_history(&path).unwrap();
                assert_eq!(saved[0].id, job.id);
                assert_eq!(saved[0].status, JobStatus::Done);
                assert_eq!(saved[0].logs.len(), HISTORY_LOGS);
                assert_eq!(saved[0].logs.first().unwrap(), "Line 1");
                assert_eq!(
                    saved[0].logs.last().unwrap(),
                    &format!("Line {HISTORY_LOGS}")
                );
            });
    }

    #[tokio::test]
    async fn dashboard_counts_active_jobs_and_projects_only_the_latest_audio() {
        let root = tempfile::tempdir().unwrap();
        let store = JobStore::open(root.path().join("jobs.json")).unwrap();
        assert!(store.dashboard()["latestOutput"].is_null());
        let active = store.create(JobType::Train, json!({})).unwrap();
        let audio = store
            .create(JobType::Inference, json!({"pthPath": "logs/voice.pth", "indexPath": "logs/voice.index", "inputPath": "private.wav"}))
            .unwrap();
        let image = store.create(JobType::Other, json!({})).unwrap();
        let failed = store.create(JobType::Inference, json!({})).unwrap();
        let older_audio = store.create(JobType::Tts, json!({})).unwrap();
        for (position, job) in [&older_audio, &audio, &image, &failed, &active]
            .into_iter()
            .enumerate()
        {
            store.update(&job.id, |job| {
                job.created_at = format!("2026-01-01T00:00:0{position}.000Z");
                true
            });
        }
        store.log(&audio.id, "detailed output");
        store.done(
            &audio.id,
            json!({"size": 123}),
            Some("outputs/voice.WAV".into()),
        );
        store.done(&image.id, Value::Null, Some("outputs/image.png".into()));
        store.update(&failed.id, |job| {
            job.output_file = Some("outputs/failed.wav".into());
            true
        });
        store.error(&failed.id, "failed", None);
        store.done(
            &older_audio.id,
            Value::Null,
            Some("outputs/older.mp3".into()),
        );

        let dashboard = store.dashboard();
        assert_eq!(dashboard["activeJobs"], 1);
        assert_eq!(dashboard["recentJobs"], json!(&store.activity()[..4]));
        assert_eq!(
            dashboard["latestOutput"],
            json!({
                "jobId": audio.id, "outputFile": "outputs/voice.WAV", "label": audio.label(),
                "createdAt": "2026-01-01T00:00:01.000Z", "model": "logs/voice.pth", "index": "logs/voice.index"
            })
        );
        store.seal().await;
    }

    #[tokio::test]
    async fn activity_and_job_subscribers_receive_their_own_updates() {
        let root = tempfile::tempdir().unwrap();
        let store = JobStore::open(root.path().join("jobs.json")).unwrap();
        let watched = store.create(JobType::Train, json!({})).unwrap();
        let other = store.create(JobType::Download, json!({})).unwrap();
        let (_, mut activity) = store.subscribe_activity();
        let subscription = store.subscribe_job(&watched.id).unwrap();
        assert_eq!(subscription.snapshot.status, JobStatus::Queued);
        let mut details = subscription.updates.unwrap();
        let mut second_view = store.subscribe_job(&watched.id).unwrap().updates.unwrap();

        store.log(&other.id, "Unrelated output");
        store.running(&other.id);
        let state = activity.try_recv().unwrap();
        assert_eq!(state["id"], other.id);
        assert_eq!(state["status"], "running");
        assert!(state.get("logs").is_none());
        assert!(matches!(activity.try_recv(), Err(TryRecvError::Empty)));
        assert!(matches!(details.try_recv(), Err(TryRecvError::Empty)));

        store.log(&watched.id, "Preparing dataset");
        let log = details.try_recv().unwrap();
        assert_eq!(log.logs, ["Preparing dataset"]);
        assert!(Arc::ptr_eq(&log, &second_view.try_recv().unwrap()));
        assert!(matches!(activity.try_recv(), Err(TryRecvError::Empty)));

        store.done(&watched.id, json!({"ok": true}), Some("output.wav".into()));
        let terminal = details.try_recv().unwrap();
        assert_eq!(terminal.status, JobStatus::Done);
        assert_eq!(terminal.output_file.as_deref(), Some("output.wav"));
        assert_eq!(activity.try_recv().unwrap()["status"], "done");
        assert!(matches!(details.try_recv(), Err(TryRecvError::Closed)));
        let finished = store.subscribe_job(&watched.id).unwrap();
        assert_eq!(finished.snapshot.status, JobStatus::Done);
        assert!(finished.updates.is_none());
        store.seal().await;
    }

    #[tokio::test]
    async fn job_subscriptions_can_resynchronize_after_lag() {
        let root = tempfile::tempdir().unwrap();
        let store = JobStore::open(root.path().join("jobs.json")).unwrap();
        let job = store.create(JobType::Train, json!({})).unwrap();
        let mut details = store.subscribe_job(&job.id).unwrap().updates.unwrap();
        for i in 0..=EVENT_BUFFER {
            store.progress(&job.id, (i % 101) as f64);
        }
        assert!(matches!(details.try_recv(), Err(TryRecvError::Lagged(_))));
        let current = store.subscribe_job(&job.id).unwrap();
        assert_eq!(current.snapshot.progress, Some((EVENT_BUFFER % 101) as u8));
        let mut updates = current.updates.unwrap();
        assert!(matches!(updates.try_recv(), Err(TryRecvError::Empty)));
        store.cancel(&job.id, "Stopped by user");
        assert_eq!(updates.try_recv().unwrap().status, JobStatus::Error);
        store.seal().await;
    }

    #[test]
    fn wide_tqdm_preserves_metadata_before_truncation() {
        let line = format!(
            "\x1b[32m 52%|{}| 480/915 [00:19<00:09, 47.05it/s]\x1b[A",
            "█".repeat(3000)
        );
        assert_eq!(
            normalize_log_line(&line),
            " 52%|| 480/915 [00:19<00:09, 47.05it/s]"
        );
    }

    #[test]
    fn log_normalization_preserves_messages_and_progress_descriptions() {
        let line = "model | epoch=11 | step=2346 | batch=46/230";
        assert_eq!(normalize_log_line(line), line);
        let line = normalize_log_line("Downloading: 12%|##    | 12/100 [00:01<00:08, 10it/s]");
        assert_eq!(progress_description(&line).as_deref(), Some("downloading:"));
        assert_eq!(
            normalize_log_line("Starting pitch extraction..."),
            "Starting pitch extraction..."
        );
    }

    #[tokio::test]
    async fn training_bar_redraws_keep_latest_counters_without_filling_history() {
        let root = tempfile::tempdir().unwrap();
        let store = JobStore::open(root.path().join("jobs.json")).unwrap();
        let job = store
            .create(JobType::Train, json!({"modelName":"voice"}))
            .unwrap();
        store.running(&job.id);
        for batch in 0..=7 {
            store.log(
                &job.id,
                &format!(
                    "epoch=18 | step={} | {}%|{}| batch={batch}/7 [00:01<00:01, 4.00it/s]",
                    119 + batch,
                    batch * 100 / 7,
                    "█".repeat(3000)
                ),
            );
        }
        let logs = store.get(&job.id).unwrap().logs;
        assert_eq!(logs.len(), 1);
        assert!(logs[0].contains("step=126 | 100%|| batch=7/7"));
        assert_eq!(progress_description(&logs[0]).as_deref(), Some("epoch=18"));

        store.log(
            &job.id,
            "voice | epoch=18 | step=126 | time=21:50:46 | training_speed=0:00:02",
        );
        store.log(
            &job.id,
            "epoch=19 | step=126 | 0%|| batch=0/7 [00:00<?, ?it/s]",
        );
        let logs = store.get(&job.id).unwrap().logs;
        assert_eq!(logs.len(), 3);
        assert!(logs[1].contains("training_speed="));
        assert!(logs[2].contains("epoch=19"));
        store.seal().await;
    }
}
