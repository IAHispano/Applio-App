use crate::{processing_checks::Fixture, settings_routes};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::{json, Value};
fn get(path: &str) -> Request<Body> {
    Request::get(path).body(Body::empty()).unwrap()
}
fn put(path: &str, body: Value) -> Request<Body> {
    Request::put(path)
        .header("content-type", "application/json")
        .body(Body::from(body.to_string()))
        .unwrap()
}

#[tokio::test]
async fn preferences_round_trip_preserves_fonts_realtime_and_shipped_version_policy() {
    let fixture = Fixture::new(true);
    let patch = json!({"model_index_filter":true,"model_author":null,"precision":"bf16","lang":{"override":true,"selected_lang":"fr_FR","ignored":true},"theme":{"file":"ocean.json","font":["Inter","sans-serif"],"ignored":true},"realtime":{"model_file":"logs/voice.pth","pitch":2},"rmvpe_high_register":{"enabled":true,"mode":"fold","f0_ceil":1800},"version":"wrong","ignored":true});
    let (status, body) = fixture.send(put("/api/settings", patch)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["ok"], true);
    assert!(body["config"].get("ignored").is_none());
    assert!(body["config"]["lang"].get("ignored").is_none());
    let (status, body) = fixture.send(get("/api/settings")).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["logsDir"], json!(fixture.engine.runtime.logs));
    assert_eq!(
        body["defaultLogsDir"],
        json!(fixture.engine.runtime.data.join("logs"))
    );
    assert_eq!(body["config"]["precision"], "bf16");
    assert_eq!(body["config"]["model_author"], Value::Null);
    assert_eq!(body["config"]["lang"]["selected_lang"], "fr_FR");
    assert_eq!(
        body["config"]["theme"]["font"],
        json!(["Inter", "sans-serif"])
    );
    assert_eq!(body["config"]["realtime"]["pitch"], 2);
    let saved: Value = serde_json::from_slice(
        &std::fs::read(fixture.engine.runtime.config_dir.join("config.json")).unwrap(),
    )
    .unwrap();
    assert!(saved.get("version").is_none());
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn settings_reject_invalid_nested_values_without_changing_preferences() {
    let fixture = Fixture::new(true);
    let before = std::fs::read(fixture.engine.runtime.config_dir.join("config.json")).unwrap();
    for body in [
        json!({"precision":"fp8"}),
        json!({"model_index_filter":"false"}),
        json!({"lang":{"override":true,"selected_lang":""}}),
        json!({"theme":{"file":"","font":[1]}}),
        json!({"rmvpe_high_register":{"enabled":true,"mode":"fold","f0_ceil":2001}}),
        json!({"realtime":[]}),
    ] {
        let (status, response) = fixture.send(put("/api/settings", body)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{response}");
        assert_eq!(response["error"], "Invalid settings");
        assert!(response["details"]["fieldErrors"]
            .as_object()
            .is_some_and(|fields| !fields.is_empty()));
    }
    assert_eq!(
        std::fs::read(fixture.engine.runtime.config_dir.join("config.json")).unwrap(),
        before
    );
    assert!(settings_routes::normalize(&json!(null)).is_err());
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn folder_changes_are_pinned_until_restart_then_migrate_before_native_jobs() {
    let fixture = Fixture::new(true);
    let old = fixture.engine.runtime.logs.clone();
    let destination = fixture._directory.path().join("new model folder");
    std::fs::create_dir_all(old.join("voice")).unwrap();
    std::fs::write(old.join("voice/voice.pth"), b"model checkpoint").unwrap();
    let (status, body) = fixture
        .send(put("/api/settings", json!({"logs_dir":destination})))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["config"]["logs_move_from"], json!(old));
    let (_, body) = fixture.send(get("/api/settings")).await;
    assert_eq!(body["logsDir"], json!(old));
    assert!(old.join("voice/voice.pth").is_file());
    assert!(!destination.join("voice/voice.pth").exists());
    fixture.engine.shutdown().await.unwrap();
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
    assert_eq!(runtime.logs, destination);
    assert!(runtime.logs_move_error.is_none());
    assert!(destination.join("voice/voice.pth").is_file());
    assert!(!old.exists());
    assert_eq!(
        runtime.require_file("logs/voice/voice.pth").unwrap(),
        destination.join("voice/voice.pth")
    );
}

#[tokio::test]
async fn invalid_folder_changes_do_not_schedule_moves_or_change_active_storage() {
    let fixture = Fixture::new(true);
    let old = fixture.engine.runtime.logs.clone();
    for destination in [
        "relative/models".to_owned(),
        old.join("nested").to_string_lossy().into_owned(),
        fixture.engine.runtime.data.to_string_lossy().into_owned(),
    ] {
        let (status, body) = fixture
            .send(put("/api/settings", json!({"logs_dir":destination})))
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
        assert!(body["error"]
            .as_str()
            .unwrap()
            .starts_with("Cannot use logs folder:"));
    }
    assert!(fixture
        .engine
        .runtime
        .config
        .load()
        .unwrap()
        .get("logs_move_from")
        .is_none());
    assert_eq!(fixture.engine.runtime.logs, old);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn preset_keys_normalize_paths_preserve_scopes_and_refuse_corrupt_files() {
    let fixture = Fixture::new(true);
    for (scope, pitch) in [("conversion", 2), ("realtime", -3)] {
        let (status,body)=fixture.send(put("/api/settings/model-presets",json!({"scope":scope,"model":"logs\\voice\\voice.pth","values":{"pitch":pitch,"autotune":false,"embedderModel":"contentvec"}}))).await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    let (_, body) = fixture.send(get("/api/settings/model-presets")).await;
    assert_eq!(
        body["presets"]["conversion:logs/voice/voice.pth"]["pitch"],
        2
    );
    assert_eq!(
        body["presets"]["realtime:logs/voice/voice.pth"]["pitch"],
        -3
    );
    let (status, _) = fixture
        .send(put(
            "/api/settings/model-presets",
            json!({"scope":"conversion","model":"voice.pth","values":{"nested":{}}}),
        ))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let file = fixture.engine.runtime.config_dir.join("model-presets.json");
    std::fs::write(&file, "corrupt presets").unwrap();
    let (status, _) = fixture
        .send(put(
            "/api/settings/model-presets",
            json!({"scope":"conversion","model":"voice.pth","values":{"pitch":1}}),
        ))
        .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
    assert_eq!(std::fs::read_to_string(file).unwrap(), "corrupt presets");
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn parallel_preset_updates_do_not_lose_other_models() {
    let fixture = Fixture::new(true);
    let mut tasks = tokio::task::JoinSet::new();
    for id in 0..16 {
        let app = fixture.app.clone();
        tasks.spawn(async move{use tower::ServiceExt;app.oneshot(put("/api/settings/model-presets",json!({"scope":"conversion","model":format!("voice{id}.pth"),"values":{"pitch":id}}))).await.unwrap().status()});
    }
    while let Some(status) = tasks.join_next().await {
        assert_eq!(status.unwrap(), StatusCode::OK);
    }
    let (_, body) = fixture.send(get("/api/settings/model-presets")).await;
    assert_eq!(body["presets"].as_object().unwrap().len(), 16);
    fixture.engine.shutdown().await.unwrap();
}

fn translations(fixture: &Fixture) {
    let dir = fixture.engine.runtime.code.join("assets/i18n/languages");
    std::fs::create_dir_all(&dir).unwrap();
    for (name, label) in [
        ("en_US", "Settings"),
        ("fr_FR", "Paramètres"),
        ("es_ES", "Ajustes"),
    ] {
        std::fs::write(
            dir.join(format!("{name}.json")),
            json!({"Settings":label}).to_string(),
        )
        .unwrap();
    }
}
#[tokio::test]
async fn language_negotiation_respects_user_override_and_first_setup_browser_locale() {
    let fixture = Fixture::new(true);
    translations(&fixture);
    fixture
        .engine
        .runtime
        .config
        .update(json!({"lang":{"override":true,"selected_lang":"fr_FR"}}))
        .unwrap();
    let (_, body) = fixture
        .send(get("/api/settings/language?clientLang=es-MX"))
        .await;
    assert_eq!(body["code"], "fr_FR");
    assert_eq!(body["dict"]["Settings"], "Paramètres");
    fixture
        .engine
        .runtime
        .config
        .update(json!({"lang":{"override":false}}))
        .unwrap();
    let (_, body) = fixture
        .send(get("/api/settings/language?clientLang=es-MX"))
        .await;
    assert_eq!(body["code"], "es_ES");
    assert_eq!(body["dict"]["Settings"], "Ajustes");
    let (_, body) = fixture.send(get("/api/settings/languages")).await;
    assert_eq!(body["languages"], json!(["en_US", "es_ES", "fr_FR"]));
    assert_eq!(body["named"][2]["name"], "Français");
    fixture.engine.shutdown().await.unwrap();
    let fixture = Fixture::new(false);
    translations(&fixture);
    fixture
        .engine
        .runtime
        .config
        .update(json!({"lang":{"override":true,"selected_lang":"fr_FR"}}))
        .unwrap();
    let (_, body) = fixture
        .send(
            Request::get("/api/settings/language")
                .header("accept-language", "es-MX,es;q=0.9,en;q=0.8")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(body["code"], "es_ES");
    assert_eq!(
        fixture.engine.runtime.config.load().unwrap()["lang"]["override"],
        false
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn temporary_storage_counts_and_cleanup_keep_user_audio_models_and_separation_stems() {
    let fixture = Fixture::new(true);
    let runtime = &fixture.engine.runtime;
    for name in ["one.wav", "two.txt"] {
        std::fs::write(runtime.uploads.join(name), b"123").unwrap();
    }
    for name in [
        "web_output_one.wav",
        "tts_output_one.wav",
        "user-recording.wav",
    ] {
        std::fs::write(runtime.outputs.join(name), b"1234").unwrap();
    }
    std::fs::create_dir_all(runtime.outputs.join("uvr_stems")).unwrap();
    std::fs::write(runtime.outputs.join("uvr_stems/vocals.wav"), b"stems").unwrap();
    let (_, body) = fixture.send(get("/api/settings/storage")).await;
    assert_eq!(body["stats"]["uploadsCount"], 2);
    assert_eq!(body["stats"]["outputsCount"], 2);
    assert_eq!(body["stats"]["totalBytes"], 14);
    let (_, body) = fixture
        .request("/api/settings/storage/clean", json!({"maxAgeMs":3600000}))
        .await;
    assert_eq!(body["result"]["deletedFiles"], 0);
    let (_, body) = fixture
        .request("/api/settings/storage/clean", json!({"cleanUploads":false}))
        .await;
    assert_eq!(body["result"]["deletedFiles"], 2);
    assert_eq!(body["result"]["freedBytes"], 8);
    assert!(runtime.uploads.join("one.wav").is_file());
    let (_, body) = fixture
        .request("/api/settings/storage/clean", json!({}))
        .await;
    assert_eq!(body["result"]["deletedFiles"], 2);
    assert_eq!(body["result"]["freedBytes"], 6);
    assert!(runtime.outputs.join("user-recording.wav").is_file());
    assert!(runtime.outputs.join("uvr_stems/vocals.wav").is_file());
    assert!(runtime.data.join("voice.pth").is_file());
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn cleanup_does_not_remove_active_job_inputs_or_new_outputs() {
    let fixture = Fixture::new(true);
    let runtime = &fixture.engine.runtime;
    let input = runtime.uploads.join("active.wav");
    let output = runtime.outputs.join("web_output_active.wav");
    std::fs::write(&input, b"input").unwrap();
    std::fs::write(&output, b"output").unwrap();
    let job = fixture
        .engine
        .jobs
        .create(crate::jobs::JobType::Inference, json!({"inputPath":input}))
        .unwrap();
    fixture.engine.jobs.running(&job.id);
    let (_, body) = fixture
        .request("/api/settings/storage/clean", json!({}))
        .await;
    assert_eq!(body["result"]["deletedFiles"], 0);
    assert!(input.is_file());
    assert!(output.is_file());
    fixture.engine.jobs.done(&job.id, json!({}), None);
    let (_, body) = fixture
        .request("/api/settings/storage/clean", json!({}))
        .await;
    assert_eq!(body["result"]["deletedFiles"], 2);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn cleanup_preserves_files_still_being_received_by_a_multipart_request() {
    use tower::ServiceExt;
    let fixture = Fixture::new(true);
    let (sender, mut receiver) =
        tokio::sync::mpsc::channel::<Result<axum::body::Bytes, std::io::Error>>(1);
    let body = Body::from_stream(
        async_stream::stream! {while let Some(chunk)=receiver.recv().await{yield chunk;}},
    );
    let app = fixture.app.clone();
    let request = Request::post("/api/inference")
        .header("content-type", "multipart/form-data; boundary=pending")
        .body(body)
        .unwrap();
    let task = tokio::spawn(async move { app.oneshot(request).await.unwrap() });
    sender.send(Ok(axum::body::Bytes::from_static(b"--pending\r\nContent-Disposition: form-data; name=\"pthPath\"\r\n\r\nvoice.pth\r\n--pending\r\nContent-Disposition: form-data; name=\"audio\"; filename=\"pending.wav\"\r\nContent-Type: audio/wav\r\n\r\naudio data"))).await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if std::fs::read_dir(&fixture.engine.runtime.uploads)
                .unwrap()
                .next()
                .is_some()
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let (status, body) = fixture
        .request("/api/settings/storage/clean", json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["result"]["deletedFiles"], 0);
    assert_eq!(
        std::fs::read_dir(&fixture.engine.runtime.uploads)
            .unwrap()
            .count(),
        1
    );
    sender
        .send(Ok(axum::body::Bytes::from_static(b"\r\n--pending--\r\n")))
        .await
        .unwrap();
    drop(sender);
    let response = task.await.unwrap();
    assert_eq!(response.status(), StatusCode::ACCEPTED);
    use http_body_util::BodyExt;
    let body: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    let job = fixture.finish(body["jobId"].as_str().unwrap()).await;
    assert_eq!(job.status, crate::jobs::JobStatus::Done, "{:?}", job.error);
    fixture.engine.shutdown().await.unwrap();
}

#[cfg(windows)]
#[tokio::test]
async fn cleanup_preserves_active_old_inputs_with_different_windows_path_casing() {
    let fixture = Fixture::new(true);
    let input = fixture.engine.runtime.uploads.join("Reusable.WAV");
    std::fs::write(&input, b"audio").unwrap();
    let file = std::fs::OpenOptions::new()
        .write(true)
        .open(&input)
        .unwrap();
    file.set_times(
        std::fs::FileTimes::new()
            .set_modified(std::time::SystemTime::UNIX_EPOCH + std::time::Duration::from_secs(3600)),
    )
    .unwrap();
    drop(file);
    let job = fixture
        .engine
        .jobs
        .create(
            crate::jobs::JobType::Inference,
            json!({"inputPath":input.to_string_lossy().to_uppercase()}),
        )
        .unwrap();
    fixture.engine.jobs.running(&job.id);
    let (_, body) = fixture
        .request("/api/settings/storage/clean", json!({}))
        .await;
    assert_eq!(body["result"]["deletedFiles"], 0);
    assert!(input.is_file());
    fixture.engine.jobs.done(&job.id, json!({}), None);
    let (_, body) = fixture
        .request("/api/settings/storage/clean", json!({}))
        .await;
    assert_eq!(body["result"]["deletedFiles"], 1);
    assert!(!input.exists());
    fixture.engine.shutdown().await.unwrap();
}
