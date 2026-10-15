use crate::{jobs::JobStatus, processing_checks::Fixture};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tower::ServiceExt;
fn fixture() -> Fixture {
    let fixture = Fixture::new(true);
    std::fs::write(
        fixture.engine.runtime.code.join("tools/dataset_quality.py"),
        PYTHON,
    )
    .unwrap();
    let directory = fixture.engine.runtime.data.join("assets/datasets/source");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("one.wav"), b"0123456789").unwrap();
    fixture
}
async fn scan(fixture: &Fixture, dataset: &str) -> (String, String) {
    let (status, body) = fixture
        .request(
            "/api/train/dataset-review/scan",
            json!({"datasetPath":dataset}),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    (
        body["jobId"].as_str().unwrap().into(),
        body["reviewId"].as_str().unwrap().into(),
    )
}
fn get(path: &str) -> Request<Body> {
    Request::get(path).body(Body::empty()).unwrap()
}
fn plan(include: Value) -> Value {
    json!({"include":include,"trimSilence":false,"normalize":false,"lowerPeaks":false})
}

#[tokio::test]
async fn review_scan_reports_progress_and_hides_fingerprints_from_public_reports() {
    let fixture = fixture();
    let (job, review) = scan(&fixture, "assets/datasets/source").await;
    let job = fixture.finish(&job).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(job.result.as_ref().unwrap()["reviewId"], review);
    let file = fixture
        .engine
        .runtime
        .config_dir
        .join("dataset-reviews")
        .join(format!("{review}.json"));
    let private: Value = serde_json::from_slice(&std::fs::read(file).unwrap()).unwrap();
    assert_eq!(private["clips"][0]["sourceHash"], "source hash");
    let response = fixture
        .app
        .clone()
        .oneshot(get(&format!("/api/train/dataset-review/{review}")))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "no-store");
    let public: Value =
        serde_json::from_slice(&response.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert!(public["clips"][0].get("sourceHash").is_none());
    assert!(public["clips"][0].get("pcmHash").is_none());
    let response = fixture
        .app
        .clone()
        .oneshot(
            Request::get(format!(
                "/api/train/dataset-review/{review}/audio/{}",
                "a".repeat(24)
            ))
            .header("range", "bytes=1-3")
            .body(Body::empty())
            .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::PARTIAL_CONTENT);
    assert_eq!(response.headers()["cache-control"], "no-store");
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        "123"
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn prepare_uses_a_private_plan_creates_a_separate_copy_and_cleans_only_owned_staging() {
    let fixture = fixture();
    let (job, review) = scan(&fixture, "assets/datasets/source").await;
    assert_eq!(fixture.finish(&job).await.status, JobStatus::Done);
    let curated = fixture.engine.runtime.data.join("assets/curated-datasets");
    std::fs::create_dir_all(curated.join(".applio-review-unrelated-keep")).unwrap();
    let id = fixture
        .start(
            &format!("/api/train/dataset-review/{review}/prepare"),
            plan(json!(["a".repeat(24)])),
        )
        .await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    let result = job.result.unwrap();
    assert_eq!(result["reviewId"], review);
    assert_eq!(result["files"], 1);
    let destination = std::path::PathBuf::from(result["datasetPath"].as_str().unwrap());
    assert!(destination.starts_with(&curated));
    assert_eq!(
        std::fs::read(destination.join("one.wav")).unwrap(),
        b"0123456789"
    );
    assert_eq!(
        std::fs::read(
            fixture
                .engine
                .runtime
                .data
                .join("assets/datasets/source/one.wav")
        )
        .unwrap(),
        b"0123456789"
    );
    assert!(curated.join(".applio-review-unrelated-keep").is_dir());
    assert!(
        std::fs::read_dir(fixture.engine.runtime.config_dir.join("dataset-reviews"))
            .unwrap()
            .all(|entry| !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .ends_with(".plan.json"))
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn review_validation_rejects_invalid_plans_report_paths_and_audio_traversal() {
    let fixture = fixture();
    let (job, review) = scan(&fixture, "assets/datasets/source").await;
    fixture.finish(&job).await;
    for include in [
        json!([]),
        json!(["a".repeat(24), "a".repeat(24)]),
        json!(["b".repeat(24)]),
        json!(["../outside"]),
    ] {
        let (status, _) = fixture
            .request(
                &format!("/api/train/dataset-review/{review}/prepare"),
                plan(include),
            )
            .await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    let (status, _) = fixture
        .send(get("/api/train/dataset-review/not-a-review"))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let file = fixture
        .engine
        .runtime
        .config_dir
        .join("dataset-reviews")
        .join(format!("{review}.json"));
    let mut report: Value = serde_json::from_slice(&std::fs::read(&file).unwrap()).unwrap();
    report["clips"][0]["path"] = json!("../../../voice.pth");
    std::fs::write(&file, report.to_string()).unwrap();
    let (status, _) = fixture
        .send(get(&format!(
            "/api/train/dataset-review/{review}/audio/{}",
            "a".repeat(24)
        )))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let (status, _) = fixture
        .request(
            "/api/train/dataset-review/scan",
            json!({"datasetPath":"assets/datasets/source","silenceDb":"-50"}),
        )
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn review_resource_serializes_scans_while_voice_conversion_can_continue() {
    let fixture = fixture();
    let slow = fixture.engine.runtime.data.join("assets/datasets/slow");
    std::fs::create_dir_all(&slow).unwrap();
    let (first, _) = scan(&fixture, "assets/datasets/slow").await;
    fixture.stage(&first, "review waiting").await;
    assert_eq!(fixture.engine.jobs.get(&first).unwrap().progress, Some(50));
    let (second, _) = scan(&fixture, "assets/datasets/source").await;
    fixture.stage(&second, "current dataset review").await;
    let conversion = fixture
        .start(
            "/api/inference",
            json!({"pthPath":"voice.pth","inputPath":"input.wav"}),
        )
        .await;
    assert_eq!(fixture.finish(&conversion).await.status, JobStatus::Done);
    fixture.engine.jobs.cancel(&first, "Stopped by user");
    assert_eq!(fixture.finish(&second).await.status, JobStatus::Done);
    assert_eq!(fixture.finish(&first).await.status, JobStatus::Error);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn cancelling_prepare_removes_its_plan_and_python_staging_before_admitting_next_review() {
    let fixture = fixture();
    let (job, review) = scan(&fixture, "assets/datasets/source").await;
    fixture.finish(&job).await;
    std::fs::write(fixture.engine.runtime.data.join("slow-prepare"), "yes").unwrap();
    let id = fixture
        .start(
            &format!("/api/train/dataset-review/{review}/prepare"),
            plan(json!(["a".repeat(24)])),
        )
        .await;
    fixture.stage(&id, "prepare waiting").await;
    fixture.engine.jobs.cancel(&id, "Stopped by user");
    let (next, _) = scan(&fixture, "assets/datasets/source").await;
    assert_eq!(fixture.finish(&next).await.status, JobStatus::Done);
    let dir = fixture.engine.runtime.config_dir.join("dataset-reviews");
    assert!(std::fs::read_dir(dir).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .ends_with(".plan.json")));
    let dir = fixture.engine.runtime.data.join("assets/curated-datasets");
    assert!(std::fs::read_dir(dir).unwrap().all(|entry| !entry
        .unwrap()
        .file_name()
        .to_string_lossy()
        .starts_with(".applio-review-")));
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn large_scan_result_is_not_lost_to_the_bounded_stdout_tail() {
    let fixture = fixture();
    let directory = fixture.engine.runtime.data.join("assets/datasets/large");
    std::fs::create_dir_all(directory).unwrap();
    let (job, _) = scan(&fixture, "assets/datasets/large").await;
    let job = fixture.finish(&job).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(
        job.result.unwrap()["padding"].as_str().unwrap().len(),
        4_200_000
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
#[ignore = "Requires APPLIO_ENGINE_TEST_PYTHON pointing to the installed Python voice environment"]
async fn real_python_scan_and_prepare_preserve_source_audio() {
    let mut fixture = Fixture::new(true);
    fixture.engine.shutdown().await.unwrap();
    let python = std::env::var_os("APPLIO_ENGINE_TEST_PYTHON")
        .expect("Set APPLIO_ENGINE_TEST_PYTHON to the voice environment's Python executable");
    let config = crate::ApiConfig {
        code_root: fixture.engine.runtime.code.clone(),
        data_root: fixture.engine.runtime.data.clone(),
        config_dir: fixture.engine.runtime.config_dir.clone(),
    };
    std::fs::copy(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tools/dataset_quality.py"),
        config.code_root.join("tools/dataset_quality.py"),
    )
    .unwrap();
    let runtime =
        crate::engine_runtime::EngineRuntime::with_python(&config, Some(python.into())).unwrap();
    let readiness =
        std::sync::Arc::new(crate::engine::RuntimeReadiness::new(runtime.clone(), true));
    fixture.engine = crate::engine::NativeEngine::open(runtime, readiness).unwrap();
    fixture.app = crate::native::router(config, fixture.engine.clone());
    let directory = fixture.engine.runtime.data.join("assets/datasets/audio");
    std::fs::create_dir_all(&directory).unwrap();
    let audio = wav();
    std::fs::write(directory.join("one.wav"), &audio).unwrap();
    std::fs::write(directory.join("duplicate.wav"), &audio).unwrap();
    let (job, review) = scan(&fixture, "assets/datasets/audio").await;
    let job = fixture.finish(&job).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(job.result.unwrap()["summary"]["files"], 2);
    let (status, report) = fixture
        .send(get(&format!("/api/train/dataset-review/{review}")))
        .await;
    assert_eq!(status, StatusCode::OK);
    let clip = &report["clips"][0];
    assert!(clip.get("sourceHash").is_none());
    assert_eq!(report["summary"]["duplicate"], 1);
    let id = fixture
        .start(
            &format!("/api/train/dataset-review/{review}/prepare"),
            plan(json!([clip["id"]])),
        )
        .await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    let result = job.result.unwrap();
    let output = std::path::PathBuf::from(result["datasetPath"].as_str().unwrap());
    assert!(output.is_dir());
    assert_eq!(result["files"], 1);
    assert_eq!(std::fs::read(directory.join("one.wav")).unwrap(), audio);
    assert_eq!(
        std::fs::read(directory.join("duplicate.wav")).unwrap(),
        audio
    );
    assert_eq!(
        std::fs::read(output.join(clip["path"].as_str().unwrap())).unwrap(),
        audio
    );
    fixture.engine.shutdown().await.unwrap();
}
fn wav() -> Vec<u8> {
    let rate = 22050_u32;
    let mut bytes = Vec::new();
    let frames = rate / 2;
    let size = frames * 2;
    bytes.extend(b"RIFF");
    bytes.extend((36 + size).to_le_bytes());
    bytes.extend(b"WAVEfmt ");
    bytes.extend(16_u32.to_le_bytes());
    bytes.extend(1_u16.to_le_bytes());
    bytes.extend(1_u16.to_le_bytes());
    bytes.extend(rate.to_le_bytes());
    bytes.extend((rate * 2).to_le_bytes());
    bytes.extend(2_u16.to_le_bytes());
    bytes.extend(16_u16.to_le_bytes());
    bytes.extend(b"data");
    bytes.extend(size.to_le_bytes());
    for frame in 0..frames {
        let value =
            ((frame as f64 * 440.0 * std::f64::consts::TAU / rate as f64).sin() * 8000.0) as i16;
        bytes.extend(value.to_le_bytes());
    }
    bytes
}
const PYTHON: &str = r#"
import sys,json,time,os,shutil
from pathlib import Path
def flag(name):return sys.argv[sys.argv.index(name)+1]
if sys.argv[1]=='scan':
    root=Path(flag('--root'));report=Path(flag('--report'))
    print('REVIEW_PROGRESS:1/2',flush=True)
    if root.name=='slow':print('review waiting',file=sys.stderr,flush=True);time.sleep(60)
    value={'root':str(root),'clips':[{'id':'a'*24,'path':'one.wav','sourceHash':'source hash','pcmHash':'pcm hash'}],'summary':{'files':1}}
    if root.name=='large':value['padding']='x'*4200000
    report.write_text(json.dumps(value));print('REVIEW_PROGRESS:2/2',flush=True)
else:
    report=json.loads(Path(flag('--report')).read_text());plan=json.loads(Path(flag('--plan')).read_text());destination=Path(flag('--destination'))
    assert plan['include']==['a'*24] and plan['trimSilence'] is False and plan['normalize'] is False and plan['lowerPeaks'] is False
    destination.parent.mkdir(parents=True,exist_ok=True);workspace=destination.parent/('.applio-review-'+destination.name+'-fixture');workspace.mkdir();stage=workspace/'dataset';stage.mkdir()
    if Path(os.environ['APPLIO_ROOT']).joinpath('slow-prepare').exists():print('prepare waiting',file=sys.stderr,flush=True);time.sleep(60)
    shutil.copyfile(Path(report['root'])/'one.wav',stage/'one.wav');stage.rename(destination);workspace.rmdir();value={'datasetPath':str(destination),'files':1}
print('REVIEW_RESULT:'+json.dumps(value),flush=True)
"#;
