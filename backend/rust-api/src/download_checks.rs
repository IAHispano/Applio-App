use crate::{
    download,
    jobs::JobStatus,
    processing_checks::{multipart, Fixture},
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
    routing::get,
    Router,
};
use serde_json::json;
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;

async fn server(app: Router) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (url, handle)
}
#[tokio::test]
async fn resumes_a_cancelled_transfer_with_validator_and_validates_checksum_before_publication() {
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("model.pth");
    std::fs::write(&destination, b"old model").unwrap();
    let seen = Arc::new(AtomicUsize::new(0));
    let requests = seen.clone();
    let (base, task) = server(Router::new().route(
        "/model",
        get(move |request: Request<Body>| {
            let requests = requests.clone();
            async move {
                if request.headers().contains_key("range") {
                    assert_eq!(request.headers()["range"], "bytes=3-");
                    assert_eq!(request.headers()["if-range"], "\"v1\"");
                    requests.fetch_add(1, Ordering::SeqCst);
                    axum::http::Response::builder()
                        .status(206)
                        .header("etag", "\"v1\"")
                        .header("content-range", "bytes 3-5/6")
                        .header("content-length", "3")
                        .body(Body::from("def"))
                        .unwrap()
                } else {
                    let stream = async_stream::stream! {
                        yield Ok::<_, std::io::Error>(axum::body::Bytes::from_static(b"abc"));
                        tokio::time::sleep(Duration::from_secs(5)).await;
                        yield Ok(axum::body::Bytes::from_static(b"def"));
                    };
                    axum::http::Response::builder()
                        .header("etag", "\"v1\"")
                        .header("content-length", "6")
                        .body(Body::from_stream(stream))
                        .unwrap()
                }
            }
        }),
    ))
    .await;
    let client = download::client().unwrap();
    let token = CancellationToken::new();
    let result = download::file(
        &client,
        &format!("{base}/model"),
        &destination,
        None,
        &token,
        |received, _| {
            if received == 3 {
                token.cancel();
            }
        },
        |_| panic!("cancelled transfers must not retry"),
    )
    .await;
    assert!(result.is_err());
    assert_eq!(std::fs::read(&destination).unwrap(), b"old model");
    download::file(
        &client,
        &format!("{base}/model"),
        &destination,
        Some("bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721"),
        &CancellationToken::new(),
        |_, _| {},
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(&destination).unwrap(), b"abcdef");
    assert_eq!(seen.load(Ordering::SeqCst), 1);
    assert!(!directory.path().join("model.pth.part").exists());
    assert!(!directory.path().join("model.pth.part.json").exists());
    task.abort();
}
#[tokio::test]
async fn download_rejects_corruption_and_permanent_errors_preserving_existing_file() {
    let (base, task) = server(
        Router::new()
            .route("/bad", get(|| async { "corrupt" }))
            .route("/missing", get(|| async { StatusCode::NOT_FOUND })),
    )
    .await;
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("original.pth");
    std::fs::write(&destination, b"original").unwrap();
    let mut retries = 0;
    let client = download::client().unwrap();
    let result = download::file(
        &client,
        &format!("{base}/missing"),
        &destination,
        None,
        &CancellationToken::new(),
        |_, _| {},
        |_| retries += 1,
    )
    .await;
    assert!(result.unwrap_err().to_string().contains("404"));
    assert_eq!(retries, 0);
    let result = download::file(
        &client,
        &format!("{base}/bad"),
        &destination,
        Some("bad checksum"),
        &CancellationToken::new(),
        |_, _| {},
        |_| retries += 1,
    )
    .await;
    assert!(result.unwrap_err().to_string().contains("checksum"));
    assert_eq!(retries, 3);
    assert_eq!(std::fs::read(&destination).unwrap(), b"original");
    task.abort();
}

#[tokio::test]
async fn changed_resume_validators_restart_from_zero_instead_of_appending_different_versions() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("model.pth");
    let seen = Arc::new(AtomicUsize::new(0));
    let requests = seen.clone();
    let (base, task) = server(Router::new().route(
        "/model",
        get(move |request: Request<Body>| {
            let requests = requests.clone();
            async move {
                requests.fetch_add(1, Ordering::SeqCst);
                if request.headers().contains_key("range") {
                    axum::http::Response::builder()
                        .status(206)
                        .header("etag", "\"new\"")
                        .header("content-range", "bytes 3-5/6")
                        .body(Body::from("NEW"))
                        .unwrap()
                } else {
                    axum::http::Response::builder()
                        .header("etag", "\"new\"")
                        .body(Body::from("allNEW"))
                        .unwrap()
                }
            }
        }),
    ))
    .await;
    let url = format!("{base}/model");
    std::fs::write(directory.path().join("model.pth.part"), b"old").unwrap();
    std::fs::write(
        directory.path().join("model.pth.part.json"),
        json!({"url":url,"validator":"\"old\""}).to_string(),
    )
    .unwrap();
    download::file(
        &download::client().unwrap(),
        &url,
        &path,
        None,
        &CancellationToken::new(),
        |_, _| {},
        |_| {},
    )
    .await
    .unwrap();
    assert_eq!(std::fs::read(path).unwrap(), b"allNEW");
    assert_eq!(seen.load(Ordering::SeqCst), 2);
    task.abort();
}

#[tokio::test]
async fn simultaneous_writers_and_staging_name_collisions_are_rejected_until_cancellation_completes(
) {
    let started = Arc::new(tokio::sync::Notify::new());
    let arrived = started.clone();
    let (base, task) = server(Router::new().route(
        "/slow",
        get(move || {
            let arrived = arrived.clone();
            async move {
                arrived.notify_one();
                tokio::time::sleep(Duration::from_secs(60)).await;
                "late"
            }
        }),
    ))
    .await;
    let directory = tempfile::tempdir().unwrap();
    let destination = directory.path().join("model.pth");
    let token = CancellationToken::new();
    let cancelled = token.clone();
    let target = destination.clone();
    let url = format!("{base}/slow");
    let slow_url = url.clone();
    let first = tokio::spawn(async move {
        download::file(
            &download::client().unwrap(),
            &slow_url,
            &target,
            None,
            &cancelled,
            |_, _| {},
            |_| {},
        )
        .await
    });
    tokio::time::timeout(Duration::from_secs(5), started.notified())
        .await
        .unwrap();
    let mut names = vec!["model.pth", "model.pth.part", "model.pth.part.json"];
    if cfg!(windows) {
        names.push("MODEL.PTH");
    }
    for name in names {
        let error = download::file(
            &download::client().unwrap(),
            &url,
            &directory.path().join(name),
            None,
            &CancellationToken::new(),
            |_, _| {},
            |_| {},
        )
        .await
        .unwrap_err();
        assert!(error.to_string().contains("Another download"), "{error}");
    }
    token.cancel();
    assert!(tokio::time::timeout(Duration::from_secs(2), first)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err()
        .to_string()
        .contains("Stopped"));
    assert!(!destination.exists());
    task.abort();
}
#[tokio::test]
async fn pretrained_download_is_a_native_network_job_and_catalog_reads_local_cache() {
    let fixture = Fixture::new(false);
    let (base, task) = server(
        Router::new()
            .route("/generator.pth", get(|| async { "generator" }))
            .route("/discriminator.pth", get(|| async { "discriminator" })),
    )
    .await;
    let root = fixture
        .engine
        .runtime
        .data
        .join("rvc/models/pretraineds/custom");
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(
        root.join("pretrains.json"),
        r#"{"Titan":{"32k":{"G":"path/G.pth","D":"null"}}}"#,
    )
    .unwrap();
    let (status, data) = fixture
        .send(
            Request::get("/api/download/pretraineds")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        data["models"],
        json!([{"name":"Titan","sampleRates":["32k"]}])
    );
    let id = fixture.start("/api/download/pretraineds", json!({"urlG":format!("{base}/generator.pth?download=true"),"urlD":format!("{base}/discriminator.pth")})).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(
        std::fs::read(root.join("generator.pth")).unwrap(),
        b"generator"
    );
    assert_eq!(
        std::fs::read(root.join("discriminator.pth")).unwrap(),
        b"discriminator"
    );
    assert!(fixture.engine.scheduler.status().active.is_empty());
    let (status, _) = fixture
        .request(
            "/api/download/pretraineds",
            json!({"urlG":"file:///bad.pth"}),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    task.abort();
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn unicode_model_drop_replaces_a_file_in_custom_logs_without_leaking_uploads() {
    let fixture = Fixture::new(false);
    for value in ["first", "replacement"] {
        let (status, body) = fixture
            .send(multipart(
                "/api/download/drop",
                &[],
                &[("file", "─Cafe\u{301} 音声.pth", value)],
            ))
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["file"], "Café_音声.pth");
        assert_eq!(body["modelDir"], "logs/Café_音声");
        assert_eq!(
            std::fs::read(fixture.engine.runtime.logs.join("Café_音声/Café_音声.pth")).unwrap(),
            value.as_bytes()
        );
    }
    assert_eq!(
        std::fs::read_dir(&fixture.engine.runtime.uploads)
            .unwrap()
            .count(),
        0
    );
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn python_acquisition_jobs_are_owned_and_do_not_require_gpu_or_stop_inference() {
    let fixture = Fixture::new(false);
    std::fs::create_dir_all(fixture.engine.runtime.code.join("tools/audio")).unwrap();
    std::fs::write(fixture.engine.runtime.code.join("tools/audio/youtube.py"), "import sys,json\nfrom pathlib import Path\nout=Path(sys.argv[sys.argv.index('--output-dir')+1])/'Song.wav'\nout.write_bytes(b'audio')\nprint('APPLIO_JSON:'+json.dumps({'file':str(out),'title':'Song'}))\n").unwrap();
    std::fs::write(
        fixture
            .engine
            .runtime
            .backend
            .join("rvc/lib/tools/model_download.py"),
        "print(' 45%|progress')\nprint('Model downloaded successfully.')\n",
    )
    .unwrap();
    let realtime = fixture.engine.scheduler.begin_realtime().unwrap();
    let id = fixture
        .start("/api/audio/youtube", json!({"url":"https://youtu.be/abc"}))
        .await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(job.result.unwrap()["file"], "assets/audios/Song.wav");
    let id = fixture
        .start(
            "/api/download",
            json!({"modelLink":"https://example.org/model.zip"}),
        )
        .await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(job.progress, Some(100));
    let (status, _) = fixture
        .request(
            "/api/audio/youtube",
            json!({"url":"https://notyoutube.com/watch/abc"}),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    drop(realtime);
    fixture.engine.shutdown().await.unwrap();
}
