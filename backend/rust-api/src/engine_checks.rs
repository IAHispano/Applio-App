//! Real subprocess/IPC checks for the native replacement, without Node or GPU libraries.
use crate::{
    jobs::{JobStatus, JobStore, JobType},
    process::{CommandSpec, ManagedProcess},
    scheduler::{Resource, Scheduler},
    worker::InferenceWorker,
};
use serde_json::{json, Value};
use std::{path::PathBuf, time::Duration};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

#[tokio::test]
async fn pinned_worker_defers_conversion_imports_and_reuses_the_converter() {
    let directory = tempfile::tempdir().unwrap();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let python = std::env::var_os("PYTHON_BIN")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }));
    let spec =
        CommandSpec::new(python, directory.path()).args([root.join("bin/check-python-startup.py")]);
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        ManagedProcess::run(&spec, &CancellationToken::new(), |_, _| {}),
    )
    .await
    .unwrap()
    .unwrap();
    output.ensure_success().unwrap();
    assert!(output
        .stdout
        .contains("conversion/preload reuse one converter"));
}

#[tokio::test]
#[ignore = "Requires APPLIO_ENGINE_TEST_PYTHON pointing to installed engine Python"]
async fn real_python_command_preparation_and_first_output_timings() {
    let fixture = crate::processing_checks::Fixture::new(true);
    let runtime = &fixture.engine.runtime;
    let config = crate::ApiConfig {
        code_root: runtime.code.clone(),
        data_root: runtime.data.clone(),
        config_dir: runtime.config_dir.clone(),
    };
    let runtime = crate::engine_runtime::EngineRuntime::with_python(
        &config,
        Some(
            std::env::var_os("APPLIO_ENGINE_TEST_PYTHON")
                .expect("engine Python")
                .into(),
        ),
    )
    .unwrap();
    for sample in 1..=5 {
        let start = std::time::Instant::now();
        let spec = runtime.python_command(["-c", "print('READY')"]).unwrap();
        let prepared = start.elapsed();
        let mut first = None;
        let output = ManagedProcess::run(&spec, &CancellationToken::new(), |_, _| {
            first.get_or_insert_with(|| start.elapsed());
        })
        .await
        .unwrap();
        output.ensure_success().unwrap();
        assert_eq!(output.stdout.trim(), "READY");
        println!(
            "Python launch {sample}: prepare {prepared:?}, first output {:?}, total {:?}",
            first.unwrap(),
            start.elapsed()
        );
    }
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn terminal_jobs_reject_late_results_and_activity_does_not_expose_paths() {
    let directory = tempfile::tempdir().unwrap();
    let jobs = JobStore::open(directory.path().join("jobs.json")).unwrap();
    let job = jobs
        .create(JobType::Inference, json!({"pthPath": "/private/model.pth"}))
        .unwrap();
    let token = jobs.cancellation(&job.id).unwrap();
    jobs.running(&job.id);
    jobs.log(&job.id, "sensitive engine output");
    jobs.progress(&job.id, 24.6);
    assert!(jobs.cancel(&job.id, "Stopped by user"));
    assert!(token.is_cancelled());
    jobs.done(
        &job.id,
        json!({"secret": "late result"}),
        Some("private.wav".into()),
    );
    jobs.log(&job.id, "late stderr");
    jobs.running(&job.id);
    let job = jobs.get(&job.id).unwrap();
    assert_eq!(job.status, JobStatus::Error);
    assert_eq!(job.error.as_deref(), Some("Stopped by user"));
    assert_eq!(job.logs, vec!["sensitive engine output"]);
    assert!(job.result.is_none());
    let summary = job.summary();
    assert_eq!(summary["label"], "Voice conversion");
    assert_eq!(summary["progress"], 25);
    assert_eq!(summary["stopped"], true);
    for field in ["params", "logs", "outputFile", "errorDetails", "result"] {
        assert!(summary.get(field).is_none());
    }
    jobs.flush().await.unwrap();
}

#[tokio::test]
async fn engine_markers_drive_stages_and_progress_redraws_replace_previous_bars() {
    let directory = tempfile::tempdir().unwrap();
    let jobs = JobStore::open(directory.path().join("jobs.json")).unwrap();
    let job = jobs.create(JobType::Tts, json!({})).unwrap();
    jobs.running(&job.id);
    jobs.log(&job.id, "\x1b[31mDownloading: 10%|#\x1b[0m");
    jobs.log(&job.id, "Downloading: 20%|##");
    jobs.log(&job.id, "Other model: 50%|###");
    assert_eq!(
        jobs.get(&job.id).unwrap().logs,
        vec!["Downloading: 20%|##", "Other model: 50%|###"]
    );
    jobs.conversion_output(&job.id, "[applio-stage:synthesizing]\nTTS audio generated\nAudio split into 4 chunks\rConverted audio chunk 3\n");
    let current = jobs.get(&job.id).unwrap();
    assert_eq!(current.stage.as_deref(), Some("Converting audio…"));
    assert_eq!(current.progress, Some(75));
    assert_eq!(current.stage_current, Some(3));
    assert_eq!(current.stage_total, Some(4));
    jobs.conversion_output(&job.id, "Saving audio as WAV");
    assert_eq!(
        jobs.get(&job.id).unwrap().stage.as_deref(),
        Some("Saving audio…")
    );
    assert!(jobs.get(&job.id).unwrap().progress.is_none());
    jobs.log(&job.id, &"é".repeat(3000));
    assert_eq!(
        jobs.get(&job.id)
            .unwrap()
            .logs
            .last()
            .unwrap()
            .chars()
            .count(),
        2000
    );
    jobs.flush().await.unwrap();
}

#[tokio::test]
async fn history_restores_the_web_contract_and_retains_damaged_originals() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("jobs.json");
    let jobs = JobStore::open(path.clone()).unwrap();
    let job = jobs
        .create(JobType::Train, json!({"step": "extract"}))
        .unwrap();
    jobs.running(&job.id);
    for number in 0..120 {
        jobs.log(&job.id, &format!("epoch={number}"));
    }
    jobs.flush().await.unwrap();
    drop(jobs);
    let saved: Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(saved[0]["type"], "train");
    assert!(saved[0].get("createdAt").is_some());
    assert!(saved[0].get("created_at").is_none());
    assert_eq!(saved[0]["logs"].as_array().unwrap().len(), 100);
    let restored = JobStore::open(path).unwrap();
    let job = restored.get(&job.id).unwrap();
    assert_eq!(job.status, JobStatus::Error);
    assert!(job
        .error
        .as_ref()
        .unwrap()
        .contains("Interrupted by app restart"));
    assert!(job.finished_at.is_some());
    assert_eq!(job.label(), "Feature extraction");
    drop(restored);
    let corrupt_path = directory.path().join("corrupt-jobs.json");
    std::fs::write(&corrupt_path, b"{invalid original history").unwrap();
    let recovered = JobStore::open(corrupt_path).unwrap();
    assert!(recovered.list().is_empty());
    let original = std::fs::read_dir(directory.path())
        .unwrap()
        .filter_map(Result::ok)
        .find(|entry| entry.file_name().to_string_lossy().ends_with(".corrupt"))
        .unwrap();
    assert_eq!(
        std::fs::read(original.path()).unwrap(),
        b"{invalid original history"
    );
}

#[tokio::test]
async fn concurrent_flushes_never_publish_an_older_snapshot() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("jobs.json");
    let jobs = JobStore::open(path.clone()).unwrap();
    let job = jobs.create(JobType::Other, json!({})).unwrap();
    let mut flushes = Vec::new();
    for number in 1..20 {
        jobs.progress(&job.id, f64::from(number));
        let store = jobs.clone();
        flushes.push(tokio::spawn(async move {
            store.flush().await.unwrap();
        }));
    }
    jobs.progress(&job.id, 99.0);
    jobs.done(&job.id, json!({"ready": true}), None);
    for flush in flushes {
        flush.await.unwrap();
    }
    jobs.flush().await.unwrap();
    let saved: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    assert_eq!(saved[0]["status"], "done");
    assert_eq!(saved[0]["progress"], 99);
    assert_eq!(saved[0]["result"]["ready"], true);
}

#[tokio::test]
async fn history_is_bounded_without_evicting_active_jobs() {
    let directory = tempfile::tempdir().unwrap();
    let jobs = JobStore::open(directory.path().join("jobs.json")).unwrap();
    let active = jobs.create(JobType::Train, json!({})).unwrap();
    for _ in 1..200 {
        let job = jobs.create(JobType::Other, json!({})).unwrap();
        jobs.done(&job.id, json!({}), None);
    }
    jobs.create(JobType::Download, json!({})).unwrap();
    assert_eq!(jobs.list().len(), 200);
    assert_eq!(jobs.get(&active.id).unwrap().status, JobStatus::Queued);
    jobs.flush().await.unwrap();
    let directory = tempfile::tempdir().unwrap();
    let jobs = JobStore::open(directory.path().join("jobs.json")).unwrap();
    for _ in 0..200 {
        jobs.create(JobType::Other, json!({})).unwrap();
    }
    assert!(jobs.create(JobType::Other, json!({})).is_err());
    assert_eq!(jobs.list().len(), 200);
}

#[tokio::test]
async fn gpu_and_realtime_exclude_each_other_while_network_work_continues() {
    let scheduler = Scheduler::default();
    let token = CancellationToken::new();
    let realtime = scheduler.begin_realtime().unwrap();
    assert!(scheduler.begin_realtime().is_none());
    let mut queued = Box::pin(scheduler.acquire("training", Resource::Gpu, &token));
    assert!(futures_util::poll!(queued.as_mut()).is_pending());
    assert_eq!(scheduler.status().queued, vec!["training"]);
    let network_one = scheduler
        .acquire("download-one", Resource::Network, &token)
        .await
        .unwrap()
        .unwrap();
    let network_two = scheduler
        .acquire("download-two", Resource::Network, &token)
        .await
        .unwrap()
        .unwrap();
    let mut network_three =
        Box::pin(scheduler.acquire("download-three", Resource::Network, &token));
    assert!(futures_util::poll!(network_three.as_mut()).is_pending());
    drop(network_one);
    let network_three = network_three.await.unwrap().unwrap();
    assert!(scheduler.status().realtime);
    drop(realtime);
    let gpu = queued.await.unwrap().unwrap();
    assert!(scheduler.begin_realtime().is_none());
    drop(gpu);
    drop(network_two);
    drop(network_three);
    assert!(scheduler.status().active.is_empty());
    assert!(scheduler.begin_realtime().is_some());
}

#[tokio::test]
async fn dropped_or_cancelled_admission_futures_never_leak_a_slot() {
    let scheduler = Scheduler::default();
    let token = CancellationToken::new();
    let gpu = scheduler
        .acquire("first", Resource::Gpu, &token)
        .await
        .unwrap()
        .unwrap();
    let mut waiting = Box::pin(scheduler.acquire("aborted", Resource::Gpu, &token));
    assert!(futures_util::poll!(waiting.as_mut()).is_pending());
    drop(gpu);
    assert_eq!(scheduler.status().active, vec!["aborted"]);
    drop(waiting);
    assert!(scheduler.status().active.is_empty());
    let realtime = scheduler.begin_realtime().unwrap();
    let cancel = CancellationToken::new();
    let mut waiting = Box::pin(scheduler.acquire("cancelled", Resource::Gpu, &cancel));
    assert!(futures_util::poll!(waiting.as_mut()).is_pending());
    cancel.cancel();
    assert!(waiting.await.unwrap().is_none());
    assert!(scheduler.status().queued.is_empty());
    drop(realtime);
    assert!(scheduler
        .acquire("next", Resource::Gpu, &token)
        .await
        .unwrap()
        .is_some());
}

struct PythonFixture {
    directory: TempDir,
    script: PathBuf,
}
impl PythonFixture {
    fn new() -> Self {
        let directory = tempfile::tempdir().unwrap();
        let script = directory.path().join("engine_fixture.py");
        std::fs::write(&script, FIXTURE).unwrap();
        Self { directory, script }
    }
    fn command(&self, mode: &str) -> CommandSpec {
        let python = std::env::var_os("PYTHON_BIN")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }));
        let mut spec = CommandSpec::new(python, self.directory.path())
            .args([self.script.as_os_str(), std::ffi::OsStr::new(mode)]);
        spec.env.insert("PYTHONIOENCODING".into(), "utf-8".into());
        spec.env.insert("PYTHONUNBUFFERED".into(), "1".into());
        spec
    }
}

#[tokio::test]
async fn subprocess_output_preserves_split_unicode_progress_and_exit_diagnostics() {
    let fixture = PythonFixture::new();
    let mut lines = Vec::new();
    let output = ManagedProcess::run(
        &fixture.command("output"),
        &CancellationToken::new(),
        |_, line| lines.push(line.to_owned()),
    )
    .await
    .unwrap();
    output.ensure_success().unwrap();
    assert!(lines.contains(&"héllo 🎵".into()));
    assert!(lines.contains(&"progress 10%".into()));
    assert!(lines.contains(&"progress 20%".into()));
    assert!(output.stderr.contains("diagnostic line"));
    let output = ManagedProcess::run(
        &fixture.command("failure"),
        &CancellationToken::new(),
        |_, _| {},
    )
    .await
    .unwrap();
    assert!(!output.success);
    assert!(output
        .ensure_success()
        .unwrap_err()
        .to_string()
        .contains("specific failure"));
    assert!(
        crate::process::explain_exit_code(Some(0xc0000135_u32 as i32))
            .unwrap()
            .contains("Missing DLL")
    );
}

#[tokio::test]
async fn cancellation_stops_python_descendants_before_returning() {
    let fixture = PythonFixture::new();
    let marker = fixture.directory.path().join("heartbeat.txt");
    let cancel = CancellationToken::new();
    let child_cancel = cancel.clone();
    let command = fixture.command("parent");
    let (started, ready) = tokio::sync::oneshot::channel();
    let handle = tokio::spawn(async move {
        let mut started = Some(started);
        ManagedProcess::run(&command, &child_cancel, |_, line| {
            if line == "child-ready" {
                if let Some(started) = started.take() {
                    let _ = started.send(());
                }
            }
        })
        .await
    });
    tokio::time::timeout(Duration::from_secs(10), ready)
        .await
        .unwrap()
        .unwrap();
    assert!(marker.exists());
    cancel.cancel();
    assert!(handle
        .await
        .unwrap()
        .unwrap_err()
        .to_string()
        .contains("Stopped by user"));
    let stopped = std::fs::read(&marker).unwrap();
    tokio::time::sleep(Duration::from_millis(250)).await;
    assert_eq!(
        std::fs::read(marker).unwrap(),
        stopped,
        "A descendant kept running after cancellation"
    );
}

#[tokio::test]
async fn worker_reuses_a_session_waits_for_warmup_and_recovers_after_task_errors() {
    let fixture = PythonFixture::new();
    let worker = InferenceWorker::new(fixture.command("worker"));
    let token = CancellationToken::new();
    let first = worker
        .request(json!({"command": "infer", "id": "first"}), &token, |_| {})
        .await
        .unwrap();
    let pid = first["pid"].as_u64().unwrap();
    let second = worker
        .request(json!({"command": "tts", "id": "second"}), &token, |_| {})
        .await
        .unwrap();
    assert_eq!(second["pid"], pid);
    assert!(worker
        .request(json!({"command": "infer", "fail": true}), &token, |_| {})
        .await
        .unwrap_err()
        .to_string()
        .contains("fixture failure"));
    let again = worker
        .request(json!({"command": "ping"}), &token, |_| {})
        .await
        .unwrap();
    assert_eq!(again["pid"], pid);
    worker
        .request(json!({"command": "warmup"}), &token, |_| {})
        .await
        .unwrap();
    assert!(fixture.directory.path().join("warmed.txt").exists());
    worker.stop().await.unwrap();
    assert!(worker.pid().is_none());
}

#[tokio::test]
async fn worker_cancellation_abortion_and_idle_shutdown_restart_cleanly() {
    let fixture = PythonFixture::new();
    let worker = InferenceWorker::with_timeouts(
        fixture.command("worker"),
        Duration::from_secs(5),
        Duration::from_millis(80),
    );
    let token = CancellationToken::new();
    let child_worker = worker.clone();
    let child_token = token.clone();
    let (started, ready) = tokio::sync::oneshot::channel();
    let handle = tokio::spawn(async move {
        let mut started = Some(started);
        child_worker
            .request(
                json!({"command": "infer", "sleep": 10}),
                &child_token,
                |line| {
                    if line == "starting" {
                        if let Some(started) = started.take() {
                            let _ = started.send(());
                        }
                    }
                },
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(10), ready)
        .await
        .unwrap()
        .unwrap();
    token.cancel();
    assert!(handle.await.unwrap().is_err());
    assert!(worker.pid().is_none());
    let token = CancellationToken::new();
    worker
        .request(json!({"command": "ping"}), &token, |_| {})
        .await
        .unwrap();
    assert!(worker.pid().is_some());
    tokio::time::timeout(Duration::from_secs(3), async {
        while worker.pid().is_some() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap();
    let abort_worker = worker.clone();
    let (started, ready) = tokio::sync::oneshot::channel();
    let handle = tokio::spawn(async move {
        let mut started = Some(started);
        abort_worker
            .request(
                json!({"command": "infer", "sleep": 10}),
                &CancellationToken::new(),
                |line| {
                    if line == "starting" {
                        if let Some(started) = started.take() {
                            let _ = started.send(());
                        }
                    }
                },
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(10), ready)
        .await
        .unwrap()
        .unwrap();
    handle.abort();
    let _ = handle.await;
    assert!(worker.pid().is_none());
    worker
        .request(json!({"command": "ping"}), &token, |_| {})
        .await
        .unwrap();
    worker.stop().await.unwrap();
}

#[tokio::test]
async fn native_job_http_and_sse_preserve_live_updates_and_terminal_closure() {
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use futures_util::StreamExt;
    use http_body_util::BodyExt;
    use tower::ServiceExt;
    let directory = tempfile::tempdir().unwrap();
    let jobs = JobStore::open(directory.path().join("jobs.json")).unwrap();
    let job = jobs
        .create(JobType::Inference, json!({"pthPath": "/private/model.pth"}))
        .unwrap();
    let router = crate::job_routes::router(jobs.clone(), Scheduler::default());
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/jobs")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(body["jobs"][0]["label"], "Voice conversion");
    assert_eq!(
        body["scheduling"],
        json!({"realtime": false, "active": [], "queued": []})
    );
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .uri(format!("/api/jobs/{}/events", job.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.headers()["content-type"], "text/event-stream");
    assert_eq!(response.headers()["x-accel-buffering"], "no");
    let mut stream = response.into_body().into_data_stream();
    let first = stream.next().await.unwrap().unwrap();
    assert!(String::from_utf8_lossy(&first).contains("\"status\":\"queued\""));
    jobs.running(&job.id);
    let running = stream.next().await.unwrap().unwrap();
    assert!(String::from_utf8_lossy(&running).contains("\"status\":\"running\""));
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!("/api/jobs/{}/stop", job.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let stopped = stream.next().await.unwrap().unwrap();
    assert!(String::from_utf8_lossy(&stopped).contains("Stopped by user"));
    assert!(stream.next().await.is_none());
    let response = router
        .oneshot(
            Request::builder()
                .uri("/api/jobs/does-not-exist")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    jobs.flush().await.unwrap();
}

#[tokio::test]
async fn slow_sse_clients_resynchronize_without_replaying_stale_progress() {
    use axum::{body::Body, http::Request};
    use futures_util::StreamExt;
    use tower::ServiceExt;
    let directory = tempfile::tempdir().unwrap();
    let jobs = JobStore::open(directory.path().join("jobs.json")).unwrap();
    let job = jobs.create(JobType::Train, json!({})).unwrap();
    let router = crate::job_routes::router(jobs.clone(), Scheduler::default());
    let response = router
        .oneshot(
            Request::builder()
                .uri(format!("/api/jobs/{}/events", job.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let mut stream = response.into_body().into_data_stream();
    stream.next().await.unwrap().unwrap();
    for number in 0..600 {
        jobs.progress(&job.id, f64::from(number % 100));
    }
    jobs.progress(&job.id, 99.0);
    jobs.done(&job.id, json!({"complete": true}), None);
    let current = stream.next().await.unwrap().unwrap();
    let current = String::from_utf8_lossy(&current);
    assert!(current.contains("\"status\":\"done\""));
    assert!(current.contains("\"progress\":99"));
    assert!(stream.next().await.is_none());
    jobs.flush().await.unwrap();
}

#[tokio::test]
async fn worker_startup_timeout_and_process_crashes_do_not_leave_a_resident_session() {
    let fixture = PythonFixture::new();
    let silent = InferenceWorker::with_timeouts(
        fixture.command("silent"),
        Duration::from_millis(100),
        Duration::from_secs(60),
    );
    let error = silent
        .request(
            json!({"command": "ping"}),
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap_err();
    assert!(error.to_string().contains("startup timed out"));
    assert!(silent.pid().is_none());
    let worker = InferenceWorker::new(fixture.command("worker"));
    assert!(worker
        .request(
            json!({"command": "infer", "exit": true}),
            &CancellationToken::new(),
            |_| {}
        )
        .await
        .is_err());
    assert!(worker.pid().is_none());
    worker
        .request(
            json!({"command": "ping"}),
            &CancellationToken::new(),
            |_| {},
        )
        .await
        .unwrap();
    worker.stop().await.unwrap();
}

#[tokio::test]
async fn cancelling_a_queued_worker_request_does_not_stop_the_active_request() {
    let fixture = PythonFixture::new();
    let worker = InferenceWorker::new(fixture.command("worker"));
    let active_worker = worker.clone();
    let (started, ready) = tokio::sync::oneshot::channel();
    let active = tokio::spawn(async move {
        let mut started = Some(started);
        active_worker
            .request(
                json!({"command": "infer", "sleep": 0.2}),
                &CancellationToken::new(),
                |line| {
                    if line == "starting" {
                        if let Some(started) = started.take() {
                            let _ = started.send(());
                        }
                    }
                },
            )
            .await
    });
    tokio::time::timeout(Duration::from_secs(10), ready)
        .await
        .unwrap()
        .unwrap();
    let active_pid = worker.pid().unwrap();
    let cancel = CancellationToken::new();
    let mut queued = Box::pin(worker.request(json!({"command": "tts"}), &cancel, |_| {}));
    assert!(futures_util::poll!(queued.as_mut()).is_pending());
    cancel.cancel();
    assert!(queued
        .await
        .unwrap_err()
        .to_string()
        .contains("Stopped by user"));
    assert_eq!(active.await.unwrap().unwrap()["pid"], active_pid);
    assert_eq!(worker.pid(), Some(active_pid));
    worker.stop().await.unwrap();
}

#[tokio::test]
async fn jobs_with_the_same_timestamp_keep_the_original_insertion_order() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("jobs.json");
    let jobs = JobStore::open(path.clone()).unwrap();
    let mut originals = Vec::new();
    for _ in 0..3 {
        let mut job = jobs.create(JobType::Other, json!({})).unwrap();
        job.status = JobStatus::Done;
        job.created_at = "2026-10-14T12:00:00.000Z".into();
        originals.push(job);
    }
    drop(jobs);
    std::fs::write(&path, serde_json::to_vec(&originals).unwrap()).unwrap();
    let restored = JobStore::open(path).unwrap();
    assert_eq!(
        restored
            .list()
            .iter()
            .map(|job| &job.id)
            .collect::<Vec<_>>(),
        originals.iter().map(|job| &job.id).collect::<Vec<_>>()
    );
    restored.flush().await.unwrap();
}

const FIXTURE: &str = r#"
import json, os, subprocess, sys, time
from pathlib import Path
mode = sys.argv[1]
if mode == 'silent':
    while True: time.sleep(1)
def emit(kind, **fields):
    print(json.dumps({'_applio_ipc': True, 'type': kind, **fields}), flush=True)
if mode == 'output':
    data = 'héllo 🎵\rprogress 10%\rprogress 20%\n'.encode('utf-8')
    for byte in data:
        sys.stdout.buffer.write(bytes([byte])); sys.stdout.buffer.flush()
    print('diagnostic line', file=sys.stderr, flush=True)
elif mode == 'failure':
    print('specific failure', file=sys.stderr, flush=True); sys.exit(7)
elif mode == 'child':
    while True:
        Path('heartbeat.txt').write_text(str(time.monotonic()))
        time.sleep(0.025)
elif mode == 'parent':
    subprocess.Popen([sys.executable, __file__, 'child'])
    while not Path('heartbeat.txt').exists(): time.sleep(0.005)
    print('child-ready', flush=True)
    while True: time.sleep(1)
elif mode == 'worker':
    emit('ready', pid=os.getpid())
    for line in sys.stdin:
        request = json.loads(line)
        command, id = request['command'], request.get('id')
        if request.get('exit'): os._exit(17)
        if command == 'warmup':
            time.sleep(0.04); Path('warmed.txt').write_text('ready'); continue
        if request.get('sleep'):
            emit('log', id=id, message='starting'); time.sleep(request['sleep'])
        if request.get('fail'):
            emit('error', id=id, error='fixture failure', traceback='fixture traceback'); continue
        if command == 'ping': emit('pong', id=id, pid=os.getpid())
        elif command == 'unload': emit('unloaded', id=id)
        else:
            emit('done', id='another-job', pid=-1)
            emit('done', id=id, pid=os.getpid(), outputPath='converted.wav')
"#;
