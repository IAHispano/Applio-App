//! Supervised native environment installation. Only app-owned processes are
//! stopped; all downloads and installers belong to the cancellable setup job.
use crate::{
    download,
    engine::{JobResult, NativeEngine},
    gpu_runtime::{self, Nvidia},
    process::{CommandSpec, ManagedProcess},
    python_runtime::{self, Python},
    setup_routes,
};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio_util::sync::CancellationToken;
pub(crate) async fn run(
    engine: &NativeEngine,
    id: &str,
    spec: &CommandSpec,
    token: &CancellationToken,
    seconds: u64,
) -> Result<()> {
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(seconds),
        ManagedProcess::run(spec, token, |_, line| engine.jobs.log(id, line)),
    )
    .await??;
    output.ensure_success()
}
pub(crate) fn platform() -> &'static str {
    if cfg!(windows) {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}
fn command(
    engine: &NativeEngine,
    program: impl Into<PathBuf>,
    args: impl IntoIterator<Item = impl Into<std::ffi::OsString>>,
) -> Result<CommandSpec> {
    let mut spec = engine.runtime.python_command(Vec::<String>::new())?;
    spec.program = program.into();
    spec.args = args.into_iter().map(Into::into).collect();
    Ok(spec)
}
fn venv_python(root: &Path) -> PathBuf {
    root.join(if cfg!(windows) {
        "Scripts/python.exe"
    } else {
        "bin/python"
    })
}
pub(crate) fn validate_venv_rebuild(data: &Path, venv: &Path) -> Result<()> {
    let metadata = match std::fs::symlink_metadata(venv) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.into()),
    };
    let linked = metadata.file_type().is_symlink();
    #[cfg(windows)]
    let linked = {
        use std::os::windows::fs::MetadataExt;
        linked || metadata.file_attributes() & 0x400 != 0
    };
    let physical = std::fs::canonicalize(venv)?;
    let root = std::fs::canonicalize(data)?;
    if linked
        || !metadata.is_dir()
        || !venv.join("pyvenv.cfg").is_file()
        || physical.parent() != Some(root.as_path())
        || !physical
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case(".venv"))
    {
        bail!("The existing .venv is not an app-owned virtual environment. Move it before retrying setup.");
    }
    Ok(())
}
async fn download(
    engine: &NativeEngine,
    id: &str,
    url: &str,
    path: &Path,
    token: &CancellationToken,
) -> Result<()> {
    engine.jobs.log(id, &format!("Downloading {url}"));
    download::file(
        &download::client()?,
        url,
        path,
        None,
        token,
        |received, total| {
            if total > 0 {
                engine
                    .jobs
                    .progress(id, received as f64 / total as f64 * 100.);
            }
        },
        |attempt| {
            engine
                .jobs
                .log(id, &format!("Retrying download ({attempt}/3)…"))
        },
    )
    .await
}
async fn uv(engine: &NativeEngine, id: &str, token: &CancellationToken) -> Result<Option<PathBuf>> {
    let install_dir = engine
        .runtime
        .env("UV_INSTALL_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| engine.runtime.data.join("tools"));
    let executable = if cfg!(windows) { "uv.exe" } else { "uv" };
    let managed = install_dir.join(executable);
    let local_only = engine
        .runtime
        .env("APPLIO_LOCAL_STORAGE")
        .is_some_and(|value| value == "1");
    let mut candidates = vec![managed.clone(), engine.runtime.data.join(executable)];
    if !local_only {
        candidates.push(executable.into());
    }
    for candidate in candidates {
        if candidate.is_absolute() && !candidate.is_file() {
            continue;
        }
        if setup_routes::run_check(&command(engine, &candidate, ["--version"])?, token, 15)
            .await
            .is_ok_and(|r| r.success)
        {
            return Ok(Some(candidate));
        }
    }
    let root = engine.runtime.data.join(".applio-setup");
    tokio::fs::create_dir_all(&root).await?;
    let installer = root.join(if cfg!(windows) {
        "uv-install.ps1"
    } else {
        "uv-install.sh"
    });
    let url = if cfg!(windows) {
        "https://astral.sh/uv/install.ps1"
    } else {
        "https://astral.sh/uv/install.sh"
    };
    download(engine, id, url, &installer, token).await?;
    let mut spec = if cfg!(windows) {
        command(
            engine,
            "powershell.exe",
            vec![
                "-NoProfile".into(),
                "-NonInteractive".into(),
                "-ExecutionPolicy".into(),
                "Bypass".into(),
                "-File".into(),
                installer.into_os_string(),
            ],
        )?
    } else {
        command(engine, "sh", [installer.into_os_string()])?
    };
    spec.env.insert(
        "UV_UNMANAGED_INSTALL".into(),
        install_dir.as_os_str().to_owned(),
    );
    spec.env
        .insert("UV_INSTALL_DIR".into(), install_dir.into_os_string());
    spec.env.insert("UV_NO_MODIFY_PATH".into(), "1".into());
    match run(engine, id, &spec, token, 180).await {
        Ok(()) if managed.is_file() => Ok(Some(managed)),
        Err(error) if token.is_cancelled() => Err(error),
        result => {
            engine.jobs.log(
                id,
                &format!("uv installer note: {result:?}. Trying the Python installer fallback."),
            );
            Ok(None)
        }
    }
}
pub(crate) async fn nvidia(
    engine: &NativeEngine,
    token: &CancellationToken,
) -> (Vec<Nvidia>, Option<(u32, u32)>) {
    let query = command(
        engine,
        "nvidia-smi",
        ["--query-gpu=name,compute_cap", "--format=csv,noheader"],
    );
    let output = if let Ok(spec) = query {
        setup_routes::run_check(&spec, token, 15)
            .await
            .ok()
            .filter(|r| r.success)
    } else {
        None
    };
    let devices = output
        .map(|r| {
            r.stdout
                .lines()
                .filter_map(|line| {
                    let mut parts = line.trim().split(',');
                    let name = parts.next()?.trim();
                    if name.is_empty() {
                        return None;
                    }
                    Some(Nvidia {
                        name: name.into(),
                        compute_cap: parts
                            .next()
                            .and_then(|s| s.trim().parse().ok())
                            .unwrap_or(0.),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    let driver = if let Ok(spec) = command(engine, "nvidia-smi", Vec::<String>::new()) {
        setup_routes::run_check(&spec, token, 15)
            .await
            .ok()
            .filter(|r| r.success)
            .and_then(|r| {
                let re = regex::Regex::new(r"(?i)CUDA Version:\s*(\d+)\.(\d+)").unwrap();
                let found = re.captures(&r.stdout)?;
                Some((found[1].parse().ok()?, found[2].parse().ok()?))
            })
    } else {
        None
    };
    (devices, driver)
}
async fn bootstrap_python(
    engine: &NativeEngine,
    id: &str,
    token: &CancellationToken,
) -> Result<Python> {
    if engine
        .runtime
        .env("APPLIO_LOCAL_STORAGE")
        .is_some_and(|value| value == "1")
    {
        bail!("Could not install Python in the selected Applio folder using uv. Check the setup log and retry; no system Python was installed.");
    }
    if cfg!(windows) {
        let args = [
            "install",
            "-e",
            "--id",
            "Python.Python.3.12",
            "--scope",
            "user",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ];
        let result = run(engine, id, &command(engine, "winget", args)?, token, 600).await;
        if token.is_cancelled() {
            bail!("Stopped by user");
        }
        if let Some(python) = python_runtime::find(&engine.runtime, token).await {
            return Ok(python);
        }
        engine.jobs.log(
            id,
            &format!("winget note: {result:?}. Trying python.org installer."),
        );
        let installer = engine
            .runtime
            .data
            .join(".applio-setup/python-3.12.9-installer.exe");
        download(
            engine,
            id,
            "https://www.python.org/ftp/python/3.12.9/python-3.12.9-amd64.exe",
            &installer,
            token,
        )
        .await?;
        run(
            engine,
            id,
            &command(
                engine,
                installer,
                [
                    "/passive",
                    "InstallAllUsers=0",
                    "PrependPath=1",
                    "SimpleInstall=1",
                ],
            )?,
            token,
            600,
        )
        .await?;
    } else if cfg!(target_os = "macos") {
        run(
            engine,
            id,
            &command(engine, "brew", ["install", "python@3.12"])?,
            token,
            1800,
        )
        .await?;
    } else {
        bail!("Install Python 3.12 (for example python3-venv and python3-pip), then retry setup.");
    }
    python_runtime::find(&engine.runtime, token)
        .await
        .context("No suitable Python 3.11/3.12 found after installation")
}
async fn vcredist(engine: &NativeEngine, id: &str, token: &CancellationToken) -> Result<()> {
    if setup_routes::vc_redist(engine, token).await {
        return Ok(());
    }
    engine.jobs.log(
        id,
        "Installing Microsoft Visual C++ 2015-2022 Redistributable…",
    );
    let winget = command(
        engine,
        "winget",
        [
            "install",
            "-e",
            "--id",
            "Microsoft.VCRedist.2015+.x64",
            "--silent",
            "--accept-package-agreements",
            "--accept-source-agreements",
        ],
    )?;
    if let Err(error) = run(engine, id, &winget, token, 180).await {
        engine.jobs.log(id, &format!("winget VC++ note: {error}"));
    }
    if token.is_cancelled() {
        bail!("Stopped by user");
    }
    if setup_routes::vc_redist(engine, token).await {
        return Ok(());
    }
    let installer = engine.runtime.data.join(".applio-setup/VC_redist.x64.exe");
    download(
        engine,
        id,
        "https://aka.ms/vs/17/release/vc_redist.x64.exe",
        &installer,
        token,
    )
    .await?;
    let result = run(
        engine,
        id,
        &command(engine, installer, ["/quiet", "/norestart"])?,
        token,
        180,
    )
    .await;
    if !setup_routes::vc_redist(engine, token).await {
        result?;
        bail!("Microsoft Visual C++ Redistributable is still missing. Install it and retry setup.");
    }
    Ok(())
}
fn clear_legacy(engine: &NativeEngine, venv: &Path, id: &str) -> Result<()> {
    let root = std::fs::canonicalize(&engine.runtime.data)?;
    let legacy = engine.runtime.data.join("zluda");
    if legacy.exists() {
        if std::fs::canonicalize(&legacy)?.starts_with(&root)
            && !std::fs::symlink_metadata(&legacy)?.file_type().is_symlink()
        {
            std::fs::remove_dir_all(&legacy)?;
        } else {
            engine.jobs.log(
                id,
                "Legacy ZLUDA link was left in place; it is outside the app runtime.",
            );
        }
    }
    for path in [
        engine.runtime.data.join("zluda.zip"),
        venv.join("Lib/site-packages/torch/lib/.zluda-patched"),
        venv.join("Lib/site-packages/torch/lib/.zluda-compiled"),
    ] {
        if path.is_file() {
            std::fs::remove_file(path)?;
        }
    }
    Ok(())
}
async fn amd(
    engine: &NativeEngine,
    id: &str,
    python: &Python,
    uv: Option<&Path>,
    hardware: &gpu_runtime::Hardware,
    token: &CancellationToken,
) -> Result<()> {
    let venv = engine.runtime.data.join(".venv");
    clear_legacy(engine, &venv, id)?;
    let explicit = engine
        .runtime
        .env("APPLIO_ROCM_GFX")
        .map(|value| value.to_string_lossy().into_owned());
    let hsa = engine
        .runtime
        .env("HSA_OVERRIDE_GFX_VERSION")
        .map(|value| value.to_string_lossy().into_owned());
    let target = gpu_runtime::amd_target(hardware, explicit.as_deref(), hsa.as_deref());
    let index = std::env::var("APPLIO_ROCM_INDEX_URL")
        .unwrap_or_else(|_| "https://stable.repo.amd.com/rocm/whl-next/".into());
    engine.jobs.log(
        id,
        &format!("Configuring native AMD ROCm for {target} from {index}"),
    );
    let packages = vec![
        "-m".into(),
        "pip".into(),
        "uninstall".into(),
        "-y".into(),
        "torch".into(),
        "torchaudio".into(),
        "torchvision".into(),
        format!("amd-torchvision-device-{target}"),
        "onnxruntime-gpu".into(),
        "nvidia-cublas-cu12".into(),
        "nvidia-cuda-runtime-cu12".into(),
        "nvidia-cudnn-cu12".into(),
        "nvidia-cufft-cu12".into(),
    ];
    if let Err(error) = run(
        engine,
        id,
        &python.command(&engine.runtime, packages)?,
        token,
        600,
    )
    .await
    {
        if token.is_cancelled() {
            return Err(error);
        }
        engine
            .jobs
            .log(id, &format!("ROCm uninstall note: {error}"));
    }
    let package = format!("torch[device-{target}]");
    let installed = if let Some(uv) = uv {
        run(
            engine,
            id,
            &command(
                engine,
                uv,
                vec![
                    "pip".into(),
                    "install".into(),
                    "--python".into(),
                    python.cmd[0].clone(),
                    "--index-url".into(),
                    index.clone(),
                    package.clone(),
                    "torchaudio".into(),
                ],
            )?,
            token,
            7200,
        )
        .await
        .is_ok()
    } else {
        false
    };
    if token.is_cancelled() {
        bail!("Stopped by user");
    }
    if !installed {
        run(
            engine,
            id,
            &python.command(
                &engine.runtime,
                vec![
                    "-m".into(),
                    "pip".into(),
                    "install".into(),
                    "--no-cache-dir".into(),
                    "--index-url".into(),
                    index.clone(),
                    package,
                    "torchaudio".into(),
                ],
            )?,
            token,
            7200,
        )
        .await?;
    }
    let marker =
        json!({"gfxTarget":target,"indexUrl":index,"installedAt":crate::jobs::timestamp()});
    crate::storage::atomic_json(&venv.join(".rocm-installed"), &marker)?;
    let library = venv.join("Lib/site-packages/torch/lib");
    if library.is_dir() {
        crate::storage::atomic_json(&library.join(".rocm-installed"), &marker)?;
    }
    let verify="import torch; print(f'ROCm: torch {torch.__version__}, HIP {getattr(torch.version, \"hip\", None)}, GPU available {torch.cuda.is_available()}')";
    run(
        engine,
        id,
        &python.command(&engine.runtime, ["-c", verify])?,
        token,
        180,
    )
    .await?;
    Ok(())
}
pub(crate) async fn install(
    engine: &Arc<NativeEngine>,
    id: &str,
    token: &CancellationToken,
) -> Result<JobResult> {
    engine.realtime.stop().await?;
    engine
        .jobs
        .stage(id, "Creating Python environment…", None, None);
    let uv = match uv(engine, id, token).await {
        Ok(uv) => uv,
        Err(error) if token.is_cancelled() => return Err(error),
        Err(error) => {
            engine
                .jobs
                .log(id, &format!("uv note: {error}; trying system Python."));
            None
        }
    };
    let venv = engine.runtime.data.join(".venv");
    let executable = venv_python(&venv);
    let valid = if executable.is_file() {
        setup_routes::run_check(&command(engine, &executable, ["--version"])?, token, 15)
            .await
            .ok()
            .filter(|r| r.success)
            .and_then(|r| python_runtime::version(&format!("{}{}", r.stdout, r.stderr)))
            .is_some_and(|version| python_runtime::supported(&version))
    } else {
        false
    };
    if !valid {
        validate_venv_rebuild(&engine.runtime.data, &venv)?;
        if let Some(uv) = &uv {
            let mut spec = command(
                engine,
                uv,
                vec![
                    "venv".into(),
                    venv.as_os_str().to_owned(),
                    "--python".into(),
                    "3.12".into(),
                    "--seed".into(),
                    "--clear".into(),
                ],
            )?;
            if engine
                .runtime
                .env("APPLIO_LOCAL_STORAGE")
                .is_some_and(|value| value == "1")
            {
                spec.env
                    .insert("UV_PYTHON_PREFERENCE".into(), "only-managed".into());
            }
            run(engine, id, &spec, token, 1800).await?;
        } else {
            let python = if let Some(python) = python_runtime::find(&engine.runtime, token).await {
                python
            } else {
                bootstrap_python(engine, id, token).await?
            };
            run(
                engine,
                id,
                &python.command(
                    &engine.runtime,
                    vec![
                        "-m".into(),
                        "venv".into(),
                        "--clear".into(),
                        venv.as_os_str().to_owned(),
                    ],
                )?,
                token,
                600,
            )
            .await?;
        }
    }
    let executable = if cfg!(windows) {
        python_runtime::stage_windows_venv(&venv).unwrap_or(executable)
    } else {
        executable
    };
    if !executable.is_file() {
        bail!("Virtualenv creation did not produce a Python interpreter");
    }
    let output =
        setup_routes::run_check(&command(engine, &executable, ["--version"])?, token, 15).await?;
    output.ensure_success()?;
    let python = Python {
        cmd: vec![executable.to_string_lossy().into_owned()],
        version: python_runtime::version(&format!("{}{}", output.stdout, output.stderr))
            .context("Invalid virtualenv Python version")?,
        source: "app .venv".into(),
    };
    if cfg!(windows) {
        vcredist(engine, id, token).await?;
    }
    engine
        .jobs
        .stage(id, "Installing dependencies…", None, None);
    if setup_routes::run_check(
        &python.command(&engine.runtime, ["-m", "pip", "--version"])?,
        token,
        15,
    )
    .await
    .map_or(true, |r| !r.success)
    {
        run(
            engine,
            id,
            &python.command(&engine.runtime, ["-m", "ensurepip", "--upgrade"])?,
            token,
            180,
        )
        .await?;
    }
    let hardware = gpu_runtime::hardware_with_env(
        &engine.runtime.data,
        &engine.runtime.python_command(Vec::<String>::new())?.env,
        token,
    )
    .await
    .unwrap_or_default();
    let amd_gpu = hardware.amd() || engine.runtime.env("APPLIO_ROCM_GFX").is_some();
    let (nvidia, driver) = if cfg!(target_os = "macos") || cfg!(windows) && amd_gpu {
        (Vec::new(), None)
    } else {
        nvidia(engine, token).await
    };
    let cuda = engine
        .runtime
        .env("APPLIO_TORCH_CUDA")
        .map(|value| value.to_string_lossy().into_owned());
    let policy = gpu_runtime::torch_policy(platform(), amd_gpu, cuda.as_deref(), &nvidia, driver);
    engine
        .jobs
        .log(id, &format!("Torch installation policy: {policy:?}"));
    let inspect="import importlib.metadata as m,json; print('APPLIO_JSON:'+json.dumps([(d.metadata.get('Name') or '').lower() for d in m.distributions() if (d.metadata.get('Name') or '').lower() in ('onnxruntime','onnxruntime-gpu','swift-f0')]))";
    let output = setup_routes::run_check(
        &python.command(&engine.runtime, ["-c", inspect])?,
        token,
        30,
    )
    .await?;
    output.ensure_success()?;
    let installed = crate::process::json_result(&output.stdout)?;
    let installed = installed
        .as_array()
        .context("Invalid installed package list")?;
    if installed.iter().any(|name| name == "swift-f0") {
        run(
            engine,
            id,
            &python.command(
                &engine.runtime,
                ["-m", "pip", "uninstall", "-y", "swift-f0"],
            )?,
            token,
            180,
        )
        .await?;
    }
    let distribution = crate::setup_requirements::distribution(platform(), policy.amd);
    if installed
        .iter()
        .filter_map(Value::as_str)
        .any(|name| matches!(name, "onnxruntime" | "onnxruntime-gpu") && name != distribution)
    {
        run(
            engine,
            id,
            &python.command(
                &engine.runtime,
                [
                    "-m",
                    "pip",
                    "uninstall",
                    "-y",
                    "onnxruntime",
                    "onnxruntime-gpu",
                ],
            )?,
            token,
            180,
        )
        .await?;
    }
    let content = crate::setup_requirements::read(&engine.runtime.code.join("requirements.txt"))?;
    let resolved = crate::setup_requirements::resolve(&content, platform(), &policy)?;
    let effective = engine.runtime.data.join(".requirements-resolved.txt");
    tokio::fs::write(&effective, resolved).await?;
    let index = policy
        .cuda
        .as_ref()
        .map(|tag| format!("https://download.pytorch.org/whl/{tag}"));
    if let Some(uv) = &uv {
        let mut args = vec![
            "pip".into(),
            "install".into(),
            "--python".into(),
            executable.as_os_str().to_owned(),
            "-r".into(),
            effective.as_os_str().to_owned(),
        ];
        if let Some(index) = &index {
            args.extend([
                "--extra-index-url".into(),
                index.into(),
                "--index-strategy".into(),
                "unsafe-best-match".into(),
            ]);
        }
        run(engine, id, &command(engine, uv, args)?, token, 7200).await?;
    } else {
        run(
            engine,
            id,
            &python.command(&engine.runtime, ["-m", "pip", "install", "-U", "pip"])?,
            token,
            600,
        )
        .await?;
        let mut args = vec![
            "-m".into(),
            "pip".into(),
            "install".into(),
            "--timeout".into(),
            "120".into(),
            "--retries".into(),
            "5".into(),
            "-r".into(),
            effective.as_os_str().to_owned(),
        ];
        if let Some(index) = &index {
            args.extend(["--extra-index-url".into(), index.into()]);
        }
        run(
            engine,
            id,
            &python.command(&engine.runtime, args)?,
            token,
            7200,
        )
        .await?;
    }
    if policy.amd {
        amd(engine, id, &python, uv.as_deref(), &hardware, token).await?;
    } else if policy.legacy {
        run(
            engine,
            id,
            &python.command(
                &engine.runtime,
                [
                    "-m",
                    "pip",
                    "uninstall",
                    "-y",
                    "torch",
                    "torchvision",
                    "torchaudio",
                ],
            )?,
            token,
            600,
        )
        .await?;
        let index = index.unwrap_or_else(|| "https://download.pytorch.org/whl/cu126".into());
        run(
            engine,
            id,
            &python.command(
                &engine.runtime,
                vec![
                    "-m".into(),
                    "pip".into(),
                    "install".into(),
                    "--no-cache-dir".into(),
                    "torch==2.7.1".into(),
                    "torchvision==0.22.1".into(),
                    "torchaudio==2.7.1".into(),
                    "--extra-index-url".into(),
                    index,
                ],
            )?,
            token,
            7200,
        )
        .await?;
    }
    engine.jobs.stage(id, "Downloading models…", None, None);
    let script = engine
        .runtime
        .backend
        .join("rvc/lib/tools/prerequisites_download.py");
    run(
        engine,
        id,
        &python.command(
            &engine.runtime,
            vec![
                script.into_os_string(),
                "--pretraineds-hifigan".into(),
                "--models".into(),
                "--exe".into(),
            ],
        )?,
        token,
        3600,
    )
    .await?;
    engine.jobs.stage(id, "Verifying installation…", None, None);
    let final_status = setup_routes::compute(engine, Some(python), true, token).await?;
    for check in final_status["checks"]
        .as_array()
        .context("Invalid setup verification")?
    {
        engine.jobs.log(
            id,
            &format!(
                "{} {}: {}",
                check["status"].as_str().unwrap_or(""),
                check["label"].as_str().unwrap_or(""),
                check["detail"].as_str().unwrap_or("")
            ),
        );
    }
    if final_status["ready"] != true {
        bail!("Setup finished but some required checks still fail — see above.");
    }
    let restart = engine.restart_token();
    let stopped = engine.cancellation_token();
    engine.spawn_background(async move {tokio::select!{_=stopped.cancelled()=>{},_=tokio::time::sleep(Duration::from_millis(500))=>restart.cancel()}}).await?;
    Ok(JobResult::new(
        json!({"message":"Setup complete — Applio is ready.","ready":true}),
        None,
    ))
}
