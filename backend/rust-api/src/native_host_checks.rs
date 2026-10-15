// Native host generation lifecycle checks.
use crate::{
    engine::{EngineOptions, NativeEngine, RuntimeReadiness},
    processing_checks::Fixture,
    ApiConfig,
};
use futures_util::StreamExt;
use serde_json::{json, Value};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;

async fn start(
    fixture: &Fixture,
) -> (
    String,
    CancellationToken,
    tokio::task::JoinHandle<anyhow::Result<()>>,
    Arc<Mutex<Vec<Arc<NativeEngine>>>>,
) {
    let runtime = &fixture.engine.runtime;
    let config = ApiConfig {
        code_root: runtime.code.clone(),
        data_root: runtime.data.clone(),
        config_dir: runtime.config_dir.clone(),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    let stop = CancellationToken::new();
    let stopped = stop.clone();
    let mut first = Some(fixture.engine.clone());
    let generations = Arc::new(Mutex::new(Vec::new()));
    let created = generations.clone();
    let factory_config = config.clone();
    let host = tokio::spawn(async move {
        crate::native_host::serve_with_factory(listener, config, stopped, move || {
            let engine = if let Some(engine) = first.take() {
                engine
            } else {
                let runtime = crate::engine_runtime::EngineRuntime::open(&factory_config)?;
                NativeEngine::open_with_options(
                    runtime.clone(),
                    Arc::new(RuntimeReadiness::new(runtime, true)),
                    EngineOptions::default(),
                )?
            };
            created.lock().unwrap().push(engine.clone());
            Ok(engine)
        })
        .await
    });
    tokio::time::timeout(Duration::from_secs(5), async {
        while generations.lock().unwrap().is_empty() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    (base, stop, host, generations)
}
fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(8))
        .build()
        .unwrap()
}
#[tokio::test]
async fn restart_drains_sse_stops_work_preserves_history_and_never_releases_the_listening_port() {
    let fixture = Fixture::new(true);
    let (base, stop, host, generations) = start(&fixture).await;
    let client = client();
    let response = client
        .get(format!("{base}/api/jobs/events"))
        .send()
        .await
        .unwrap();
    let mut events = response.bytes_stream();
    assert!(events.next().await.unwrap().unwrap().starts_with(b"data:"));
    let old_job = fixture
        .start(
            "/api/tts",
            json!({"pthPath":"voice.pth","ttsText":"__slow__","ttsVoice":"en-US-Fixture"}),
        )
        .await;
    fixture.stage(&old_job, "fixture waiting").await;
    let address = base
        .trim_start_matches("http://")
        .parse::<std::net::SocketAddr>()
        .unwrap();
    let monitor_done = CancellationToken::new();
    let done = monitor_done.clone();
    let monitor = tokio::spawn(async move {
        while !done.is_cancelled() {
            assert!(
                std::net::TcpListener::bind(address).is_err(),
                "API port was unreserved between generations"
            );
            tokio::time::sleep(Duration::from_millis(2)).await;
        }
    });
    let reply: Value = client
        .post(format!("{base}/api/settings/restart"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(reply["ok"], true);
    tokio::time::timeout(Duration::from_secs(3), async {
        while generations.lock().unwrap().len() < 2 {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(fixture.engine.is_stopped());
    assert!(fixture.engine.worker.pid().is_none());
    assert!(fixture
        .engine
        .jobs
        .create(crate::jobs::JobType::Other, json!({}))
        .is_err());
    tokio::time::timeout(Duration::from_secs(2), async {
        while let Some(chunk) = events.next().await {
            chunk.unwrap();
        }
    })
    .await
    .expect("old-generation SSE did not close");
    let job: Value = client
        .get(format!("{base}/api/jobs/{old_job}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(job["job"]["status"], "error");
    let current = generations.lock().unwrap()[1].clone();
    let new_job = current
        .jobs
        .create(crate::jobs::JobType::Other, json!({"generation":2}))
        .unwrap();
    current.jobs.done(&new_job.id, json!({"ok":true}), None);
    current.jobs.flush().await.unwrap();
    // Retaining an old engine (as an old HTTP connection can do) must never
    // allow its delayed flush to overwrite the new generation's history.
    fixture.engine.jobs.flush().await.unwrap();
    tokio::time::sleep(Duration::from_millis(600)).await;
    let saved: Vec<Value> = serde_json::from_slice(
        &std::fs::read(current.runtime.config_dir.join("jobs.json")).unwrap(),
    )
    .unwrap();
    assert!(saved.iter().any(|job| job["id"] == new_job.id));
    monitor_done.cancel();
    monitor.await.unwrap();
    stop.cancel();
    tokio::time::timeout(Duration::from_secs(3), host)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(current.is_stopped());
}
#[tokio::test]
async fn aborting_the_host_requests_owned_engine_cleanup_even_with_a_retained_reference() {
    let fixture = Fixture::new(true);
    let (_base, _stop, host, _generations) = start(&fixture).await;
    let job = fixture
        .start(
            "/api/tts",
            json!({"pthPath":"voice.pth","ttsText":"__slow__","ttsVoice":"en-US-Fixture"}),
        )
        .await;
    fixture.stage(&job, "fixture waiting").await;
    host.abort();
    assert!(host.await.unwrap_err().is_cancelled());
    tokio::time::timeout(Duration::from_secs(3), async {
        while !fixture.engine.is_stopped() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    assert!(fixture.engine.worker.pid().is_none());
    assert!(!fixture.engine.jobs.get(&job).unwrap().active());
}
