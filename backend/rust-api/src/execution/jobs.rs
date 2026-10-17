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
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tokio::sync::{broadcast, watch};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

pub const MAX_JOBS: usize = 200;
const MAX_LOGS: usize = 500;
const HISTORY_LOGS: usize = 100;

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

    pub fn public_value(&self, log_tail: Option<usize>) -> Value {
        // Select the tail before serialization. Serializing a complete training
        // log and then discarding it made history requests allocate it twice.
        let start = log_tail.map_or(0, |tail| self.logs.len().saturating_sub(tail));
        let mut value = json!({
            "id": self.id, "type": self.kind, "status": self.status,
            "createdAt": self.created_at, "updatedAt": self.updated_at,
            "label": self.label(), "logs": &self.logs[start..],
        });
        macro_rules! optional {
            ($($key:literal => $field:ident),* $(,)?) => {
                $(if let Some(field) = &self.$field { value[$key] = json!(field); })*
            };
        }
        optional! {
            "startedAt" => started_at, "finishedAt" => finished_at,
            "params" => params, "result" => result, "error" => error,
            "errorDetails" => error_details, "outputFile" => output_file,
            "stage" => stage, "stageCurrent" => stage_current,
            "stageTotal" => stage_total, "progress" => progress,
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EventKind {
    State,
    Log,
}

#[derive(Clone, Debug)]
pub struct JobEvent {
    pub kind: EventKind,
    pub job: Job,
}

struct Entry {
    ordinal: u64,
    job: Job,
    cancellation: CancellationToken,
    last_log_event: Option<Instant>,
}
struct StoreState {
    jobs: HashMap<String, Entry>,
    revision: u64,
    next_ordinal: u64,
    closed: bool,
}
struct Inner {
    state: Mutex<StoreState>,
    path: PathBuf,
    events: broadcast::Sender<JobEvent>,
    dirty: watch::Sender<u64>,
    persist_gate: tokio::sync::Mutex<()>,
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
                    },
                )
            })
            .collect();
        let (events, _) = broadcast::channel(256);
        let (dirty, mut changes) = watch::channel(0);
        let next_ordinal = jobs.len() as u64;
        let store = Self(Arc::new(Inner {
            state: Mutex::new(StoreState {
                jobs,
                revision: 0,
                next_ordinal,
                closed: false,
            }),
            path,
            events,
            dirty,
            persist_gate: tokio::sync::Mutex::new(()),
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

    pub fn create(&self, kind: JobType, params: Value) -> Result<Job> {
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
            },
        );
        self.changed(&mut state);
        self.publish(EventKind::State, job.clone());
        drop(state);
        Ok(job)
    }

    fn changed(&self, state: &mut StoreState) {
        state.revision += 1;
        self.0.dirty.send_replace(state.revision);
    }
    fn publish(&self, kind: EventKind, job: Job) {
        let _ = self.0.events.send(JobEvent { kind, job });
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
    pub fn revision(&self) -> u64 {
        *self.0.dirty.borrow()
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
    pub fn activity(&self) -> Vec<Value> {
        ordered_entries(&self.0.state.lock().unwrap(), true)
            .into_iter()
            .map(|entry| entry.job.summary())
            .collect()
    }
    pub fn subscribe(&self) -> broadcast::Receiver<JobEvent> {
        self.0.events.subscribe()
    }

    /// Register while holding the mutation lock, then capture the snapshot.
    /// Events received afterwards can never predate this initial snapshot.
    pub fn subscribe_job(&self, id: &str) -> Option<(Job, broadcast::Receiver<JobEvent>)> {
        let state = self.0.state.lock().unwrap();
        let receiver = self.0.events.subscribe();
        state
            .jobs
            .get(id)
            .map(|entry| (entry.job.clone(), receiver))
    }

    pub fn subscribe_activity(&self) -> (Vec<Value>, broadcast::Receiver<JobEvent>) {
        let state = self.0.state.lock().unwrap();
        let receiver = self.0.events.subscribe();
        let activity = ordered_entries(&state, true)
            .into_iter()
            .map(|entry| entry.job.summary())
            .collect();
        (activity, receiver)
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

    fn update(&self, id: &str, update: impl FnOnce(&mut Job) -> bool) -> Option<Job> {
        let mut state = self.0.state.lock().unwrap();
        let entry = state.jobs.get_mut(id)?;
        if !entry.job.active() || !update(&mut entry.job) {
            return None;
        }
        entry.job.updated_at = timestamp();
        if !entry.job.active() {
            entry.cancellation.cancel();
        }
        let job = entry.job.clone();
        self.changed(&mut state);
        self.publish(EventKind::State, job.clone());
        drop(state);
        Some(job)
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
        if !progress.is_finite() {
            return;
        }
        let progress = progress.round().clamp(0.0, 100.0) as u8;
        self.update(id, |job| {
            if job.progress == Some(progress) {
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
        .is_some()
    }
    pub fn cancel(&self, id: &str, reason: &str) -> bool {
        self.fail(id, reason.to_owned(), None)
    }
    pub fn cancel_all(&self, reason: &str) {
        for job in self.list() {
            if job.active() {
                self.cancel(&job.id, reason);
            }
        }
    }

    pub fn log(&self, id: &str, line: &str) {
        static ANSI: OnceLock<Regex> = OnceLock::new();
        let ansi = ANSI.get_or_init(|| Regex::new(r"\x1b\[[0-9;?]*[a-zA-Z]").unwrap());
        let clean: String = ansi.replace_all(line, "").chars().take(2000).collect();
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
        let event = if entry
            .last_log_event
            .is_none_or(|at| at.elapsed() >= Duration::from_millis(250))
        {
            entry.last_log_event = Some(Instant::now());
            Some(entry.job.clone())
        } else {
            None
        };
        self.changed(&mut state);
        if let Some(job) = event {
            self.publish(EventKind::Log, job);
        }
        drop(state);
    }

    pub fn conversion_output(&self, id: &str, output: &str) {
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
                self.stage(id, "Converting audio…", None, None);
            }
            if let Some(total) = split
                .captures(line)
                .and_then(|c| c[1].parse::<u64>().ok())
                .filter(|n| *n > 0)
            {
                self.stage(id, "Converting audio…", Some(0), Some(total));
                self.progress(id, 0.0);
            }
            if let Some(current) = chunk.captures(line).and_then(|c| c[1].parse::<u64>().ok()) {
                if let Some(job) = self
                    .get(id)
                    .filter(|job| job.stage.as_deref() == Some("Converting audio…"))
                {
                    if let Some(total) = job.stage_total.filter(|total| *total > 0) {
                        let current = current.min(total);
                        self.stage(id, "Converting audio…", Some(current), Some(total));
                        self.progress(id, current as f64 * 100.0 / total as f64);
                    }
                }
            }
            if lower.contains("saving audio as") {
                self.stage(id, "Saving audio…", None, None);
            }
        }
    }

    pub async fn flush(&self) -> Result<()> {
        let _gate = self.0.persist_gate.lock().await;
        if self.0.sealed.is_cancelled() {
            return Ok(());
        }
        loop {
            let (revision, bytes) = {
                let state = self.0.state.lock().unwrap();
                let jobs: Vec<_> = ordered_jobs(&state, false)
                    .into_iter()
                    .map(|mut job| {
                        job.logs = job.logs[job.logs.len().saturating_sub(HISTORY_LOGS)..].to_vec();
                        job
                    })
                    .collect();
                (state.revision, serde_json::to_vec(&jobs)?)
            };
            let inner = self.0.clone();
            let published = tokio::task::spawn_blocking(move || -> Result<bool> {
                let parent = inner
                    .path
                    .parent()
                    .context("History has no parent directory")?;
                std::fs::create_dir_all(parent)?;
                let temporary = parent.join(format!(".jobs-{}.tmp", Uuid::new_v4()));
                let operation = (|| -> Result<bool> {
                    use std::io::Write;
                    let mut options = std::fs::OpenOptions::new();
                    options.write(true).create_new(true);
                    #[cfg(unix)]
                    {
                        use std::os::unix::fs::OpenOptionsExt;
                        options.mode(0o600);
                    }
                    let mut file = options.open(&temporary)?;
                    file.write_all(&bytes)?;
                    file.sync_all()?;
                    drop(file);
                    let state = inner.state.lock().unwrap();
                    if state.revision != revision {
                        return Ok(false);
                    }
                    crate::storage::replace_file(&temporary, &inner.path)?;
                    Ok(true)
                })();
                let _ = std::fs::remove_file(&temporary);
                operation
            })
            .await??;
            if published {
                return Ok(());
            }
        }
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
        let _gate = self.0.persist_gate.lock().await;
        self.0.sealed.cancel();
    }
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

fn progress_description(line: &str) -> Option<String> {
    static PROGRESS: OnceLock<Regex> = OnceLock::new();
    let found = PROGRESS
        .get_or_init(|| Regex::new(r"\d{1,3}%\s*\|").unwrap())
        .find(line)?;
    let description = line[..found.start()].trim();
    let description = description
        .strip_prefix("[stdout]")
        .or_else(|| description.strip_prefix("[stderr]"))
        .unwrap_or(description);
    Some(description.trim().to_lowercase())
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
