//! HTTP contracts backed by a real Python fixture, with no Node listener.
use crate::{
    engine::{NativeEngine, Readiness},
    engine_runtime::EngineRuntime,
    jobs::{Job, JobStatus},
    ApiConfig, Router,
};
use anyhow::Result;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use futures_util::future::BoxFuture;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;

struct Ready(bool);
impl Readiness for Ready {
    fn require(&self, _: bool, _: CancellationToken) -> BoxFuture<'_, Result<()>> {
        Box::pin(async move {
            if self.0 {
                Ok(())
            } else {
                anyhow::bail!("Complete setup first")
            }
        })
    }
}
pub(crate) struct Fixture {
    pub(crate) _directory: TempDir,
    pub(crate) engine: Arc<NativeEngine>,
    pub(crate) app: Router,
}
impl Fixture {
    pub(crate) fn new(ready: bool) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let code = directory.path().join("code");
        let data = directory.path().join("data");
        for folder in [
            "assets",
            "backend/python/inference",
            "backend/python/datasets",
            "backend/python/downloads",
            "backend/applio/rvc/configs",
            "backend/applio/rvc/lib/tools",
            "backend/applio/rvc/train/process",
        ] {
            std::fs::create_dir_all(code.join(folder)).unwrap();
        }
        std::fs::create_dir_all(&data).unwrap();
        std::fs::write(
            code.join("assets/config_template.json"),
            r#"{"lang":{"override":true,"selected_lang":"en_US"}}"#,
        )
        .unwrap();
        std::fs::write(code.join("backend/applio/rvc/configs/config.py"), "").unwrap();
        for script in [
            "backend/python/inference/runtime.py",
            "backend/applio/rvc/lib/tools/tts.py",
            "backend/applio/rvc/lib/tools/f0_curve.py",
            "backend/applio/rvc/train/process/model_information.py",
        ] {
            std::fs::write(code.join(script), PYTHON).unwrap();
        }
        std::fs::create_dir_all(code.join("uvr")).unwrap();
        std::fs::write(code.join("uvr/models.py"), "fixture registry").unwrap();
        for script in ["uvr/separate.py", "uvr/install.py"] {
            std::fs::write(code.join(script), crate::uvr_checks::PYTHON).unwrap();
        }
        for file in ["voice.pth", "fallback.pth", "index.index", "input.wav"] {
            std::fs::write(data.join(file), b"fixture").unwrap();
        }
        std::fs::write(code.join("backend/applio/rvc/lib/tools/analyzer.py"), "from pathlib import Path\ndef analyze_audio(input,plot):\n Path(plot).write_bytes(b'plot'); return {'duration':2.5},plot\n").unwrap();
        std::fs::write(code.join("backend/applio/rvc/train/process/model_blender.py"), "import os\nfrom pathlib import Path\ndef model_blender(name,p1,p2,ratio):\n file=Path(os.environ['APPLIO_LOGS_DIR'])/(name+'.pth'); file.write_bytes(b'blended'); return 'CLI blended',str(file)\n").unwrap();
        std::fs::write(code.join("backend/applio/rvc/lib/tools/inspect_checkpoint.py"), "from pathlib import Path\nimport json\ndef inspect_checkpoint(path):\n if 'corrupt' in str(path): raise ValueError('LOAD_FAILED: corrupt fixture')\n sidecar=Path(path).parent/'model_info.json'\n return {'model_name':'Fixture fallback','speakers_id':'4',**(json.loads(sidecar.read_text()) if sidecar.is_file() else {})}\n").unwrap();
        let config = ApiConfig {
            code_root: code,
            data_root: data,
            config_dir: directory.path().join("config"),
        };
        let python = std::env::var_os("PYTHON_BIN")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(if cfg!(windows) { "python" } else { "python3" }));
        let runtime = EngineRuntime::with_python(&config, Some(python)).unwrap();
        let engine = NativeEngine::open_with_options(
            runtime,
            Arc::new(Ready(ready)),
            crate::engine::EngineOptions::default(),
        )
        .unwrap();
        let app = crate::native::router(config, engine.clone());
        Self {
            _directory: directory,
            engine,
            app,
        }
    }
    pub(crate) async fn request(&self, path: &str, body: Value) -> (StatusCode, Value) {
        self.send(
            Request::post(path)
                .header("content-type", "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
    }
    pub(crate) async fn send(&self, request: Request<Body>) -> (StatusCode, Value) {
        let response = self.app.clone().oneshot(request).await.unwrap();
        let status = response.status();
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        (
            status,
            serde_json::from_slice(&bytes)
                .unwrap_or_else(|_| json!(String::from_utf8_lossy(&bytes))),
        )
    }
    pub(crate) async fn start(&self, path: &str, params: Value) -> String {
        let (status, body) = self.request(path, params).await;
        assert_eq!(status, StatusCode::ACCEPTED, "{body}");
        body["jobId"].as_str().unwrap().into()
    }
    pub(crate) async fn finish(&self, id: &str) -> Job {
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let job = self.engine.jobs.get(id).unwrap();
                if !job.active() {
                    return job;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("job timed out")
    }
    pub(crate) async fn stage(&self, id: &str, text: &str) {
        tokio::time::timeout(Duration::from_secs(10), async {
            loop {
                if self
                    .engine
                    .jobs
                    .get(id)
                    .unwrap()
                    .logs
                    .iter()
                    .any(|line| line.contains(text))
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("stage timed out");
    }
}
fn params() -> Value {
    json!({"pthPath":"voice.pth", "indexPath":"index.index", "inputPath":"input.wav", "exportFormat":"FLAC"})
}
pub(crate) fn multipart(
    path: &str,
    fields: &[(&str, &str)],
    files: &[(&str, &str, &str)],
) -> Request<Body> {
    let mut body = String::new();
    for (name, value) in fields {
        body.push_str(&format!(
            "--fixture\r\nContent-Disposition: form-data; name=\"{name}\"\r\n\r\n{value}\r\n"
        ));
    }
    for (name, filename, contents) in files {
        body.push_str(&format!("--fixture\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{filename}\"\r\nContent-Type: application/octet-stream\r\n\r\n{contents}\r\n"));
    }
    body.push_str("--fixture--\r\n");
    Request::post(path)
        .header("content-type", "multipart/form-data; boundary=fixture")
        .body(Body::from(body))
        .unwrap()
}

#[tokio::test]
async fn native_conversion_reuses_worker_and_serves_byte_ranges_without_node() {
    let fixture = Fixture::new(true);
    let (status, health) = fixture
        .send(Request::get("/api/health").body(Body::empty()).unwrap())
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(health["compatibilityService"], false);
    for _ in 0..2 {
        let id = fixture.start("/api/inference", params()).await;
        let job = fixture.finish(&id).await;
        assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
        assert!(job.output_file.as_ref().unwrap().ends_with(".flac"));
        let (status, public) = fixture
            .send(
                Request::get(format!("/api/jobs/{id}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(public["job"]["status"], "done");
        let output = fixture.engine.runtime.data.join(job.output_file.unwrap());
        let response = fixture
            .app
            .clone()
            .oneshot(
                Request::get(format!(
                    "/outputs/{}",
                    output.file_name().unwrap().to_string_lossy()
                ))
                .header("range", "bytes=2-5")
                .body(Body::empty())
                .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(response.headers()["content-range"], "bytes 2-5/10");
        assert_eq!(
            response.into_body().collect().await.unwrap().to_bytes(),
            "2345"
        );
    }
    let starts =
        std::fs::read_to_string(fixture.engine.runtime.data.join("worker-starts")).unwrap();
    assert_eq!(starts.lines().count(), 1);
    let (status, _) = fixture.request("/api/not-ported", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn native_tts_upload_analysis_pitch_inspection_and_blending_keep_response_shapes() {
    let fixture = Fixture::new(true);
    let (status, response) = fixture
        .send(multipart(
            "/api/tts",
            &[("pthPath", "voice.pth"), ("ttsVoice", "fr-FR-DeniseNeural")],
            &[("txt_file", "speech.txt", "Bonjour")],
        ))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    let job = fixture.finish(response["jobId"].as_str().unwrap()).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert!(fixture
        .engine
        .runtime
        .data
        .join(job.result.unwrap()["ttsIntermediate"].as_str().unwrap())
        .is_file());
    for route in [
        "/api/extra/analyze",
        "/api/extra/f0",
        "/api/extra/model-info",
    ] {
        let id = fixture.start(route, params()).await;
        let job = fixture.finish(&id).await;
        assert_eq!(job.status, JobStatus::Done, "{route} {:?}", job.error);
        let result = job.result.unwrap();
        match route {
            "/api/extra/analyze" => assert_eq!(result["info"]["duration"], 1.25),
            "/api/extra/f0" => assert!(fixture
                .engine
                .runtime
                .data
                .join(result["curveFile"].as_str().unwrap())
                .is_file()),
            _ => {
                assert_eq!(result["metadata"]["model_name"], "Fixture");
                assert_eq!(
                    result["message"],
                    "Checkpoint \"Fixture\" analyzed successfully."
                );
            }
        }
    }
    let long_name = format!("{}.pth", "a".repeat(200));
    let (status, response) = fixture
        .send(multipart(
            "/api/voice-blender",
            &[("modelName", "../blended"), ("ratio", "0.25")],
            &[
                ("pth_file_1", &long_name, "one"),
                ("pth_file_2", "two.pth", "two"),
            ],
        ))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{response}");
    let job = fixture.finish(response["jobId"].as_str().unwrap()).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(job.output_file.as_deref(), Some("logs/blended.pth"));
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn native_cli_fallback_keeps_the_same_job_and_does_not_deadlock_gpu() {
    let fixture = Fixture::new(true);
    let mut args = params();
    args["pthPath"] = json!("fallback.pth");
    let id = fixture.start("/api/inference", args.clone()).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert!(job.logs.iter().any(|line| line.contains("falling back")));
    args["ttsText"] = json!("__fallback__");
    args["ttsVoice"] = json!("en-US-Fixture");
    let id = fixture.start("/api/tts", args).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(fixture.engine.jobs.list().len(), 2);
    assert!(!fixture.engine.scheduler.gpu_busy());
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn stop_cancels_running_python_and_admits_queued_http_job() {
    let fixture = Fixture::new(true);
    let id = fixture
        .start(
            "/api/tts",
            json!({"pthPath":"voice.pth","ttsText":"__slow__","ttsVoice":"en-US-Fixture"}),
        )
        .await;
    fixture.stage(&id, "fixture waiting").await;
    let queued = fixture.start("/api/inference", params()).await;
    fixture.stage(&queued, "Waiting for the GPU").await;
    let (status, _) = fixture
        .request(&format!("/api/jobs/{id}/stop"), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    let stopped = fixture.finish(&id).await;
    assert_eq!(stopped.status, JobStatus::Error);
    assert_eq!(stopped.error.as_deref(), Some("Stopped by user"));
    let done = fixture.finish(&queued).await;
    assert_eq!(done.status, JobStatus::Done, "{:?}", done.error);
    assert_eq!(fixture.engine.jobs.get(&id).unwrap().output_file, None);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn rejected_uploads_are_removed_and_never_create_jobs() {
    let fixture = Fixture::new(true);
    for request in [
        multipart(
            "/api/inference",
            &[("pthPath", "missing.pth")],
            &[("audio", "input.wav", "audio")],
        ),
        multipart(
            "/api/tts",
            &[("pthPath", "voice.pth"), ("ttsVoice", "fixture")],
            &[("txt_file", "input.exe", "text")],
        ),
        multipart(
            "/api/inference",
            &[("pthPath", "voice.pth")],
            &[
                ("audio", "input.wav", "audio"),
                ("audio", "second.wav", "audio"),
            ],
        ),
        Request::post("/api/inference")
            .header("content-type", "text/plain")
            .body(Body::from(params().to_string()))
            .unwrap(),
    ] {
        let (status, _) = fixture.send(request).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(
            std::fs::read_dir(&fixture.engine.runtime.uploads)
                .unwrap()
                .count(),
            0
        );
    }
    let mut invalid = params();
    invalid["pitch"] = json!(9999);
    let (status, body) = fixture.request("/api/inference", invalid).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body["details"]["fieldErrors"].is_object());
    assert!(fixture.engine.jobs.list().is_empty());
    fixture.engine.shutdown().await.unwrap();
    let fixture = Fixture::new(false);
    let (status, body) = fixture
        .send(multipart(
            "/api/inference",
            &[("pthPath", "voice.pth")],
            &[("audio", "input.wav", "audio")],
        ))
        .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert_eq!(
        std::fs::read_dir(&fixture.engine.runtime.uploads)
            .unwrap()
            .count(),
        0
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn batch_preview_selection_and_download_keep_source_extension_collisions_separate() {
    let fixture = Fixture::new(true);
    let audio = fixture.engine.runtime.data.join("input");
    std::fs::create_dir_all(&audio).unwrap();
    for name in ["voice.wav", "voice.mp3", "skip.wav", "ignore.txt"] {
        std::fs::write(audio.join(name), b"fixture").unwrap();
    }
    let (status, body) = fixture
        .request(
            "/api/inference/batch/preview",
            json!({"inputFolder":"input"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["files"].as_array().unwrap().len(), 3);
    let args = json!({"pthPath":"voice.pth","inputFolder":"input","outputFolder":"batch-results","exportFormat":"FLAC","excludedFiles":["skip.wav"],"selectedFiles":["voice.wav","voice.mp3"]});
    let id = fixture.start("/api/inference/batch", args.clone()).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    let result = job.result.unwrap();
    assert_eq!(result["files"], 2);
    assert_eq!(result["failed"], 0);
    assert_eq!(result["total"], 2);
    let items = result["items"].as_array().unwrap();
    assert_ne!(items[0]["output"], items[1]["output"]);
    assert!(items
        .iter()
        .all(|item| item["output"].as_str().unwrap().ends_with("_output.flac")));
    let response = fixture
        .app
        .clone()
        .oneshot(
            Request::get(format!("/api/inference/batch/{id}/outputs/0"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers()["content-disposition"]
        .to_str()
        .unwrap()
        .starts_with("attachment;"));
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        "0123456789"
    );
    for index in ["-1", "2", "1.5"] {
        let (status, _) = fixture
            .send(
                Request::get(format!("/api/inference/batch/{id}/outputs/{index}"))
                    .body(Body::empty())
                    .unwrap(),
            )
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }
    let mut stale = args;
    stale["selectedFiles"] = json!(["gone.wav"]);
    let (status, response) = fixture.request("/api/inference/batch", stale).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(response["error"].as_str().unwrap().contains("changed"));
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn batch_model_overrides_and_partial_failures_remain_in_one_job() {
    let fixture = Fixture::new(true);
    let audio = fixture.engine.runtime.data.join("input");
    std::fs::create_dir_all(&audio).unwrap();
    for name in ["error.wav", "good.wav"] {
        std::fs::write(audio.join(name), b"fixture").unwrap();
    }
    let id = fixture.start("/api/inference/batch",json!({"pthPath":"voice.pth","inputFolder":"input","outputFolder":"results","continueOnError":"yes"})).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    let result = job.result.unwrap();
    assert_eq!(result["files"], 1);
    assert_eq!(result["failed"], 1);
    assert_eq!(result["items"][0]["status"], "error");
    let id = fixture.start("/api/inference/batch",json!({"pthPath":"voice.pth","inputFolder":"input","outputFolder":"results","continueOnError":"false"})).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Error);
    assert_eq!(job.result.unwrap()["items"].as_array().unwrap().len(), 1);
    for folder in ["first", "second"] {
        std::fs::create_dir_all(fixture.engine.runtime.logs.join(folder)).unwrap();
        std::fs::write(
            fixture.engine.runtime.logs.join(folder).join("voice.pth"),
            b"fixture",
        )
        .unwrap();
    }
    let id = fixture.start("/api/inference/batch",json!({"mode":"models","inputPath":"input.wav","outputFolder":"results","models":[{"pthPath":"logs/first/voice.pth","overrides":{"exportFormat":"FLAC"}},{"pthPath":"logs/second/voice.pth","overrides":{"exportFormat":"MP3"}}]})).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    let result = job.result.unwrap();
    assert_eq!(result["models"], 2);
    let items = result["items"].as_array().unwrap();
    assert!(items[0]["output"].as_str().unwrap().ends_with(".flac"));
    assert!(items[1]["output"].as_str().unwrap().ends_with(".mp3"));
    assert_ne!(
        PathBuf::from(items[0]["output"].as_str().unwrap()).parent(),
        PathBuf::from(items[1]["output"].as_str().unwrap()).parent()
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn batch_download_rejects_existing_files_outside_its_output_folder() {
    let fixture = Fixture::new(true);
    let job = fixture
        .engine
        .jobs
        .create(crate::jobs::JobType::BatchInference, json!({}))
        .unwrap();
    fixture.engine.jobs.running(&job.id);
    fixture.engine.jobs.done(&job.id,json!({"outputFolder":fixture.engine.runtime.outputs,"items":[{"status":"done","output":fixture.engine.runtime.data.join("voice.pth")}]}),None);
    let (status, _) = fixture
        .send(
            Request::get(format!("/api/inference/batch/{}/outputs/0", job.id))
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn analysis_and_model_tool_fallbacks_run_within_the_original_gpu_job() {
    let fixture = Fixture::new(true);
    std::fs::write(fixture.engine.runtime.data.join("force-fallback"), "yes").unwrap();
    for route in [
        "/api/extra/analyze",
        "/api/extra/f0",
        "/api/extra/model-info",
        "/api/voice-blender",
    ] {
        let mut args = params();
        args["modelName"] = json!("blended");
        args["pthPath1"] = json!("voice.pth");
        args["pthPath2"] = json!("voice.pth");
        let id = fixture.start(route, args).await;
        let job = fixture.finish(&id).await;
        assert_eq!(job.status, JobStatus::Done, "{route} {:?}", job.error);
        if route == "/api/extra/model-info" {
            assert_eq!(job.result.unwrap()["metadata"]["model_name"], "Fixture CLI");
        }
    }
    assert_eq!(fixture.engine.jobs.list().len(), 4);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn shutdown_interrupts_native_http_jobs_and_preserves_history() {
    let fixture = Fixture::new(true);
    let id = fixture
        .start(
            "/api/tts",
            json!({"pthPath":"voice.pth","ttsText":"__slow__","ttsVoice":"en-US-Fixture"}),
        )
        .await;
    fixture.stage(&id, "fixture waiting").await;
    fixture.engine.shutdown().await.unwrap();
    assert!(fixture.engine.worker.pid().is_none());
    assert!(!fixture.engine.scheduler.gpu_busy());
    let history: Value = serde_json::from_slice(
        &std::fs::read(fixture.engine.runtime.config_dir.join("jobs.json")).unwrap(),
    )
    .unwrap();
    assert!(history.to_string().contains("Interrupted by app shutdown"));
    let (status, _) = fixture.request("/api/inference", params()).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn standalone_native_http_listener_streams_terminal_events_and_audio_ranges() {
    let fixture = Fixture::new(true);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let shutdown = CancellationToken::new();
    let stopped = shutdown.clone();
    let app = fixture.app.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(stopped.cancelled_owned())
            .await
            .unwrap();
    });
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    let base = format!("http://{address}");
    let health: Value = client
        .get(format!("{base}/api/health"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(health["compatibilityService"], false);
    let response = client
        .post(format!("{base}/api/inference"))
        .json(&params())
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    let response: Value = response.json().await.unwrap();
    let id = response["jobId"].as_str().unwrap();
    let events = client
        .get(format!("{base}/api/jobs/{id}/events"))
        .send()
        .await
        .unwrap();
    assert_eq!(events.headers()["content-type"], "text/event-stream");
    let events = events.text().await.unwrap();
    assert!(events.contains("\"status\":\"done\""));
    let job = fixture.finish(id).await;
    let path = job.output_file.unwrap();
    let response = client
        .get(format!("{base}/api/audio/raw"))
        .query(&[("path", path)])
        .header("range", "bytes=0-3")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.bytes().await.unwrap(), "0123");
    fixture.engine.shutdown().await.unwrap();
    shutdown.cancel();
    server.await.unwrap();
}

#[tokio::test]
async fn native_runtime_preserves_custom_storage_and_maps_installed_python_commands() {
    let fixture = Fixture::new(true);
    let logs = fixture._directory.path().join("custom logs");
    fixture
        .engine
        .runtime
        .config
        .update(json!({"logs_dir":logs,"precision":"fp16","version":"stale"}))
        .unwrap();
    let config = ApiConfig {
        code_root: fixture.engine.runtime.code.clone(),
        data_root: fixture.engine.runtime.data.clone(),
        config_dir: fixture.engine.runtime.config_dir.clone(),
    };
    let runtime =
        EngineRuntime::with_python(&config, Some(fixture.engine.runtime.python_bin().into()))
            .unwrap();
    std::fs::write(logs.join("voice.pth"), b"fixture").unwrap();
    assert_eq!(
        runtime.require_file("logs/voice.pth").unwrap(),
        logs.join("voice.pth")
    );
    assert!(runtime.resolve_user_path("../../outside").is_err());
    assert!(runtime.resolve_user_path("logs/../../outside").is_err());
    assert!(runtime.require_file("logs/missing.pth").is_err());
    assert_eq!(
        runtime.resolve_user_path("assets/new-output").unwrap(),
        runtime.data.join("assets/new-output")
    );
    let spec = runtime
        .python_command(["rvc/infer/infer.py", "--pth-path", "logs/voice.pth"])
        .unwrap();
    assert_eq!(
        PathBuf::from(&spec.args[0]),
        runtime.code.join("backend/python/inference/runtime.py")
    );
    assert_eq!(spec.args[1], "infer");
    assert_eq!(spec.cwd, runtime.data);
    assert_eq!(
        PathBuf::from(
            spec.env
                .get(std::ffi::OsStr::new("APPLIO_LOGS_DIR"))
                .unwrap()
        ),
        logs
    );
    let config: Value =
        serde_json::from_slice(&std::fs::read(runtime.config_dir.join("config.json")).unwrap())
            .unwrap();
    assert!(config.get("version").is_none());
    assert_eq!(config["precision"], "fp16");
    let path = runtime.config_dir.join("config.json");
    std::fs::write(&path, "corrupt settings").unwrap();
    assert!(runtime.config.load().is_err());
    assert_eq!(std::fs::read_to_string(path).unwrap(), "corrupt settings");
    fixture.engine.shutdown().await.unwrap();
}

const PYTHON: &str = r#"
import sys,os,json,time
from pathlib import Path
def write(path):
    Path(path).parent.mkdir(parents=True,exist_ok=True)
    Path(path).write_bytes(b'0123456789')
def emit(value): value['_applio_ipc']=True; print(json.dumps(value),flush=True)
def flag(name): return sys.argv[sys.argv.index(name)+1]
if len(sys.argv)>1 and sys.argv[1]=='worker':
    with open('worker-starts','a') as f: f.write(str(os.getpid())+'\n')
    emit({'type':'ready'})
    for line in sys.stdin:
        p=json.loads(line); c=p['command']; id=p['id']
        emit({'type':'log','id':id,'message':'fixture processing'})
        if Path('force-fallback').is_file():
            emit({'type':'error','id':id,'error':'fixture forces fallback'}); continue
        if 'error.wav' in p.get('inputPath',''):
            emit({'type':'error','id':id,'error':'fixture invalid audio'}); continue
        if 'fallback' in p.get('params',{}).get('pthPath','') or p.get('ttsText')=='__fallback__':
            emit({'type':'error','id':id,'error':'fixture requests CLI fallback'}); continue
        if p.get('ttsText')=='__slow__':
            emit({'type':'log','id':id,'message':'fixture waiting'}); time.sleep(60)
        r={'type':'done','id':id}
        if c=='infer' or c=='tts':
            model=Path(p['params']['pthPath']); assert model.is_absolute() and model.is_file()
            if p['params'].get('indexPath'): assert Path(p['params']['indexPath']).is_absolute()
            if c=='tts':
                write(p['outputTtsPath'])
                if p.get('ttsFile'): assert Path(p['ttsFile']).read_text()=='Bonjour'
            file=Path(p['outputPath'] if c=='infer' else p['outputRvcPath']).with_suffix('.'+p['params']['exportFormat'].lower()); write(file)
            r['outputPath']=str(file)
        elif c=='analyze_audio': write(p['plotPath']); r.update(info={'duration':1.25},plot=p['plotPath'])
        elif c=='f0_curve': write(p['outputImage']); write(p['outputTxt'])
        elif c=='inspect_model':
            if 'corrupt' in p['pthPath']:
                emit({'type':'error','id':id,'error':'LOAD_FAILED: corrupt fixture'}); continue
            with open('inspect-count','a') as f: f.write('inspect\n')
            if Path('slow-inspect').exists(): Path('slow-inspect').unlink(); write('inspect-started'); time.sleep(60)
            if 'slow' in p['pthPath']: time.sleep(0.25)
            sidecar=Path(p['pthPath']).parent/'model_info.json'
            r['metadata']={'model_name':'Fixture','speakers_id':'3',**(json.loads(sidecar.read_text()) if sidecar.is_file() else {})}
        elif c=='preload_model':
            if Path('slow-preload').exists(): write('preload-started'); time.sleep(60)
            write(Path('preloaded')/Path(p['pthPath']).name)
        elif c=='model_blender':
            assert p['pth1'].endswith('.pth') and p['pth2'].endswith('.pth')
            file=Path(os.environ['APPLIO_LOGS_DIR'])/(p['modelName']+'.pth'); write(file); r.update(file=str(file),message='Models blended')
        emit(r)
elif '--output-tts-path' in sys.argv:
    write(flag('--output-tts-path')); print('CLI speech generated')
elif '--output-path' in sys.argv:
    if 'error.wav' in flag('--input-path'): print('fixture invalid audio',file=sys.stderr); sys.exit(2)
    write(Path(flag('--output-path')).with_suffix('.'+flag('--export-format').lower())); print('CLI converted')
elif '--output-image' in sys.argv:
    write(flag('--output-image')); write(flag('--output-txt'))
else: print('Model name: Fixture CLI')
"#;
