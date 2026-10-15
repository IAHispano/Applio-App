use crate::{jobs::JobStatus, process::ManagedProcess, processing_checks::Fixture};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use tokio_util::sync::CancellationToken;

async fn archive(fixture: &Fixture, members: serde_json::Value) -> Vec<u8> {
    let path = fixture.engine.runtime.data.join("fixture.zip");
    let script = "import sys,json,zipfile\nwith zipfile.ZipFile(sys.argv[1],'w') as z:\n for name,value in json.loads(sys.argv[2]).items(): z.writestr(name,value)\n";
    let output = ManagedProcess::run(
        &fixture
            .engine
            .runtime
            .python_command(vec![
                "-c".into(),
                script.into(),
                path.to_string_lossy().into_owned(),
                members.to_string(),
            ])
            .unwrap(),
        &CancellationToken::new(),
        |_, _| {},
    )
    .await
    .unwrap();
    output.ensure_success().unwrap();
    std::fs::read(path).unwrap()
}
async fn install(fixture: &Fixture, name: &str, members: serde_json::Value) -> String {
    let archive = archive(fixture, members).await;
    let mut body = format!("--fixture\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/zip\r\n\r\n").into_bytes();
    body.extend(archive);
    body.extend(b"\r\n--fixture--\r\n");
    let (status, value) = fixture
        .send(
            Request::post("/api/plugins/install")
                .header("content-type", "multipart/form-data; boundary=fixture")
                .body(Body::from(body))
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{value}");
    value["jobId"].as_str().unwrap().into()
}
#[tokio::test]
async fn plugins_install_merge_list_and_toggle_without_node_or_gpu() {
    let fixture = Fixture::new(false);
    let primary = fixture
        .engine
        .runtime
        .data
        .join("plugins/installed/Fixture");
    let legacy = fixture.engine.runtime.data.join("tabs/plugins/installed");
    std::fs::create_dir_all(&primary).unwrap();
    std::fs::write(primary.join("keep.txt"), b"preserve").unwrap();
    std::fs::create_dir_all(legacy.join("Fixture")).unwrap();
    std::fs::create_dir_all(legacy.join("Old")).unwrap();
    let realtime = fixture.engine.scheduler.begin_realtime().unwrap();
    let id = install(
        &fixture,
        "Fixture.zip",
        json!({"plugin.py":"print('plugin')","nested/settings.json":"{}"}),
    )
    .await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Done, "{:?}", job.error);
    assert_eq!(
        job.result.unwrap(),
        json!({"name":"Fixture","requiresRestart":true})
    );
    assert_eq!(
        std::fs::read(primary.join("keep.txt")).unwrap(),
        b"preserve"
    );
    assert!(primary.join("nested/settings.json").is_file());
    let (status, value) = fixture
        .send(Request::get("/api/plugins").body(Body::empty()).unwrap())
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        value["plugins"],
        json!([{"name":"Fixture","enabled":true,"hasEntrypoint":true},{"name":"Old","enabled":false,"hasEntrypoint":false,"legacy":true}])
    );
    let (status, _) = fixture
        .request(
            "/api/plugins/toggle",
            json!({"name":"Fixture","enabled":false}),
        )
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        fixture.engine.runtime.config.load().unwrap()["plugins"],
        json!([])
    );
    let (status, _) = fixture
        .request(
            "/api/plugins/toggle",
            json!({"name":"absent","enabled":true}),
        )
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(
        std::fs::read_dir(&fixture.engine.runtime.uploads)
            .unwrap()
            .count(),
        0
    );
    drop(realtime);
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn unsafe_zip_fails_without_altering_an_installed_plugin_or_escaping_staging() {
    let fixture = Fixture::new(false);
    let root = fixture.engine.runtime.data.join("plugins/installed");
    std::fs::create_dir_all(root.join("Fixture")).unwrap();
    std::fs::write(root.join("Fixture/plugin.py"), b"original").unwrap();
    let id = install(
        &fixture,
        "Fixture.zip",
        json!({"plugin.py":"replacement","../escaped.txt":"escape"}),
    )
    .await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, JobStatus::Error);
    assert_eq!(
        std::fs::read(root.join("Fixture/plugin.py")).unwrap(),
        b"original"
    );
    assert!(!root.join("escaped.txt").exists());
    assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1);
    assert_eq!(
        std::fs::read_dir(&fixture.engine.runtime.uploads)
            .unwrap()
            .count(),
        0
    );
    assert_eq!(
        fixture.engine.runtime.config.load().unwrap()["plugins"],
        serde_json::Value::Null
    );
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn plugin_requirements_use_a_separate_owned_pip_job() {
    let fixture = Fixture::new(false);
    // A local module prevents this fixture from making any package changes.
    std::fs::write(
        fixture.engine.runtime.data.join("pip.py"),
        "import sys\nprint('fixture pip '+repr(sys.argv))\n",
    )
    .unwrap();
    let id = install(
        &fixture,
        "Dependencies.zip",
        json!({"plugin.py":"","requirements.txt":"fixture-only"}),
    )
    .await;
    assert_eq!(fixture.finish(&id).await.status, JobStatus::Done);
    let dependency = fixture
        .engine
        .jobs
        .list()
        .into_iter()
        .find(|job| {
            job.params
                .as_ref()
                .is_some_and(|params| params["step"] == "pip-install")
        })
        .unwrap();
    let dependency = fixture.finish(&dependency.id).await;
    assert_eq!(dependency.status, JobStatus::Done, "{:?}", dependency.error);
    assert!(dependency
        .logs
        .iter()
        .any(|line| line.contains("fixture pip")));
    fixture.engine.shutdown().await.unwrap();
}

#[test]
fn interrupted_plugin_publication_recovers_without_losing_the_previous_install() {
    for published in [false, true] {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        let staging = format!(".applio-install-{}", uuid::Uuid::new_v4());
        let backup = format!(".applio-install-{}", uuid::Uuid::new_v4());
        std::fs::create_dir(root.join(&backup)).unwrap();
        std::fs::write(root.join(&backup).join("plugin.py"), b"old").unwrap();
        let new = if published { "Fixture" } else { &staging };
        std::fs::create_dir(root.join(new)).unwrap();
        std::fs::write(root.join(new).join("plugin.py"), b"new").unwrap();
        std::fs::write(
            root.join(".applio-install.json"),
            json!({"folder":"Fixture","staging":staging,"backup":backup}).to_string(),
        )
        .unwrap();
        crate::plugin_routes::recover(root).unwrap();
        assert_eq!(
            std::fs::read(root.join("Fixture/plugin.py")).unwrap(),
            if published { b"new" } else { b"old" }
        );
        assert_eq!(std::fs::read_dir(root).unwrap().count(), 1);
        crate::plugin_routes::recover(root).unwrap();
    }
}
