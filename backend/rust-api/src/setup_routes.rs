use crate::{
    engine::{JobResult, NativeEngine},
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
    cache: tokio::sync::Mutex<Option<(u64, Instant, Value)>>,
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
    let mut cache = state.cache.lock().await;
    let revision = state.revision.load(Ordering::SeqCst);
    if query.get("refresh").is_none_or(|v| v != "1") {
        if let Some((stamp, at, value)) = &*cache {
            if *stamp == revision && at.elapsed() < Duration::from_secs(3600) {
                return Ok(Json(value.clone()));
            }
        }
    }
    let token = state.engine.cancellation_token();
    let value = compute(&state.engine, None, false, &token)
        .await
        .map_err(Error::internal)?;
    if revision == state.revision.load(Ordering::SeqCst) {
        *cache = Some((revision, Instant::now(), value.clone()));
    }
    Ok(Json(value))
}
pub(crate) fn missing_pretrains(engine: &NativeEngine) -> Vec<PathBuf> {
    let mut missing = Vec::new();
    for (vocoder, rates) in [
        ("hifi-gan", &[32, 40, 48][..]),
        ("refinegan", &[24, 32][..]),
    ] {
        for rate in rates {
            for side in ["G", "D"] {
                let path = engine.runtime.data.join(format!(
                    "rvc/models/pretraineds/{vocoder}/f0{side}{rate}k.pth"
                ));
                if !std::fs::metadata(&path).is_ok_and(|m| m.is_file() && m.len() > 0) {
                    missing.push(path);
                }
            }
        }
    }
    missing
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
) -> Result<Value> {
    if engine.no_env() {
        let checks = [
            ("rust", "Rust API"),
            ("node", "Web runtime"),
            ("web", "Web interface build"),
            ("python", "Python (3.11 / 3.12)"),
            ("engine", "Engine packages (torch, uvicorn, librosa)"),
            ("ffmpeg", "ffmpeg"),
            ("models", "Voice models"),
        ]
        .map(|(id, label)| Check::new(id, label, "ok", "checks bypassed with --no-env"));
        return Ok(
            json!({"ready":true,"checks":checks,"python":["no-env"],"checkedAt":crate::jobs::timestamp()}),
        );
    }
    let runtime = &engine.runtime;
    let mut checks = vec![Check::new("rust", "Rust API", "ok", "native runtime ready")];
    let bundled = runtime
        .code
        .join(if cfg!(windows) { "node.exe" } else { "node" });
    let node = runtime
        .env("APPLIO_NODE")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            if bundled.is_file() {
                bundled
            } else {
                "node".into()
            }
        });
    let mut node_spec = CommandSpec::new(node, &runtime.data).args(["--version"]);
    node_spec
        .env
        .extend(runtime.python_command(Vec::<String>::new())?.env);
    let node = run_check(&node_spec, token, 15).await;
    let (node_ok, node_version) = node
        .map(|r| {
            let text = r.stdout.trim().to_owned();
            (
                r.success
                    && text
                        .trim_start_matches('v')
                        .split('.')
                        .next()
                        .and_then(|n| n.parse::<u32>().ok())
                        .is_some_and(|major| major >= 20),
                text,
            )
        })
        .unwrap_or((false, "not found".into()));
    checks.push(Check::new(
        "node",
        format!("Node.js {node_version}"),
        if node_ok { "ok" } else { "missing" },
        if node_ok {
            "web runtime ready"
        } else {
            "Node.js 20+ is required for the web interface"
        },
    ));
    let web = runtime.code.join("frontend/web");
    let web_ok = [
        ".next/standalone/server.js",
        ".next/BUILD_ID",
        "package.json",
    ]
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
    let (packages, detail) = if let Some(python) = &python {
        let mut spec = python.command(runtime, ["-c", crate::engine::ENGINE_PROBE])?;
        if !owns_gpu && (engine.scheduler.gpu_busy() || engine.scheduler.status().realtime) {
            spec.env.insert("APPLIO_PROBE_SKIP_GPU".into(), "1".into());
        }
        match run_check(&spec, token, 180).await {
            Ok(output) if output.success && output.stdout.contains("OK|") => {
                (true, output.stdout.trim().to_owned())
            }
            Ok(output) => (
                false,
                format!("{}{}", output.stderr, output.stdout)
                    .chars()
                    .rev()
                    .take(500)
                    .collect::<String>()
                    .chars()
                    .rev()
                    .collect(),
            ),
            Err(error) => (false, error.to_string()),
        }
    } else {
        (false, "needs Python first".into())
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
    let missing = missing_pretrains(engine).len();
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
        if hardware.amd() || runtime.env("APPLIO_ROCM_GFX").is_some() {
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
    Ok(
        json!({"ready":ready,"checks":checks,"python":python.map(|p|p.cmd),"checkedAt":crate::jobs::timestamp()}),
    )
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
                let result = crate::setup_install::install(&engine, &job.id, &token).await;
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
                    .backend
                    .join("rvc/lib/tools/prerequisites_download.py");
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
