use crate::{
    engine::{JobResult, NativeEngine, ProbeGpu},
    jobs::JobType,
    process::{CommandSpec, ManagedProcess},
    processing_routes::{accepted, Accepted, Error},
    python_runtime::{self, Python},
    scheduler::Resource,
};
use anyhow::Result;
use axum::{
    extract::{Query, State},
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

pub(crate) struct Setup {
    pub engine: Arc<NativeEngine>,
    active: tokio::sync::Mutex<Option<String>>,
    revision: AtomicU64,
    cache: tokio::sync::Mutex<Option<CachedStatus>>,
}

struct CachedStatus {
    revision: u64,
    completed: Instant,
    ttl: Duration,
    forced: bool,
    report: Value,
}
pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/setup/status", get(status))
        .route("/api/setup/install", post(install))
        .route("/api/setup/prerequisites", post(prerequisites))
        .with_state(Arc::new(Setup {
            engine,
            active: tokio::sync::Mutex::new(None),
            revision: AtomicU64::new(0),
            cache: tokio::sync::Mutex::new(None),
        }))
}
#[derive(Clone, Serialize, Deserialize)]
pub(crate) struct Check {
    pub id: String,
    pub label: String,
    pub status: String,
    pub detail: String,
}
impl Check {
    fn new(id: &str, label: impl Into<String>, status: &str, detail: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            label: label.into(),
            status: status.into(),
            detail: detail.into(),
        }
    }
}
async fn status(
    State(state): State<Arc<Setup>>,
    Query(query): Query<HashMap<String, String>>,
) -> Result<Json<Value>, Error> {
    let requested = Instant::now();
    let force = query.get("refresh").is_some_and(|v| v == "1");
    let mut cache = state.cache.lock().await;
    let revision = state.revision.load(Ordering::SeqCst);
    if let Some(cached) = cache.as_ref().filter(|cached| cached.revision == revision) {
        let reusable = if force {
            // Tabs refreshing together can use the same completed forced check.
            cached.forced && cached.completed > requested
        } else {
            cached.completed.elapsed() < cached.ttl
        };
        if reusable {
            return Ok(Json(cached.report.clone()));
        }
    }
    if force {
        state.engine.runtime.package_probe.invalidate().await;
        state.engine.runtime.toolchain.invalidate();
    }
    let token = state.engine.cancellation_token();
    let (report, full_probe) = compute(&state.engine, None, false, &token)
        .await
        .map_err(Error::internal)?;
    if revision == state.revision.load(Ordering::SeqCst) {
        let seconds = if full_probe && report["ready"] == true {
            3600
        } else {
            5
        };
        *cache = Some(CachedStatus {
            revision,
            completed: Instant::now(),
            ttl: Duration::from_secs(seconds),
            forced: force,
            report: report.clone(),
        });
    }
    Ok(Json(report))
}
pub(crate) async fn run_check(
    spec: &CommandSpec,
    token: &CancellationToken,
    seconds: u64,
) -> Result<crate::process::ProcessOutput> {
    tokio::time::timeout(
        Duration::from_secs(seconds),
        ManagedProcess::run(spec, token, |_, _| {}),
    )
    .await?
}
pub(crate) async fn vc_redist(engine: &NativeEngine, token: &CancellationToken) -> bool {
    if !cfg!(windows) {
        return true;
    }
    let system = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("System32");
    if system.join("msvcp140.dll").is_file() && system.join("vcruntime140_1.dll").is_file() {
        return true;
    }
    let mut spec = CommandSpec::new("reg.exe", &engine.runtime.data).args([
        "query",
        r"HKLM\SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\x64",
        "/v",
        "Installed",
    ]);
    if let Ok(context) = engine.runtime.python_command(Vec::<String>::new()) {
        spec.env.extend(context.env);
    }
    run_check(&spec, token, 10)
        .await
        .is_ok_and(|output| output.success && output.stdout.contains("0x1"))
}
pub(crate) async fn compute(
    engine: &NativeEngine,
    python: Option<Python>,
    owns_gpu: bool,
    token: &CancellationToken,
) -> Result<(Value, bool)> {
    if engine.no_env() {
        let checks = [
            ("rust", "Rust API"),
            ("web", "Web interface build"),
            ("python", "Python (3.11 / 3.12)"),
            ("engine", "Engine packages (torch, uvicorn, librosa)"),
            ("ffmpeg", "ffmpeg"),
            ("models", "Voice models"),
        ]
        .map(|(id, label)| Check::new(id, label, "ok", "checks bypassed with --no-env"));
        return Ok((
            json!({"ready":true,"checks":checks,"python":["no-env"],"checkedAt":crate::jobs::timestamp()}),
            true,
        ));
    }
    let runtime = &engine.runtime;
    let mut checks = vec![Check::new("rust", "Rust API", "ok", "native runtime ready")];
    let web = runtime.code.join("frontend/web");
    let web_ok = ["out/index.html", "package.json"]
        .iter()
        .any(|path| web.join(path).is_file());
    checks.push(Check::new(
        "web",
        "Web interface build",
        if web_ok { "ok" } else { "missing" },
        if web_ok {
            "web interface ready"
        } else {
            "web bundle missing — run pnpm build"
        },
    ));
    let python = match python {
        Some(python) => Some(python),
        None => python_runtime::find(runtime, token).await,
    };
    checks.push(Check::new(
        "python",
        python
            .as_ref()
            .map(|p| format!("Python {}", p.version))
            .unwrap_or_else(|| "Python (3.11 / 3.12)".into()),
        if python.is_some() { "ok" } else { "missing" },
        python
            .as_ref()
            .map(|p| format!("{} ({})", p.version, p.source))
            .unwrap_or_else(|| "no suitable Python found".into()),
    ));
    let (packages, detail, full_probe) = if let Some(python) = &python {
        let spec = python.command(runtime, ["-c", crate::engine::ENGINE_PROBE])?;
        let gpu = if owns_gpu {
            ProbeGpu::Reserved
        } else {
            ProbeGpu::Schedule(&engine.scheduler)
        };
        match runtime.package_probe.run(&spec, gpu, token).await {
            Ok(probe) if probe.output.success && probe.output.stdout.contains("OK|") => {
                (true, probe.output.stdout.trim().to_owned(), probe.full)
            }
            Ok(probe) => (
                false,
                format!("{}{}", probe.output.stderr, probe.output.stdout)
                    .chars()
                    .rev()
                    .take(500)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect(),
                probe.full,
            ),
            Err(error) => (false, error.to_string(), false),
        }
    } else {
        (false, "needs Python first".into(), false)
    };
    checks.push(Check::new(
        "engine",
        "Engine packages (torch, uvicorn, librosa)",
        if packages { "ok" } else { "missing" },
        detail,
    ));
    let local = runtime.data.join(if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    });
    let ffmpeg = if local.is_file() {
        local
    } else {
        PathBuf::from("ffmpeg")
    };
    let mut spec = runtime.python_command(Vec::<String>::new())?;
    spec.program = ffmpeg;
    spec.args = vec!["-version".into()];
    let ffmpeg = run_check(&spec, token, 15).await.ok().filter(|r| r.success);
    checks.push(Check::new(
        "ffmpeg",
        "ffmpeg",
        if ffmpeg.is_some() { "ok" } else { "warn" },
        ffmpeg
            .map(|r| {
                r.stdout
                    .lines()
                    .next()
                    .unwrap_or("ffmpeg ready")
                    .chars()
                    .take(120)
                    .collect::<String>()
            })
            .unwrap_or_else(|| "ffmpeg not on PATH — some audio formats may fail".into()),
    ));
    checks.push(Check::new(
        "models",
        "Voice models",
        "ok",
        "Use the Models tab to manage voice models.",
    ));
    let missing = runtime.missing_default_pretrains();
    checks.push(Check::new(
        "pretraineds",
        "Default training pretrains",
        if missing == 0 { "ok" } else { "missing" },
        if missing == 0 {
            "HiFi-GAN and RefineGAN pretrains ready".into()
        } else {
            format!("{missing} missing file(s) — setup downloads these automatically")
        },
    ));
    if cfg!(windows) {
        if !vc_redist(engine, token).await {
            checks.push(Check::new(
                "vcredist",
                "Visual C++ 2015-2022 Redistributable",
                "missing",
                "Required for PyTorch (c10.dll): https://aka.ms/vs/17/release/vc_redist.x64.exe",
            ));
        }
        let hardware = crate::gpu_runtime::hardware_with_env(
            &runtime.data,
            &runtime.python_command(Vec::<String>::new())?.env,
            token,
        )
        .await
        .unwrap_or_default();
        let explicit_gfx = runtime.env("APPLIO_ROCM_GFX");
        if hardware.use_rocm(explicit_gfx.as_ref().and_then(|v| v.to_str())) {
            let rocm = crate::gpu_runtime::rocm_installed(&runtime.data.join(".venv"));
            checks.push(Check::new(
                "rocm",
                "AMD GPU Acceleration (ROCm)",
                if rocm { "ok" } else { "warn" },
                if rocm {
                    "Native ROCm PyTorch installed"
                } else {
                    "Native ROCm PyTorch will be installed automatically"
                },
            ));
            let pf86 = runtime.env("ProgramFiles(x86)").map(PathBuf::from);
            let msvc = crate::gpu_runtime::find_msvc_in(pf86.as_deref()).is_some();
            checks.push(Check::new(
                "msvc_tools",
                "Visual Studio C++ Build Tools",
                if msvc { "ok" } else { "warn" },
                if msvc {
                    "MSVC configured for MIOpen"
                } else {
                    "Install Desktop development with C++ for MIOpen runtime compilation"
                },
            ));
        }
    }
    let ready = checks.iter().all(|check| {
        check.status == "ok" || matches!(check.id.as_str(), "ffmpeg" | "models" | "rocm")
    });
    Ok((
        json!({"ready":ready,"checks":checks,"python":python.map(|p|p.cmd),"checkedAt":crate::jobs::timestamp()}),
        full_probe,
    ))
}
async fn install(State(state): State<Arc<Setup>>) -> Accepted {
    let mut active = state.active.lock().await;
    if let Some(job) = active
        .as_ref()
        .and_then(|id| state.engine.jobs.get(id))
        .filter(|job| job.active())
    {
        return Ok(accepted(job));
    }
    let setup = state.clone();
    let job = state
        .engine
        .start_job(
            JobType::Other,
            json!({"setup":true}),
            Some(Resource::Gpu),
            move |engine, job, token| async move {
                setup.revision.fetch_add(1, Ordering::SeqCst);
                engine.runtime.package_probe.invalidate().await;
                engine.runtime.toolchain.invalidate();
                let result = crate::setup_install::install(&engine, &job.id, &token).await;
                engine.runtime.package_probe.invalidate().await;
                engine.runtime.toolchain.invalidate();
                setup.revision.fetch_add(1, Ordering::SeqCst);
                result
            },
        )
        .await?;
    *active = Some(job.id.clone());
    Ok(accepted(job))
}
async fn prerequisites(State(state): State<Arc<Setup>>) -> Accepted {
    let setup = state.clone();
    let job = state
        .engine
        .start_job(
            JobType::Other,
            json!({"setup":"prerequisites"}),
            Some(Resource::Gpu),
            move |engine, job, token| async move {
                let python = python_runtime::find(&engine.runtime, &token).await;
                let script = engine
                    .runtime
                    .code
                    .join("backend/python/downloads/prerequisites.py");
                let args = vec![
                    script.into_os_string(),
                    "--pretraineds-hifigan".into(),
                    "--models".into(),
                    "--exe".into(),
                ];
                let spec = if let Some(python) = python {
                    python.command(&engine.runtime, args)?
                } else {
                    engine.runtime.python_command(args)?
                };
                engine
                    .jobs
                    .stage(&job.id, "Downloading models…", None, None);
                crate::setup_install::run(&engine, &job.id, &spec, &token, 3600).await?;
                setup.revision.fetch_add(1, Ordering::SeqCst);
                Ok(JobResult::new(
                    json!({"message":"Engine models downloaded."}),
                    None,
                ))
            },
        )
        .await?;
    Ok(accepted(job))
}
