//! Executes the complete installer against isolated native fixture executables.
//! No system packages are installed, and no network access is needed.
use crate::{
    engine::{EngineOptions, NativeEngine, RuntimeReadiness},
    process::{CommandSpec, ManagedProcess},
    processing_checks::Fixture,
    ApiConfig,
};
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use serde_json::json;
use std::{sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;

async fn fixture() -> Fixture {
    let mut fixture = Fixture::new(true);
    fixture.engine.shutdown().await.unwrap();
    let root = &fixture.engine.runtime.data;
    let source = root.join("setup-fixture.rs");
    std::fs::write(&source, PROGRAM).unwrap();
    let binary = root.join(if cfg!(windows) {
        "setup-fixture.exe"
    } else {
        "setup-fixture"
    });
    let compile = CommandSpec::new("rustc", root).args(vec![
        source.into_os_string(),
        "-o".into(),
        binary.as_os_str().to_owned(),
    ]);
    let output = tokio::time::timeout(
        Duration::from_secs(60),
        ManagedProcess::run(&compile, &CancellationToken::new(), |_, _| {}),
    )
    .await
    .unwrap()
    .unwrap();
    output.ensure_success().unwrap();
    let bin = root.join("fixture-bin");
    std::fs::create_dir(&bin).unwrap();
    let extension = if cfg!(windows) { ".exe" } else { "" };
    for name in ["python", "nvidia-smi", "powershell", "reg", "ffmpeg"] {
        std::fs::copy(&binary, bin.join(format!("{name}{extension}"))).unwrap();
    }
    let tools = root.join("fixture-tools");
    std::fs::create_dir(&tools).unwrap();
    std::fs::copy(&binary, tools.join(format!("uv{extension}"))).unwrap();
    if cfg!(windows) {
        let locator = root.join("ProgramFiles/Microsoft Visual Studio/Installer");
        std::fs::create_dir_all(&locator).unwrap();
        std::fs::copy(&binary, locator.join("vswhere.exe")).unwrap();
        let tools = root.join("fake-msvc/VC/Tools/MSVC/14.50.0");
        std::fs::create_dir_all(tools.join("bin/Hostx64/x64")).unwrap();
        std::fs::write(tools.join("bin/Hostx64/x64/cl.exe"), b"fixture").unwrap();
        std::fs::create_dir(tools.join("include")).unwrap();
    }
    let venv = root.join(".venv");
    let scripts = venv.join(if cfg!(windows) { "Scripts" } else { "bin" });
    std::fs::create_dir_all(&scripts).unwrap();
    let python = scripts.join(format!("python{extension}"));
    std::fs::copy(&binary, &python).unwrap();
    std::fs::write(
        venv.join("pyvenv.cfg"),
        format!("home = {}\n", bin.display()),
    )
    .unwrap();
    let code = &fixture.engine.runtime.code;
    std::fs::create_dir_all(code.join("frontend/web")).unwrap();
    std::fs::write(code.join("frontend/web/package.json"), "{}").unwrap();
    std::fs::write(code.join("requirements.txt"),"torch==2.11.0\ntorchaudio==2.11.0\ntorchvision>=0.23.0\nonnxruntime>=1.17; sys_platform != 'win32'\nonnxruntime-gpu==1.22.0; sys_platform == 'win32'\n").unwrap();
    let config = ApiConfig {
        code_root: code.clone(),
        data_root: root.clone(),
        config_dir: fixture.engine.runtime.config_dir.clone(),
    };
    let mut runtime =
        crate::engine_runtime::EngineRuntime::with_python(&config, Some(python)).unwrap();
    let mut paths = vec![bin.clone()];
    paths.extend(std::env::split_paths(
        &std::env::var_os("PATH").unwrap_or_default(),
    ));
    runtime
        .environment
        .insert("PATH".into(), std::env::join_paths(paths).unwrap());
    runtime
        .environment
        .insert("UV_INSTALL_DIR".into(), tools.into_os_string());
    runtime
        .environment
        .insert("APPLIO_TORCH_CUDA".into(), "cu126".into());
    runtime.environment.insert(
        "ProgramFiles(x86)".into(),
        root.join("ProgramFiles").into_os_string(),
    );
    fixture.engine = NativeEngine::open_with_options(
        runtime.clone(),
        Arc::new(RuntimeReadiness::new(runtime, true)),
        EngineOptions::default(),
    )
    .unwrap();
    fixture.app = crate::native::router(config, fixture.engine.clone());
    fixture
}

#[tokio::test]
async fn native_setup_installs_in_order_deduplicates_requests_verifies_and_requests_a_fresh_generation(
) {
    let fixture = fixture().await;
    let id = fixture.start("/api/setup/install", json!({})).await;
    let duplicate = fixture.start("/api/setup/install", json!({})).await;
    assert_eq!(id, duplicate);
    let job = fixture.finish(&id).await;
    assert_eq!(
        job.status,
        crate::jobs::JobStatus::Done,
        "{:?}\n{:?}",
        job.error,
        job.logs
    );
    assert_eq!(job.result.unwrap()["ready"], true);
    let requirements = std::fs::read_to_string(
        fixture
            .engine
            .runtime
            .data
            .join(".requirements-resolved.txt"),
    )
    .unwrap();
    assert!(requirements.contains("torch==2.7.1"));
    assert!(requirements.contains("torchaudio==2.7.1"));
    assert!(crate::setup_routes::missing_pretrains(&fixture.engine).is_empty());
    let log = std::fs::read_to_string(fixture.engine.runtime.data.join("setup-commands")).unwrap();
    assert!(log.contains("unsafe-best-match"));
    assert!(log.contains("https://download.pytorch.org/whl/cu126"));
    assert!(log.contains("torchvision==0.22.1"));
    assert!(log.contains("--pretraineds-hifigan"));
    assert!(!log.contains("uv-install"));
    assert!(!log.contains("winget"));
    let (status, body) = fixture
        .send(
            Request::get("/api/setup/status?refresh=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["ready"], true, "{body}");
    tokio::time::timeout(
        Duration::from_secs(2),
        fixture.engine.restart_token().cancelled(),
    )
    .await
    .unwrap();
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn cancelling_setup_terminates_the_installer_before_admitting_queued_gpu_work() {
    let fixture = fixture().await;
    std::fs::write(fixture.engine.runtime.data.join("slow-setup"), "yes").unwrap();
    let id = fixture.start("/api/setup/install", json!({})).await;
    fixture.stage(&id, "fixture installer waiting").await;
    let engine = fixture.engine.clone();
    let next = engine
        .start_job(
            crate::jobs::JobType::Other,
            json!({"next":true}),
            Some(crate::scheduler::Resource::Gpu),
            |_, _, _| async {
                Ok(crate::engine::JobResult::new(
                    json!({"admitted":true}),
                    None,
                ))
            },
        )
        .await
        .unwrap();
    let (status, _) = fixture
        .request(&format!("/api/jobs/{id}/stop"), json!({}))
        .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        fixture.finish(&next.id).await.status,
        crate::jobs::JobStatus::Done
    );
    assert_eq!(
        fixture.engine.jobs.get(&id).unwrap().status,
        crate::jobs::JobStatus::Error
    );
    assert!(!fixture.engine.restart_token().is_cancelled());
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn prerequisites_download_is_native_and_status_cache_can_be_refreshed() {
    let fixture = fixture().await;
    let (status, before) = fixture
        .send(
            Request::get("/api/setup/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{before}");
    assert_eq!(before["ready"], false);
    let id = fixture.start("/api/setup/prerequisites", json!({})).await;
    assert_eq!(
        fixture.finish(&id).await.status,
        crate::jobs::JobStatus::Done
    );
    let (status, after) = fixture
        .send(
            Request::get("/api/setup/status")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert_eq!(status, StatusCode::OK, "{after}");
    assert_eq!(after["ready"], true, "{after}");
    fixture.engine.shutdown().await.unwrap();
}
#[tokio::test]
async fn native_setup_creates_a_missing_venv_and_rejects_a_successful_process_without_required_artifacts(
) {
    let fixture = fixture().await;
    let venv = fixture.engine.runtime.data.join(".venv");
    std::fs::remove_dir_all(&venv).unwrap();
    std::fs::write(fixture.engine.runtime.data.join("missing-pretrains"), "yes").unwrap();
    let id = fixture.start("/api/setup/install", json!({})).await;
    let job = fixture.finish(&id).await;
    assert_eq!(job.status, crate::jobs::JobStatus::Error, "{:?}", job.logs);
    assert!(job.error.unwrap().contains("required checks still fail"));
    assert!(venv.join("pyvenv.cfg").is_file());
    assert!(!fixture.engine.restart_token().is_cancelled());
    let log = std::fs::read_to_string(fixture.engine.runtime.data.join("setup-commands")).unwrap();
    assert!(log.contains("--seed"));
    assert!(log.contains("--clear"));
    fixture.engine.shutdown().await.unwrap();
}
#[cfg(windows)]
#[tokio::test]
async fn amd_setup_selects_native_rocm_packages_and_removes_legacy_cuda_conflicts() {
    let mut fixture = fixture().await;
    fixture.engine.shutdown().await.unwrap();
    let mut runtime = fixture.engine.runtime.clone();
    runtime
        .environment
        .insert("APPLIO_ROCM_GFX".into(), "gfx1151".into());
    let config = ApiConfig {
        code_root: runtime.code.clone(),
        data_root: runtime.data.clone(),
        config_dir: runtime.config_dir.clone(),
    };
    fixture.engine = NativeEngine::open_with_options(
        runtime.clone(),
        Arc::new(RuntimeReadiness::new(runtime, true)),
        EngineOptions::default(),
    )
    .unwrap();
    fixture.app = crate::native::router(config, fixture.engine.clone());
    let id = fixture.start("/api/setup/install", json!({})).await;
    let job = fixture.finish(&id).await;
    assert_eq!(
        job.status,
        crate::jobs::JobStatus::Done,
        "{:?}\n{:?}",
        job.error,
        job.logs
    );
    let log = std::fs::read_to_string(fixture.engine.runtime.data.join("setup-commands")).unwrap();
    assert!(log.contains("torch[device-gfx1151]"));
    assert!(log.contains("amd-torchvision-device-gfx1151"));
    assert!(log.contains("onnxruntime-gpu"));
    let requirements = std::fs::read_to_string(
        fixture
            .engine
            .runtime
            .data
            .join(".requirements-resolved.txt"),
    )
    .unwrap();
    assert!(!requirements.contains("torch=="));
    assert!(!requirements.contains("onnxruntime-gpu"));
    let marker: serde_json::Value = serde_json::from_slice(
        &std::fs::read(fixture.engine.runtime.data.join(".venv/.rocm-installed")).unwrap(),
    )
    .unwrap();
    assert_eq!(marker["gfxTarget"], "gfx1151");
    fixture.engine.shutdown().await.unwrap();
}
#[test]
fn rebuilding_a_virtualenv_requires_a_real_owned_directory() {
    let directory = tempfile::tempdir().unwrap();
    let data = directory.path();
    let venv = data.join(".venv");
    assert!(crate::setup_install::validate_venv_rebuild(data, &venv).is_ok());
    std::fs::create_dir(&venv).unwrap();
    std::fs::write(venv.join("user-file"), b"preserve").unwrap();
    assert!(crate::setup_install::validate_venv_rebuild(data, &venv).is_err());
    assert_eq!(std::fs::read(venv.join("user-file")).unwrap(), b"preserve");
    std::fs::write(venv.join("pyvenv.cfg"), "home = fixture").unwrap();
    assert!(crate::setup_install::validate_venv_rebuild(data, &venv).is_ok());
}

#[cfg(windows)]
#[tokio::test]
async fn mixed_gpu_setup_repairs_stale_rocm_and_installs_cuda() {
    let fixture = fixture().await;
    let data = &fixture.engine.runtime.data;
    std::fs::write(data.join("mixed-gpus"), "").unwrap();
    let library = data.join(".venv/Lib/site-packages/torch/lib");
    std::fs::create_dir_all(&library).unwrap();
    for marker in [
        data.join(".venv/.rocm-installed"),
        library.join(".rocm-installed"),
    ] {
        std::fs::write(marker, r#"{"gfxTarget":"gfx1150"}"#).unwrap();
    }
    let id = fixture.start("/api/setup/install", json!({})).await;
    let job = fixture.finish(&id).await;
    assert_eq!(
        job.status,
        crate::jobs::JobStatus::Done,
        "{:?}\n{:?}",
        job.error,
        job.logs
    );
    let log = std::fs::read_to_string(data.join("setup-commands")).unwrap();
    assert!(
        log.contains("uninstall")
            && log.contains("amd-torch-device-gfx1150")
            && log.contains("amd-torchvision-device-gfx1150"),
        "{log}"
    );
    assert!(
        log.contains("https://download.pytorch.org/whl/cu126"),
        "{log}"
    );
    assert!(!data.join(".venv/.rocm-installed").exists());
    assert!(!library.join(".rocm-installed").exists());
    let requirements = std::fs::read_to_string(data.join(".requirements-resolved.txt")).unwrap();
    assert!(requirements.contains("torch==2.7.1"));
    let (_, status) = fixture
        .send(
            Request::get("/api/setup/status?refresh=1")
                .body(Body::empty())
                .unwrap(),
        )
        .await;
    assert!(!status["checks"]
        .as_array()
        .unwrap()
        .iter()
        .any(|check| matches!(check["id"].as_str(), Some("rocm" | "msvc_tools"))));
    fixture.engine.shutdown().await.unwrap();
}

const PROGRAM: &str = r#"
use std::{env,fs,io::Write,path::PathBuf,time::Duration};
fn main(){
 let args=env::args().skip(1).collect::<Vec<_>>();
 let name=env::current_exe().unwrap().file_stem().unwrap().to_string_lossy().to_lowercase();
 if name=="vswhere"{let exe=env::current_exe().unwrap();let root=exe.parent().unwrap().parent().unwrap().parent().unwrap().parent().unwrap();println!("{}",root.join("fake-msvc").display());return;}
 let root=env::var_os("APPLIO_ROOT").map(PathBuf::from).unwrap_or_else(||env::current_dir().unwrap());
 if let Ok(mut log)=fs::OpenOptions::new().append(true).create(true).open(root.join("setup-commands")){writeln!(log,"{name}: {args:?}").unwrap();}
 if name=="powershell" {if root.join("mixed-gpus").is_file(){println!("[{{\"Name\":\"AMD Radeon 890M\"}},{{\"Name\":\"NVIDIA RTX 4060 Laptop GPU\"}}]");}else{println!("[]");}return;}
 if name=="reg" {println!("Installed REG_DWORD 0x1");return;}
 if name=="nvidia-smi" {if args.iter().any(|a|a.contains("query-gpu")){println!("NVIDIA RTX 3060, 8.6");}else{println!("CUDA Version: 12.6");}return;}
 if name=="ffmpeg" {println!("ffmpeg version fixture");return;}
 if name=="uv" {
  if args==["--version"]{println!("uv fixture");return;}
  if args.first().map(String::as_str)==Some("venv"){
   let target=PathBuf::from(&args[1]);let bin=target.join(if cfg!(windows){"Scripts"}else{"bin"});fs::create_dir_all(&bin).unwrap();let name=if cfg!(windows){"python.exe"}else{"python"};fs::copy(env::current_exe().unwrap(),bin.join(name)).unwrap();fs::write(target.join("pyvenv.cfg"),format!("home = {}\n",root.join("fixture-bin").display())).unwrap();println!("fixture virtualenv created");return;
  }
  if args.iter().any(|a|a=="install"){
   if root.join("slow-setup").is_file(){println!("fixture installer waiting");std::io::stdout().flush().unwrap();std::thread::sleep(Duration::from_secs(60));}
   std::thread::sleep(Duration::from_millis(100));println!("installed fixture dependencies");return;
  }
  panic!("Unexpected uv command: {args:?}");
 }
 if args==["--version"]{println!("Python 3.12.12");return;}
 if args.first().map(String::as_str)==Some("-c"){
  if args[1].contains("distributions()"){if root.join("mixed-gpus").is_file(){println!("APPLIO_JSON:[\"amd-torch-device-gfx1150\",\"amd-torchvision-device-gfx1150\"]");}else{println!("APPLIO_JSON:[]");}}else{println!("OK|2.7.1");}return;
 }
 if args.first().is_some_and(|arg|arg.ends_with("prerequisites_download.py")){
  if root.join("missing-pretrains").is_file(){println!("fixture exits successfully without required pretrains");return;}
  for (vocoder,rates) in [("hifi-gan",&[32,40,48][..]),("refinegan",&[24,32][..])]{for rate in rates {for side in ["G","D"]{
   let file=root.join(format!("rvc/models/pretraineds/{vocoder}/f0{side}{rate}k.pth"));fs::create_dir_all(file.parent().unwrap()).unwrap();fs::write(file,b"fixture model").unwrap();
  }}}
  println!("Prerequisites installed successfully.");return;
 }
 if args.first().map(String::as_str)==Some("-m")&&args.get(1).map(String::as_str)==Some("pip"){println!("fixture pip complete");return;}
 panic!("Unexpected fixture command {name}: {args:?}");
}
"#;
