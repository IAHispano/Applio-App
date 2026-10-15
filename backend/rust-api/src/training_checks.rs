use crate::{
    jobs::JobStatus,
    processing_checks::{multipart, Fixture},
    training_artifacts as artifacts, training_params as params,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::{path::Path, time::Duration};
use tower::ServiceExt;
fn training_fixture(ready: bool) -> Fixture {
    let fixture = Fixture::new(ready);
    for script in [
        "rvc/train/preprocess/preprocess.py",
        "rvc/train/extract/extract.py",
        "rvc/train/train.py",
        "rvc/train/process/extract_index.py",
        "rvc/lib/tools/prerequisites_download.py",
    ] {
        let file = fixture.engine.runtime.backend.join(script);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(file, PYTHON).unwrap();
    }
    std::fs::write(fixture.engine.runtime.code.join("torch.py"), TORCH).unwrap();
    std::fs::write(
        fixture.engine.runtime.backend.join("rvc/configs/config.py"),
        "def get_gpu_info():return 'Fixture GPUs'\ndef get_number_of_gpus():return 2\n",
    )
    .unwrap();
    let dataset = fixture.engine.runtime.data.join("assets/datasets/input");
    std::fs::create_dir_all(&dataset).unwrap();
    std::fs::write(dataset.join("audio.wav"), b"audio").unwrap();
    fixture
}
fn get(path: &str) -> Request<Body> {
    Request::get(path).body(Body::empty()).unwrap()
}
fn args(name: &str) -> Value {
    json!({"modelName":name,"datasetPath":"assets/datasets/input","pretrained":false,"totalEpoch":4,"indexAlgorithm":"Skip","cpuCores":2})
}

#[test]
fn training_parameters_and_all_stage_arguments_match_the_original_node_contract() {
    let cases: Vec<Value> = serde_json::from_str(include_str!("training-reference.json")).unwrap();
    for mut case in cases {
        let kind = case["kind"].as_str().unwrap().to_owned();
        match params::normalize(&kind, &case["input"]) {
            Ok(p) => {
                if case["input"].get("cpuCores").is_none()
                    && case["params"].get("cpuCores").is_some()
                {
                    case["params"]["cpuCores"] = json!(params::cores());
                    if let Some(args) = case
                        .get_mut("args")
                        .and_then(|args| args.get_mut("preprocess"))
                        .and_then(Value::as_array_mut)
                    {
                        args[4] = json!(params::cores().to_string());
                    }
                    if let Some(args) = case
                        .get_mut("args")
                        .and_then(|args| args.get_mut("extract"))
                        .and_then(Value::as_array_mut)
                    {
                        args[3] = json!(params::cores().to_string());
                    }
                }
                assert_eq!(p, case["params"], "{kind}");
                let mut actual = json!({});
                if case["args"].get("preprocess").is_some() {
                    actual["preprocess"] = json!(params::preprocess(&p, Path::new("/logs")));
                }
                if case["args"].get("extract").is_some() {
                    actual["extract"] = json!(params::extract(&p, Path::new("/logs")));
                }
                if case["args"].get("index").is_some() {
                    actual["index"] = json!(params::index(&p, Path::new("/logs")));
                }
                if case["args"].get("train").is_some() {
                    let pretrained = if p["pretrained"] == true {
                        ["/pretrained/G.pth".into(), "/pretrained/D.pth".into()]
                    } else {
                        [String::new(), String::new()]
                    };
                    actual["train"] = json!(params::train(&p, &pretrained));
                }
                for args in actual.as_object_mut().unwrap().values_mut() {
                    for arg in args.as_array_mut().unwrap() {
                        if let Some(text) = arg.as_str() {
                            *arg = json!(text.replace('\\', "/"));
                        }
                    }
                }
                assert_eq!(actual, case["args"], "{kind}");
            }
            Err(error) => assert_eq!(
                json!(error.field_errors.keys().collect::<Vec<_>>()),
                case["fields"],
                "{kind}: {error}"
            ),
        }
    }
}

#[tokio::test]
async fn native_pipeline_runs_all_stages_in_one_gpu_job_and_exports_a_fresh_model() {
    let fixture = training_fixture(true);
    let mut p = args("voice");
    p["indexAlgorithm"] = json!("Auto");
    let id = fixture.start("/api/train/pipeline", p).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(
        job.output_file.as_deref(),
        Some("logs/voice/voice_4e_40s.pth")
    );
    assert_eq!(
        job.result.unwrap()["message"],
        "Model voice trained successfully!"
    );
    assert_eq!(job.progress, None);
    assert_eq!(fixture.engine.jobs.list().len(), 1);
    assert!(!fixture.engine.scheduler.gpu_busy());
    let order =
        std::fs::read_to_string(fixture.engine.runtime.data.join("training-order")).unwrap();
    assert_eq!(
        order.lines().collect::<Vec<_>>(),
        vec![
            "preprocess voice",
            "extract voice",
            "train voice",
            "index voice"
        ]
    );
    assert!(fixture
        .engine
        .runtime
        .logs
        .join("voice/voice.index")
        .is_file());
    let response = fixture
        .app
        .clone()
        .oneshot(get(
            "/api/train/export-file?file=logs%2Fvoice%2Fvoice_4e_40s.pth",
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers()["content-disposition"]
        .to_str()
        .unwrap()
        .starts_with("attachment;"));
    assert_eq!(
        response.into_body().collect().await.unwrap().to_bytes(),
        "inference export"
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn training_pipeline_uses_custom_logs_for_every_stage_and_public_export_aliases() {
    let mut fixture = training_fixture(true);
    fixture.engine.shutdown().await.unwrap();
    let logs = fixture._directory.path().join("external models");
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
    let readiness =
        std::sync::Arc::new(crate::engine::RuntimeReadiness::new(runtime.clone(), true));
    fixture.engine = crate::engine::NativeEngine::open(runtime, readiness).unwrap();
    fixture.app = crate::native::router(config, fixture.engine.clone());
    let id = fixture.start("/api/train/pipeline", args("custom")).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(
        job.output_file.as_deref(),
        Some("logs/custom/custom_4e_40s.pth")
    );
    assert!(logs.join("custom/custom_4e_40s.pth").is_file());
    let prep: Value = serde_json::from_slice(
        &std::fs::read(fixture.engine.runtime.data.join("preprocess-args.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(prep[0], json!(logs.join("custom")));
    let (status, _) = fixture
        .send(get(
            "/api/train/export-file?file=logs%2Fcustom%2Fcustom_4e_40s.pth",
        ))
        .await;
    assert_eq!(status, StatusCode::OK);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn individual_training_steps_and_existing_indexes_keep_legacy_messages() {
    let fixture = training_fixture(true);
    for (route, message) in [
        ("preprocess", "Model voice preprocessed successfully."),
        ("extract", "Model voice extracted successfully."),
        ("train", "Model voice trained successfully."),
        ("index", "Index file for voice is ready."),
    ] {
        let mut p = args("voice");
        if route == "index" {
            p["indexAlgorithm"] = json!("Auto");
        }
        let id = fixture.start(&format!("/api/train/{route}"), p).await;
        let job = fixture.finish(&id).await;
        assert_eq!(job.status, JobStatus::Done, "{route}: {:?}", job.error);
        assert_eq!(job.result.unwrap()["message"], message);
    }
    let id = fixture
        .start("/api/train/index", json!({"modelName":"voice"}))
        .await;
    assert_eq!(fixture.finish(&id).await.status, JobStatus::Done);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn training_downloads_missing_defaults_and_validates_nonempty_custom_pretrains() {
    let fixture = training_fixture(true);
    let mut p = args("default");
    p["pretrained"] = json!(true);
    let id = fixture.start("/api/train/train", p.clone()).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    let order =
        std::fs::read_to_string(fixture.engine.runtime.data.join("training-order")).unwrap();
    assert_eq!(
        order.lines().collect::<Vec<_>>(),
        vec!["pretrains HiFi-GAN", "train default"]
    );
    let cli: Value = serde_json::from_slice(
        &std::fs::read(fixture.engine.runtime.data.join("train-args.json")).unwrap(),
    )
    .unwrap();
    assert!(cli[3].as_str().unwrap().ends_with("f0G40k.pth"));
    assert!(cli[4].as_str().unwrap().ends_with("f0D40k.pth"));
    p["modelName"] = json!("custom");
    p["customPretrained"] = json!(true);
    p["gPretrainedPath"] = json!("voice.pth");
    p["dPretrainedPath"] = json!("empty.pth");
    std::fs::write(fixture.engine.runtime.data.join("empty.pth"), b"").unwrap();
    let id = fixture.start("/api/train/train", p.clone()).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Error);
    assert!(job.error.unwrap().contains("non-empty"));
    std::fs::write(fixture.engine.runtime.data.join("empty.pth"), b"pretrain").unwrap();
    let id = fixture.start("/api/train/train", p).await;
    assert_eq!(fixture.finish(&id).await.status, JobStatus::Done);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn successful_exit_without_markers_models_or_indexes_is_not_a_successful_job() {
    let fixture = training_fixture(true);
    for (route, name) in [
        ("preprocess", "missing-marker"),
        ("pipeline", "fail-preprocess"),
        ("train", "no-export"),
        ("train", "checkpoint-only"),
        ("train", "empty"),
        ("train", "old-epoch"),
        ("index", "no-index"),
    ] {
        let mut p = args(name);
        if route == "index" {
            p["indexAlgorithm"] = json!("Auto");
        }
        let id = fixture.start(&format!("/api/train/{route}"), p).await;
        let job = fixture.finish(&id).await;
        assert_eq!(job.status, JobStatus::Error, "{route} {name}");
        assert!(job.output_file.is_none());
        assert!(job.error.is_some());
    }
    let directory = fixture.engine.runtime.logs.join("stale");
    std::fs::create_dir_all(&directory).unwrap();
    std::fs::write(directory.join("stale_4e_40s.pth"), b"stale export").unwrap();
    let id = fixture.start("/api/train/train", args("stale")).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Error);
    assert!(job
        .error
        .unwrap()
        .contains("did not save a new voice model"));
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn stop_by_model_cancels_native_process_tree_and_preserves_monotonic_progress() {
    let fixture = training_fixture(true);
    let id = fixture.start("/api/train/train", args("slow")).await;
    fixture.stage(&id, "training fixture waiting").await;
    assert_eq!(fixture.engine.jobs.get(&id).unwrap().progress, Some(38));
    let queued = fixture
        .start(
            "/api/inference",
            json!({"pthPath":"voice.pth","inputPath":"input.wav"}),
        )
        .await;
    fixture.stage(&queued, "Waiting for the GPU").await;
    let (status, body) = fixture
        .request("/api/train/stop", json!({"modelName":"slow"}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["killed"], 1);
    assert_eq!(fixture.finish(&queued).await.status, JobStatus::Done);
    assert_eq!(fixture.finish(&id).await.status, JobStatus::Error);
    let file = fixture.engine.runtime.data.join("training-heartbeat");
    let first = std::fs::read_to_string(&file).unwrap();
    tokio::time::sleep(Duration::from_millis(120)).await;
    assert_eq!(std::fs::read_to_string(file).unwrap(), first);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn skipped_index_does_not_interrupt_a_running_conversion_worker() {
    let fixture = training_fixture(true);
    let id = fixture
        .start(
            "/api/tts",
            json!({"pthPath":"voice.pth","ttsText":"__slow__","ttsVoice":"fixture"}),
        )
        .await;
    fixture.stage(&id, "fixture waiting").await;
    let pid = fixture.engine.worker.pid();
    let skipped = fixture.start("/api/train/index", args("voice")).await;
    let job = fixture.finish(&skipped).await;
    assert_eq!(job.status, JobStatus::Done);
    assert_eq!(job.result.unwrap()["message"], "Index generation skipped.");
    assert_eq!(fixture.engine.worker.pid(), pid);
    assert_eq!(
        fixture.engine.jobs.get(&id).unwrap().status,
        JobStatus::Running
    );
    fixture.engine.jobs.cancel(&id, "Stopped by user");
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn training_validates_rates_model_paths_readiness_and_custom_pretrain_requests() {
    let fixture = training_fixture(true);
    for p in [
        json!({"modelName":"../escape","pretrained":false}),
        json!({"modelName":"voice","sampleRate":"44100"}),
        json!({"modelName":"voice","customPretrained":true}),
        json!({"modelName":"voice","vocoder":"RefineGAN","sampleRate":"48000"}),
    ] {
        let (status, _) = fixture.request("/api/train/train", p).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
    }
    assert!(fixture.engine.jobs.list().is_empty());
    let (status, _) = fixture.request("/api/train/stop", json!({})).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, body) = fixture
        .request("/api/train/stop", json!({"modelName":"stale-pids"}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["killed"], 0);
    fixture.engine.shutdown().await.unwrap();
    let fixture = training_fixture(false);
    let (status, _) = fixture.request("/api/train/train", args("voice")).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn streaming_dataset_pretrain_and_embedder_uploads_preserve_listing_contracts() {
    let fixture = training_fixture(true);
    let names: Vec<_> = (0..120).map(|id| format!("part{id}.wav")).collect();
    let files: Vec<_> = names
        .iter()
        .map(|name| ("files", name.as_str(), "audio"))
        .collect();
    let (status, body) = fixture
        .send(multipart(
            "/api/train/upload-dataset",
            &[("datasetName", "../uploaded")],
            &files,
        ))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["dataset"], "assets/datasets/uploaded");
    assert_eq!(body["files"], 120);
    let (status, body) = fixture
        .send(multipart(
            "/api/train/upload-pretrained",
            &[],
            &[("file", "G_custom.pth", "pretrain")],
        ))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["file"], "rvc/models/pretraineds/custom/G_custom.pth");
    let (status, body) = fixture
        .send(multipart(
            "/api/train/upload-embedder",
            &[("folderName", "embedder")],
            &[
                ("bin", "pytorch_model.bin", "weights"),
                ("config", "config.json", "{}"),
            ],
        ))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["folder"], "embedder");
    let (_, body) = fixture.send(get("/api/train/datasets")).await;
    assert!(body["datasets"]
        .as_array()
        .unwrap()
        .contains(&json!("assets/datasets/uploaded")));
    let (_, body) = fixture.send(get("/api/train/pretraineds")).await;
    assert_eq!(
        body["g"],
        json!(["rvc/models/pretraineds/custom/G_custom.pth"])
    );
    assert_eq!(body["d"], json!([]));
    let (_, body) = fixture.send(get("/api/train/embedders")).await;
    assert_eq!(body["embedders"], json!(["embedder"]));
    assert_eq!(
        std::fs::read_dir(&fixture.engine.runtime.uploads)
            .unwrap()
            .count(),
        0
    );
    for request in [
        multipart(
            "/api/train/upload-dataset",
            &[("datasetName", "..")],
            &[("files", "audio.wav", "audio")],
        ),
        multipart(
            "/api/train/upload-embedder",
            &[("folderName", "bad")],
            &[("bin", "weights.bin", "weights")],
        ),
        multipart(
            "/api/train/upload-pretrained",
            &[],
            &[("file", "weights.exe", "weights")],
        ),
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
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn gpu_probe_is_cached_and_artifact_downloads_reject_files_outside_logs() {
    let fixture = training_fixture(true);
    for _ in 0..2 {
        let (status, body) = fixture.send(get("/api/train/gpus")).await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(body["count"], 2);
        assert_eq!(body["devices"][0]["mem"], 8);
        assert_eq!(body["gpus"].as_array().unwrap().len(), 4);
    }
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("gpu-probes"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    let (status, _) = fixture
        .send(get("/api/train/export-file?file=voice.pth"))
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, _) = fixture
        .send(get("/api/train/export-file?file=logs%2Fmissing.pth"))
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    fixture.engine.shutdown().await.unwrap();
}

#[test]
fn fresh_artifact_selection_ignores_old_exports_checkpoints_empty_and_short_runs() {
    let root = tempfile::tempdir().unwrap();
    let dir = root.path();
    std::fs::write(dir.join("voice_99e_999s.pth"), b"stale").unwrap();
    let before = artifacts::snapshot(dir).unwrap();
    for name in [
        "G_200.pth",
        "D_200.pth",
        "voice.pth",
        "voice_1e_10s.pth",
        "voice_4e_40s.pth",
        "voice_4e_41s.pth",
        "voice_5e_1s.pth",
    ] {
        std::fs::write(dir.join(name), b"new artifact").unwrap();
    }
    std::fs::write(dir.join("voice_100e_9999s.pth"), b"").unwrap();
    assert_eq!(
        artifacts::trained(dir, "voice", &before, 4).unwrap(),
        dir.join("voice_5e_1s.pth")
    );
    assert!(artifacts::index(dir, "voice").is_err());
    std::fs::write(dir.join("voice.index"), b"index").unwrap();
    assert_eq!(
        artifacts::index(dir, "voice").unwrap(),
        dir.join("voice.index")
    );
}

#[test]
fn unicode_download_headers_preserve_the_original_name_and_cannot_inject_headers() {
    let header = crate::uploads::attachment(std::ffi::OsStr::new("voix 🎵.pth"));
    let value = header.to_str().unwrap();
    assert!(value.contains("filename*=UTF-8''voix%20%F0%9F%8E%B5.pth"));
    let header = crate::uploads::attachment(std::ffi::OsStr::new("bad\r\nname\".pth"));
    let value = header.to_str().unwrap();
    assert!(!value.contains(['\r', '\n']));
    assert!(value.contains("%0D%0A"));
}

const TORCH: &str = r#"
from pathlib import Path
with open('gpu-probes','a') as f:f.write('probe\n')
class Props: total_memory=8*1024**3
class Cuda:
 def is_available(self):return True
 def device_count(self):return 2
 def get_device_name(self,i):return 'Fixture GPU '+str(i)
 def get_device_properties(self,i):return Props()
cuda=Cuda()
"#;
const PYTHON: &str = r#"
import sys,json,os,time,subprocess
from pathlib import Path
data=Path(os.environ['APPLIO_ROOT']);logs=Path(os.environ['APPLIO_LOGS_DIR'])
if len(sys.argv)>1 and sys.argv[1]=='--child':
    while True:
        Path(sys.argv[2]).write_text(str(time.monotonic()));time.sleep(0.02)
def order(stage,name):
    with open(data/'training-order','a') as f:f.write(stage+' '+name+'\n')
mode=Path(__file__).name
if mode=='prerequisites_download.py':
    vocoder=sys.argv[sys.argv.index('--vocoder')+1];rate=int(sys.argv[sys.argv.index('--sample-rate')+1]);order('pretrains',vocoder)
    directory=data/'rvc/models/pretraineds'/vocoder.lower();directory.mkdir(parents=True,exist_ok=True)
    for side in ['G','D']:(directory/f'f0{side}{rate//1000}k.pth').write_bytes(b'pretrained')
    print('Prerequisites installed successfully.');sys.exit(0)
if mode=='train.py':name=sys.argv[1];directory=logs/name;stage='train'
else:directory=Path(sys.argv[1]);name=directory.name;stage={'preprocess.py':'preprocess','extract.py':'extract','extract_index.py':'index'}[mode]
directory.mkdir(parents=True,exist_ok=True);order(stage,name);(data/(stage+'-args.json')).write_text(json.dumps(sys.argv[1:]))
if name=='fail-preprocess' and stage=='preprocess':print('fixture preprocess failed',file=sys.stderr);sys.exit(2)
if stage=='preprocess':
    assert Path(sys.argv[2]).is_absolute() and Path(sys.argv[2]).is_dir()
    if name=='missing-marker':print('Preprocess did not finish');sys.exit(0)
    print(f'Model {name} preprocessed successfully.')
elif stage=='extract':print(f'Model {name} extracted successfully.')
elif stage=='index':
    if name=='no-index':sys.exit(0)
    if (directory/(name+'.index')).exists():sys.exit(0)
    (directory/(name+'.index')).write_bytes(b'index')
elif stage=='train':
    print(f'{name} | epoch=2 | batch=2/4',flush=True);print(f'{name} | epoch=1 | batch=0/4',flush=True)
    if name=='slow':
        heartbeat=data/'training-heartbeat';subprocess.Popen([sys.executable,__file__,'--child',str(heartbeat)])
        while not heartbeat.exists():time.sleep(0.005)
        print('training fixture waiting',flush=True);time.sleep(60)
    epochs=int(sys.argv[3]);file=directory/f'{name}_{epochs}e_40s.pth'
    if name=='checkpoint-only':(directory/'G_40.pth').write_bytes(b'checkpoint')
    elif name=='old-epoch':(directory/f'{name}_1e_10s.pth').write_bytes(b'old epoch')
    elif name=='empty':file.write_bytes(b'')
    elif name not in ['no-export','stale']:file.write_bytes(b'inference export')
    print(f'Model {name} trained successfully.')
"#;
