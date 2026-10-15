use crate::{metadata_cache::MetadataCache, processing_checks::Fixture};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

#[tokio::test]
async fn an_explicit_conversion_interrupts_slow_speculative_model_loading() {
    let fixture = Fixture::new(true);
    std::fs::write(fixture.engine.runtime.data.join("slow-preload"), "").unwrap();
    fixture
        .request("/api/models/preload", json!({"pthPath":"voice.pth"}))
        .await;
    tokio::time::timeout(Duration::from_secs(5), async {
        while !fixture
            .engine
            .runtime
            .data
            .join("preload-started")
            .is_file()
        {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let old_pid = fixture.engine.worker.pid().unwrap();
    let id = fixture
        .start(
            "/api/inference",
            json!({"pthPath":"voice.pth","inputPath":"input.wav","exportFormat":"WAV"}),
        )
        .await;
    let job = tokio::time::timeout(Duration::from_secs(5), fixture.finish(&id))
        .await
        .unwrap();
    assert_eq!(job.status, crate::jobs::JobStatus::Done, "{:?}", job.error);
    assert_ne!(fixture.engine.worker.pid(), Some(old_pid));
    assert!(!fixture
        .engine
        .runtime
        .data
        .join("preloaded/voice.pth")
        .exists());
    fixture.engine.shutdown().await.unwrap();
}

fn get(path: &str) -> Request<Body> {
    Request::get(path).body(Body::empty()).unwrap()
}

#[tokio::test]
async fn interrupted_metadata_reads_resume_after_the_requested_conversion() {
    use tower::ServiceExt;
    let fixture = Fixture::new(true);
    std::fs::write(fixture.engine.runtime.data.join("slow-inspect"), "").unwrap();
    let app = fixture.app.clone();
    let inspect = tokio::spawn(async move {
        app.oneshot(
            Request::post("/api/models/inspect")
                .header("content-type", "application/json")
                .body(Body::from(json!({"pthPath":"voice.pth"}).to_string()))
                .unwrap(),
        )
        .await
        .unwrap()
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while !fixture
            .engine
            .runtime
            .data
            .join("inspect-started")
            .is_file()
        {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let id = fixture
        .start(
            "/api/inference",
            json!({"pthPath":"voice.pth","inputPath":"input.wav","exportFormat":"WAV"}),
        )
        .await;
    let job = tokio::time::timeout(Duration::from_secs(5), fixture.finish(&id))
        .await
        .unwrap();
    assert_eq!(job.status, crate::jobs::JobStatus::Done, "{:?}", job.error);
    let response = tokio::time::timeout(Duration::from_secs(5), inspect)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), 1024 * 1024)
        .await
        .unwrap();
    let body: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["metadata"]["model_name"], "Fixture");
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("inspect-count"))
            .unwrap()
            .lines()
            .count(),
        2
    );
    assert!(!fixture.engine.scheduler.gpu_busy());
    fixture.engine.shutdown().await.unwrap();
}
fn delete(path: &str) -> Request<Body> {
    Request::delete(path).body(Body::empty()).unwrap()
}

#[tokio::test]
async fn custom_model_storage_keeps_logs_aliases_for_library_inspection_and_deletion() {
    let mut fixture = Fixture::new(true);
    fixture.engine.shutdown().await.unwrap();
    let logs = fixture._directory.path().join("models on another volume");
    fixture
        .engine
        .runtime
        .config
        .update(json!({"logs_dir":logs}))
        .unwrap();
    let config = crate::ApiConfig {
        code_root: fixture.engine.runtime.code.clone(),
        data_root: fixture.engine.runtime.data.clone(),
        config_dir: fixture.engine.runtime.config_dir.clone(),
    };
    let runtime = crate::engine_runtime::EngineRuntime::with_python(
        &config,
        Some(fixture.engine.runtime.python_bin().into()),
    )
    .unwrap();
    let ready = Arc::new(crate::engine::RuntimeReadiness::new(runtime.clone(), true));
    fixture.engine = crate::engine::NativeEngine::open(runtime, ready).unwrap();
    fixture.app = crate::native::router(config, fixture.engine.clone());
    std::fs::create_dir_all(logs.join("custom")).unwrap();
    std::fs::write(logs.join("custom/voice.pth"), b"checkpoint").unwrap();
    let (status, body) = fixture.send(get("/api/models")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["models"], json!(["logs/custom/voice.pth"]));
    let (status, body) = fixture
        .request(
            "/api/models/inspect",
            json!({"pthPath":"logs/custom/voice.pth"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (status, body) = fixture.send(delete("/api/models/logs%2Fcustom")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!logs.join("custom").exists());
    assert!(logs.is_dir());
    assert!(fixture.engine.runtime.data.join("voice.pth").is_file());
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn aborting_http_inspection_releases_the_worker_and_gpu_for_the_next_request() {
    use tower::ServiceExt;
    let fixture = Fixture::new(true);
    std::fs::write(fixture.engine.runtime.data.join("slow.pth"), b"checkpoint").unwrap();
    let app = fixture.app.clone();
    let task = tokio::spawn(async move {
        app.oneshot(
            Request::post("/api/models/inspect")
                .header("content-type", "application/json")
                .body(Body::from(json!({"pthPath":"slow.pth"}).to_string()))
                .unwrap(),
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while !fixture.engine.runtime.data.join("inspect-count").is_file() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(!fixture.engine.scheduler.gpu_busy());
    assert!(fixture.engine.worker.pid().is_none());
    let (status, body) = fixture
        .request("/api/models/inspect", json!({"pthPath":"voice.pth"}))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn model_lists_and_library_keep_public_shapes_and_decoder_exclusions() {
    let fixture = Fixture::new(true);
    let logs = &fixture.engine.runtime.logs;
    for (file, contents) in [
        ("voice/voice.pth", "model"),
        ("voice/added.index", "index"),
        ("voice/trained.index", "skip"),
        ("voice/G_20.pth", "skip"),
        ("voice/D_20.pth", "skip"),
        ("onnx.onnx", "onnx"),
        (".onnx-cache/decoder.onnx", "skip"),
        (".onnx-export-building/decoder.onnx", "skip"),
    ] {
        let file = logs.join(file);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, contents).unwrap();
    }
    std::fs::write(fixture.engine.runtime.outputs.join("audio.wav"), b"audio").unwrap();
    let (status, list) = fixture.send(get("/api/models")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        list["models"],
        json!(["logs/onnx.onnx", "logs/voice/voice.pth"])
    );
    assert_eq!(list["indexes"], json!(["logs/voice/added.index"]));
    assert!(list["audios"]
        .as_array()
        .unwrap()
        .contains(&json!("assets/audios/audio.wav")));
    assert_eq!(list["root"], json!(fixture.engine.runtime.data));
    let (status, list) = fixture.send(get("/api/models/library")).await;
    assert_eq!(status, StatusCode::OK);
    let models = list["models"].as_array().unwrap();
    assert_eq!(models.len(), 2);
    let voice = models
        .iter()
        .find(|model| model["name"] == "voice")
        .unwrap();
    assert_eq!(voice["id"], "logs/voice/voice.pth");
    assert_eq!(voice["pthSize"], 5);
    assert_eq!(voice["folder"], "voice");
    assert_eq!(voice["indexPath"], "logs/voice/added.index");
    assert_eq!(voice["indexSize"], 5);
    chrono::DateTime::parse_from_rfc3339(voice["modifiedAt"].as_str().unwrap()).unwrap();
    assert_eq!(
        models.iter().find(|model| model["name"] == "onnx").unwrap()["folder"],
        "root"
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn inspect_and_speakers_share_metadata_and_invalidate_for_files_and_sidecars() {
    let fixture = Fixture::new(true);
    let body = json!({"pthPath":"voice.pth"});
    let (status, first) = fixture.request("/api/models/inspect", body.clone()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first["cached"], false);
    assert_eq!(first["metadata"]["model_name"], "Fixture");
    let (_, second) = fixture.request("/api/models/inspect", body.clone()).await;
    assert_eq!(second["cached"], true);
    let (status, speakers) = fixture
        .send(get("/api/models/speakers?pthPath=voice.pth"))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(speakers["speakers"], json!([0, 1, 2]));
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("inspect-count"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    std::fs::write(
        fixture.engine.runtime.data.join("model_info.json"),
        r#"{"model_name":"Sidecar","speakers_id":"2"}"#,
    )
    .unwrap();
    let (_, third) = fixture.request("/api/models/inspect", body.clone()).await;
    assert_eq!(third["cached"], false);
    assert_eq!(third["metadata"]["model_name"], "Sidecar");
    std::fs::write(
        fixture.engine.runtime.data.join("voice.pth"),
        "changed checkpoint bytes",
    )
    .unwrap();
    let (_, fourth) = fixture.request("/api/models/inspect", body).await;
    assert_eq!(fourth["cached"], false);
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("inspect-count"))
            .unwrap()
            .lines()
            .count(),
        3
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn concurrent_inspection_deduplicates_python_loads_without_extra_jobs() {
    let fixture = Fixture::new(true);
    std::fs::write(fixture.engine.runtime.data.join("slow.pth"), "model").unwrap();
    let request = || fixture.request("/api/models/inspect", json!({"pthPath":"slow.pth"}));
    let (first, second, third) = tokio::join!(request(), request(), request());
    for (status, body) in [first, second, third] {
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["cached"], false);
    }
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("inspect-count"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    assert!(fixture.engine.jobs.list().is_empty());
    assert!(!fixture.engine.scheduler.gpu_busy());
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn inspection_fallback_and_corruption_status_preserve_model_contracts() {
    let fixture = Fixture::new(true);
    std::fs::write(fixture.engine.runtime.data.join("force-fallback"), "yes").unwrap();
    let (status, body) = fixture
        .request("/api/models/inspect", json!({"pthPath":"voice.pth"}))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["metadata"]["model_name"], "Fixture fallback");
    let (status, speakers) = fixture
        .send(get("/api/models/speakers?pthPath=voice.pth"))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(speakers["speakers"], json!([0, 1, 2, 3]));
    std::fs::write(fixture.engine.runtime.data.join("corrupt.pth"), "broken").unwrap();
    for path in [
        "/api/models/inspect",
        "/api/models/speakers?pthPath=corrupt.pth",
    ] {
        let (status, body) = if path.ends_with("inspect") {
            fixture
                .request(path, json!({"pthPath":"corrupt.pth"}))
                .await
        } else {
            fixture.send(get(path)).await
        };
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "{body}");
        assert!(body["error"].as_str().unwrap().contains("corrupt fixture"));
    }
    for body in [json!({}), json!({"pthPath":"missing.pth"})] {
        let (status, _) = fixture.request("/api/models/inspect", body.clone()).await;
        assert_eq!(
            status,
            if body.get("pthPath").is_some() {
                StatusCode::NOT_FOUND
            } else {
                StatusCode::BAD_REQUEST
            }
        );
    }
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn speaker_counts_are_bounded_and_preserve_single_speaker_fallback() {
    let fixture = Fixture::new(true);
    for (count, status, expected) in [
        ("0", StatusCode::OK, Some(json!([0]))),
        ("-2", StatusCode::OK, Some(json!([0]))),
        ("2.9", StatusCode::OK, Some(json!([0, 1]))),
        ("not set", StatusCode::OK, Some(json!([0]))),
        ("70000", StatusCode::INTERNAL_SERVER_ERROR, None),
    ] {
        std::fs::write(
            fixture.engine.runtime.data.join("model_info.json"),
            json!({"speakers_id":count}).to_string(),
        )
        .unwrap();
        let (actual, body) = fixture
            .send(get("/api/models/speakers?pthPath=voice.pth"))
            .await;
        assert_eq!(actual, status, "{body}");
        if let Some(expected) = expected {
            assert_eq!(body["speakers"], expected);
        }
    }
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn model_deletion_is_confined_to_logs_and_removes_empty_parent_folders() {
    let fixture = Fixture::new(true);
    let logs = &fixture.engine.runtime.logs;
    std::fs::create_dir_all(logs.join("voice")).unwrap();
    std::fs::write(logs.join("voice/model.pth"), b"model").unwrap();
    let (status, body) = fixture
        .send(delete("/api/models/logs%2Fvoice%2Fmodel.pth"))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!logs.join("voice").exists());
    std::fs::create_dir_all(logs.join("whole/subfolder")).unwrap();
    std::fs::write(logs.join("whole/subfolder/model.pth"), b"model").unwrap();
    let (status, body) = fixture.send(delete("/api/models/whole")).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(!logs.join("whole").exists());
    for path in ["%2E", "%2E%2E%2Fvoice.pth", "logs%2F%2E%2E%2Fvoice.pth"] {
        let (status, body) = fixture.send(delete(&format!("/api/models/{path}"))).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(logs.is_dir());
        assert!(fixture.engine.runtime.data.join("voice.pth").is_file());
    }
    let (status, _) = fixture.send(delete("/api/models/missing.pth")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn preload_skips_gpu_and_realtime_owners_and_is_stopped_with_the_engine() {
    let fixture = Fixture::new(true);
    let lease = fixture.engine.scheduler.try_gpu("conversion").unwrap();
    let (status, body) = fixture
        .request(
            "/api/models/preload",
            json!({"pthPath":"voice.pth","sid":"2"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(fixture.engine.worker.pid().is_none());
    drop(lease);
    let realtime = fixture.engine.scheduler.begin_realtime().unwrap();
    let (status, _) = fixture
        .request("/api/models/preload", json!({"pthPath":"voice.pth"}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert!(fixture.engine.worker.pid().is_none());
    drop(realtime);
    let (status, body) = fixture
        .request(
            "/api/models/preload",
            json!({"pthPath":"voice.pth","sid":"2"}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["preloading"], "voice.pth");
    tokio::time::timeout(Duration::from_secs(5), async {
        while !fixture
            .engine
            .runtime
            .data
            .join("preloaded/voice.pth")
            .is_file()
        {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    fixture.engine.shutdown().await.unwrap();
    assert!(fixture.engine.worker.pid().is_none());
    assert!(!fixture.engine.scheduler.gpu_busy());
}

#[tokio::test]
async fn metadata_cache_is_bounded_and_does_not_retain_failed_or_changed_loads() {
    let directory = tempfile::tempdir().unwrap();
    let cache = MetadataCache::default();
    for number in 0..65 {
        let path = directory.path().join(format!("{number}.pth"));
        std::fs::write(&path, "model").unwrap();
        let (_, cached) = cache
            .get(&path, || async { Ok(json!({"number":number})) })
            .await
            .unwrap();
        assert!(!cached);
    }
    let path = directory.path().join("0.pth");
    let (_, cached) = cache
        .get(&path, || async { Ok(json!({"evicted":true})) })
        .await
        .unwrap();
    assert!(!cached);
    let changed = directory.path().join("changed.pth");
    std::fs::write(&changed, "before").unwrap();
    cache
        .get(&changed, || async {
            std::fs::write(&changed, "after, now longer")?;
            Ok(json!({"old":true}))
        })
        .await
        .unwrap();
    let (_, cached) = cache
        .get(&changed, || async { Ok(json!({"new":true})) })
        .await
        .unwrap();
    assert!(!cached);
    cache.invalidate(&changed);
    assert!(cache
        .get(&changed, || async { anyhow::bail!("reader failed") })
        .await
        .is_err());
    let (_, cached) = cache
        .get(&changed, || async { Ok(json!({"recovered":true})) })
        .await
        .unwrap();
    assert!(!cached);
}

#[tokio::test]
async fn aborted_metadata_load_releases_its_single_flight_gate() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("model.pth");
    std::fs::write(&path, "model").unwrap();
    let cache = Arc::new(MetadataCache::default());
    let count = Arc::new(AtomicUsize::new(0));
    let loading = cache.clone();
    let file = path.clone();
    let started = count.clone();
    let task = tokio::spawn(async move {
        loading
            .get(&file, || async {
                started.fetch_add(1, Ordering::SeqCst);
                std::future::pending::<Result<Value, anyhow::Error>>().await
            })
            .await
    });
    while count.load(Ordering::SeqCst) == 0 {
        tokio::task::yield_now().await;
    }
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    let (value, cached) = tokio::time::timeout(
        Duration::from_secs(1),
        cache.get(&path, || async { Ok(json!({"retry":true})) }),
    )
    .await
    .unwrap()
    .unwrap();
    assert_eq!(value["retry"], true);
    assert!(!cached);
}
