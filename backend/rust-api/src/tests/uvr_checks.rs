use crate::{
    jobs::JobStatus,
    processing_checks::{multipart, Fixture},
    uvr_routes,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::path::Path;
use tower::ServiceExt;

#[test]
fn separator_parameters_and_cli_match_the_legacy_node_reference() {
    let cases: Vec<Value> =
        serde_json::from_str(include_str!("fixtures/uvr-reference.json")).unwrap();
    for case in cases {
        match uvr_routes::normalize(&case["input"]) {
            Ok(params) => {
                assert_eq!(params, case["params"]);
                assert_eq!(
                    json!(uvr_routes::cli_args(
                        &params,
                        Path::new("/input.wav"),
                        Path::new("/output")
                    )),
                    case["args"]
                );
            }
            Err(errors) => {
                assert!(case.get("fields").is_some(), "{errors:?}");
                assert_eq!(
                    json!(errors.field_errors.keys().collect::<Vec<_>>()),
                    case["fields"]
                );
            }
        }
    }
}

#[tokio::test]
async fn separator_catalog_is_live_cached_and_preserves_stem_labels() {
    let fixture = Fixture::new(true);
    for _ in 0..2 {
        let (status, body) = fixture
            .send(Request::get("/api/uvr/models").body(Body::empty()).unwrap())
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
        assert_eq!(
            body["models"],
            json!([{"filename":"fixture.pth","name":"Fixture","type":"VR","stems":["Vocals","Instrumental"],"target_stem":"Vocals"}])
        );
    }
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("catalog-count"))
            .unwrap()
            .lines()
            .count(),
        1
    );
    std::fs::write(
        fixture.engine.runtime.code.join("uvr/models.py"),
        "changed fixture registry",
    )
    .unwrap();
    let (status, _) = fixture
        .send(Request::get("/api/uvr/models").body(Body::empty()).unwrap())
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("catalog-count"))
            .unwrap()
            .lines()
            .count(),
        2
    );
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn native_separation_prepares_dependencies_and_serves_each_stem() {
    let fixture = Fixture::new(true);
    let (status, body) = fixture
        .send(multipart(
            "/api/uvr/separate",
            &[
                ("model", "fixture"),
                ("outputFormat", "FLAC"),
                ("singleStem", "all"),
                ("demucsSplit", "false"),
                ("vrTta", "yes"),
            ],
            &[("audio", "input.wav", "audio fixture")],
        ))
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let job = fixture.finish(body["jobId"].as_str().unwrap()).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(job.progress, Some(100));
    assert!(job.output_file.is_none());
    let result = job.result.unwrap();
    assert_eq!(result["message"], "Separated 2 stems with fixture.");
    let stems = result["stems"].as_array().unwrap();
    assert_eq!(stems.len(), 2);
    for stem in stems {
        assert!(stem["file"].as_str().unwrap().ends_with(".flac"));
        let response = fixture
            .app
            .clone()
            .oneshot(
                Request::get(stem["url"].as_str().unwrap())
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.into_body().collect().await.unwrap().to_bytes(),
            "fixture stem"
        );
    }
    assert_eq!(
        std::fs::read_to_string(fixture.engine.runtime.data.join("uvr-order"))
            .unwrap()
            .lines()
            .collect::<Vec<_>>(),
        vec!["install", "separate"]
    );
    let args: Value = serde_json::from_slice(
        &std::fs::read(fixture.engine.runtime.data.join("uvr-args.json")).unwrap(),
    )
    .unwrap();
    let args = args.as_array().unwrap();
    assert!(args.contains(&json!("--demucs-no-split")));
    assert!(args.contains(&json!("--vr-tta")));
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn separator_rejects_invalid_parameters_and_cleans_staged_uploads() {
    let fixture = Fixture::new(true);
    let (status, body) = fixture
        .send(multipart(
            "/api/uvr/separate",
            &[("model", "fixture"), ("vrBatch", "99")],
            &[("audio", "input.wav", "audio")],
        ))
        .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body["details"]["fieldErrors"].get("vrBatch").is_some());
    assert_eq!(
        std::fs::read_dir(&fixture.engine.runtime.uploads)
            .unwrap()
            .count(),
        0
    );
    assert!(fixture.engine.jobs.list().is_empty());
    for model in ["empty", "escape", "failure"] {
        let id = fixture
            .start(
                "/api/uvr/separate",
                json!({"model":model,"inputPath":"input.wav"}),
            )
            .await;
        let job = fixture.finish(&id).await;
        assert_eq!(job.status, JobStatus::Error, "model={model}");
        assert!(job.output_file.is_none());
        assert!(fixture.engine.runtime.data.join("voice.pth").is_file());
    }
    std::fs::write(fixture.engine.runtime.data.join("uvr-install-fail"), "yes").unwrap();
    let id = fixture
        .start(
            "/api/uvr/separate",
            json!({"model":"fixture","inputPath":"input.wav"}),
        )
        .await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Error);
    assert!(job.error.unwrap().contains("fixture installer failed"));
    fixture.engine.shutdown().await.unwrap();
}

#[tokio::test]
async fn cancelling_separation_terminates_python_before_admitting_voice_conversion() {
    let fixture = Fixture::new(true);
    let id = fixture
        .start(
            "/api/uvr/separate",
            json!({"model":"slow","inputPath":"input.wav"}),
        )
        .await;
    fixture.stage(&id, "separator waiting").await;
    let queued = fixture
        .start(
            "/api/inference",
            json!({"pthPath":"voice.pth","inputPath":"input.wav"}),
        )
        .await;
    fixture.stage(&queued, "Waiting for the GPU").await;
    let (status, _) = fixture
        .request(&format!("/api/jobs/{id}/stop"), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(fixture.finish(&id).await.status, JobStatus::Error);
    assert_eq!(fixture.finish(&queued).await.status, JobStatus::Done);
    fixture.engine.shutdown().await.unwrap();
}

pub(crate) const PYTHON: &str = r#"
import sys,json,time,os
from pathlib import Path
def flag(name): return sys.argv[sys.argv.index(name)+1]
def order(stage):
    with open('uvr-order','a') as f:f.write(stage+'\n')
if Path(__file__).name=='install.py':
    order('install')
    if Path('uvr-install-fail').exists(): print('fixture installer failed',file=sys.stderr);sys.exit(2)
    print('setup fixture complete');sys.exit(0)
if '--list-models' in sys.argv:
    with open('catalog-count','a') as f:f.write('catalog\n')
    print('warning prefix APPLIO_JSON:'+json.dumps({'models':[{'filename':'fixture.pth','label':'Fixture','arch':'vr','stems':['vocals','instrumental'],'target':'vocals'}]}));sys.exit(0)
order('separate')
Path('uvr-args.json').write_text(json.dumps(sys.argv[1:]))
model=flag('--model'); assert Path(flag('--input-path')).is_file()
if model=='failure':print('fixture separation failed',file=sys.stderr);sys.exit(2)
if model=='slow':print('separator waiting',flush=True);time.sleep(60)
print(' 10%|#',flush=True);print(' 80%|########',flush=True);print(' 30%|###',flush=True)
directory=Path(flag('--output-dir'));stems={}
if model=='escape':stems={'Vocals':'voice.pth'}
elif model!='empty':
    for label in ['Vocals','Instrumental']:
        file=directory/('fixture '+label+'.'+flag('--output-format'));file.write_bytes(b'fixture stem')
        stems[label]=os.path.relpath(file,os.environ['APPLIO_ROOT']).replace('\\','/')
print('progress prefix APPLIO_JSON:'+json.dumps({'stems':stems}))
"#;
