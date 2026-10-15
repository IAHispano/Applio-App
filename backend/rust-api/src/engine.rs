//! Shared native execution: GPU admission, persistent jobs, resident inference
//! and application shutdown are owned by one engine instance.
use crate::{
    engine_runtime::EngineRuntime,
    jobs::{Job, JobStore, JobType},
    process::ManagedProcess,
    scheduler::{Resource, Scheduler},
    worker::InferenceWorker,
};
use anyhow::{bail, Context, Result};
use futures_util::{future::BoxFuture, FutureExt};
use serde_json::Value;
use std::{
    future::Future,
    panic::AssertUnwindSafe,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;

pub trait Readiness: Send + Sync {
    fn require(
        &self,
        allow_missing_pretrains: bool,
        cancelled: CancellationToken,
    ) -> BoxFuture<'_, Result<()>>;
}

pub struct RuntimeReadiness {
    runtime: EngineRuntime,
    bypass: bool,
    cached: tokio::sync::Mutex<Option<(tokio::time::Instant, Option<String>)>>,
}
impl RuntimeReadiness {
    pub fn new(runtime: EngineRuntime, bypass: bool) -> Self {
        Self {
            runtime,
            bypass,
            cached: tokio::sync::Mutex::new(None),
        }
    }
    pub async fn invalidate(&self) {
        *self.cached.lock().await = None;
    }
}
impl Readiness for RuntimeReadiness {
    fn require(
        &self,
        allow_missing_pretrains: bool,
        cancelled: CancellationToken,
    ) -> BoxFuture<'_, Result<()>> {
        Box::pin(async move {
            if self.bypass {
                return Ok(());
            }
            let mut cache = self.cached.lock().await;
            if cache
                .as_ref()
                .is_none_or(|(at, _)| at.elapsed() > Duration::from_secs(60))
            {
                let spec = self.runtime.python_command(["-c", ENGINE_PROBE])?;
                let probe = tokio::time::timeout(
                    Duration::from_secs(180),
                    ManagedProcess::run(&spec, &cancelled, |_, _| {}),
                )
                .await;
                let failure = match probe {
                    Ok(Ok(output)) => output.ensure_success().err().map(|error| error.to_string()),
                    Ok(Err(error)) => Some(error.to_string()),
                    Err(_) => Some("Python engine dependency check timed out".into()),
                };
                *cache = Some((tokio::time::Instant::now(), failure));
            }
            if let Some((_, Some(error))) = cache.as_ref() {
                bail!("Engine environment is not ready ({error}). Please complete Applio setup first.");
            }
            if !allow_missing_pretrains {
                let mut missing = 0;
                for (vocoder, rates) in [
                    ("hifi-gan", &[32, 40, 48][..]),
                    ("refinegan", &[24, 32][..]),
                ] {
                    for rate in rates {
                        for side in ["G", "D"] {
                            let path = self.runtime.data.join(format!(
                                "rvc/models/pretraineds/{vocoder}/f0{side}{rate}k.pth"
                            ));
                            if !std::fs::metadata(path)
                                .is_ok_and(|metadata| metadata.is_file() && metadata.len() > 0)
                            {
                                missing += 1;
                            }
                        }
                    }
                }
                if missing > 0 {
                    bail!("Engine environment is not ready ({missing} missing default training pretrains). Please complete Applio setup first.");
                }
            }
            Ok(())
        })
    }
}

pub struct JobResult {
    pub result: Value,
    pub output_file: Option<String>,
}
impl JobResult {
    pub fn new(result: Value, output_file: Option<String>) -> Self {
        Self {
            result,
            output_file,
        }
    }
}

#[derive(Default)]
pub struct EngineOptions {
    pub no_env: bool,
    pub realtime_port: Option<u16>,
}
pub(crate) struct SourceUpdate {
    engine: Arc<NativeEngine>,
    _gpu: Option<crate::scheduler::Lease>,
}
impl Drop for SourceUpdate {
    fn drop(&mut self) {
        self.engine.source_update.store(false, Ordering::SeqCst);
    }
}

pub struct NativeEngine {
    pub runtime: EngineRuntime,
    pub jobs: JobStore,
    pub scheduler: Scheduler,
    pub worker: InferenceWorker,
    pub presence: Arc<crate::service::BackgroundService>,
    pub realtime: Arc<crate::realtime::Realtime>,
    pub(crate) plugin_install: tokio::sync::Mutex<()>,
    services_started: AtomicBool,
    no_env: bool,
    readiness: Arc<dyn Readiness>,
    closing: AtomicBool,
    source_update: AtomicBool,
    shutdown_gate: tokio::sync::Mutex<()>,
    shutdown_done: AtomicBool,
    restart: CancellationToken,
    cancellation: CancellationToken,
    tasks: tokio::sync::Mutex<tokio::task::JoinSet<()>>,
}
impl NativeEngine {
    pub fn open(runtime: EngineRuntime, readiness: Arc<dyn Readiness>) -> Result<Arc<Self>> {
        Self::open_with_options(
            runtime,
            readiness,
            EngineOptions {
                no_env: std::env::var("APPLIO_NO_ENV").as_deref() == Ok("1"),
                realtime_port: None,
            },
        )
    }
    pub fn open_with_options(
        runtime: EngineRuntime,
        readiness: Arc<dyn Readiness>,
        options: EngineOptions,
    ) -> Result<Arc<Self>> {
        crate::plugin_routes::recover(&runtime.data.join("plugins/installed"))?;
        let jobs = JobStore::open(runtime.config_dir.join("jobs.json"))?;
        let worker = InferenceWorker::new(runtime.worker_command()?);
        let realtime = crate::realtime::Realtime::new(runtime.clone(), options.realtime_port);
        Ok(Arc::new(Self {
            runtime,
            jobs,
            worker,
            realtime,
            presence: Arc::new(crate::service::BackgroundService::default()),
            plugin_install: tokio::sync::Mutex::new(()),
            services_started: AtomicBool::new(false),
            no_env: options.no_env,
            scheduler: Scheduler::default(),
            readiness,
            closing: AtomicBool::new(false),
            source_update: AtomicBool::new(false),
            shutdown_gate: tokio::sync::Mutex::new(()),
            shutdown_done: AtomicBool::new(false),
            restart: CancellationToken::new(),
            cancellation: CancellationToken::new(),
            tasks: tokio::sync::Mutex::new(tokio::task::JoinSet::new()),
        }))
    }
    pub async fn require_ready(&self, allow_missing_pretrains: bool) -> Result<()> {
        if self.closing.load(Ordering::SeqCst) {
            bail!("Applio is shutting down");
        }
        self.readiness
            .require(allow_missing_pretrains, self.cancellation.clone())
            .await
    }

    pub fn cancellation_token(&self) -> CancellationToken {
        self.cancellation.child_token()
    }
    pub fn restart_token(&self) -> CancellationToken {
        self.restart.clone()
    }
    pub fn request_shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);
        self.jobs.close_admission();
        self.jobs
            .cancel_all("Interrupted by app shutdown. Start the job again to continue.");
        self.cancellation.cancel();
    }
    pub fn is_stopped(&self) -> bool {
        self.shutdown_done.load(Ordering::SeqCst)
    }
    pub(crate) fn begin_source_update(self: &Arc<Self>) -> Result<SourceUpdate> {
        let _admission = crate::uploads::active_uploads();
        if self.closing.load(Ordering::SeqCst) {
            bail!("Applio is shutting down");
        }
        if self.source_update.swap(true, Ordering::SeqCst) {
            bail!("An engine update is already running");
        }
        let mut guard = SourceUpdate {
            engine: self.clone(),
            _gpu: None,
        };
        if !self.jobs.active_params().is_empty() {
            bail!("Stop active jobs before updating engine code.");
        }
        guard._gpu =
            Some(self.scheduler.try_gpu("source-update").context(
                "Stop realtime audio or wait for GPU work before updating engine code.",
            )?);
        Ok(guard)
    }

    pub fn no_env(&self) -> bool {
        self.no_env
    }
    pub async fn start_presence(self: &Arc<Self>) -> Result<()> {
        if self.no_env {
            bail!("Presence is disabled without the voice environment");
        }
        let source = self.runtime.code.join("assets/discord_presence.py");
        let spec=self.runtime.python_command([std::ffi::OsString::from("-c"),std::ffi::OsString::from("import sys,runpy,threading; scope=runpy.run_path(sys.argv[1]); scope['RPCManager'].start_presence(); threading.Event().wait()"),source.into_os_string()])?;
        self.presence.start(self, &spec).await?;
        Ok(())
    }
    pub async fn start_services(self: &Arc<Self>) -> Result<()> {
        if self.cancellation.is_cancelled() {
            bail!("Applio is shutting down");
        }
        let config = self.runtime.config.load()?;
        if self.services_started.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        if config["discord_presence"] == true && !self.no_env {
            if let Err(error) = self.start_presence().await {
                eprintln!("Discord presence: {error:#}");
            }
        }
        let weak = Arc::downgrade(self);
        let token = self.cancellation_token();
        self.spawn_background(async move {
            let mut delay = Duration::from_secs(15);
            loop {
                tokio::select! {biased;_=token.cancelled()=>return,_=tokio::time::sleep(delay)=>{}}
                let Some(engine) = weak.upgrade() else {
                    return;
                };
                let task = tokio::task::spawn_blocking(move || {
                    crate::cleaner::clean(
                        &engine,
                        crate::cleaner::Options {
                            max_age_ms: 24.0 * 3600.0 * 1000.0,
                            uploads: true,
                            outputs: true,
                        },
                    )
                });
                let _ = task.await;
                delay = Duration::from_secs(6 * 3600);
            }
        })
        .await
    }

    /// Non-job work such as speculative model preloading still belongs to the
    /// engine lifecycle, so closing the app cannot orphan a Python operation.
    pub async fn spawn_background(
        &self,
        work: impl Future<Output = ()> + Send + 'static,
    ) -> Result<()> {
        let mut tasks = self.tasks.lock().await;
        if self.closing.load(Ordering::SeqCst) {
            bail!("Applio is shutting down");
        }
        while tasks.try_join_next().is_some() {}
        tasks.spawn(work);
        Ok(())
    }

    pub async fn start_job<F, Fut>(
        self: &Arc<Self>,
        kind: JobType,
        params: Value,
        resource: Option<Resource>,
        work: F,
    ) -> Result<Job>
    where
        F: FnOnce(Arc<Self>, Job, CancellationToken) -> Fut + Send + 'static,
        Fut: Future<Output = Result<JobResult>> + Send + 'static,
    {
        let mut tasks = self.tasks.lock().await;
        if self.closing.load(Ordering::SeqCst) {
            bail!("Applio is shutting down");
        }
        while tasks.try_join_next().is_some() {}
        let job = {
            let _storage = crate::uploads::active_uploads();
            if self.source_update.load(Ordering::SeqCst) {
                bail!("Updating engine code; retry shortly.");
            }
            self.jobs.create(kind, params)?
        };
        let task_job = job.clone();
        let engine = self.clone();
        let token = self
            .jobs
            .cancellation(&job.id)
            .context("Job was cancelled before execution started")?;
        tasks.spawn(async move {
            let id = task_job.id.clone();
            let result = AssertUnwindSafe(async {
                let _permit = if let Some(resource) = resource {
                    let mut admitted = Box::pin(engine.scheduler.acquire(&id, resource, &token));
                    let permit = match futures_util::poll!(admitted.as_mut()) {
                        std::task::Poll::Ready(result) => result?,
                        std::task::Poll::Pending => {
                            engine.jobs.log(
                                &id,
                                match resource {
                                    Resource::Gpu => "Waiting for the GPU to become available.",
                                    Resource::DatasetReview => {
                                        "Waiting for the current dataset review to finish."
                                    }
                                    _ => "Waiting for a download slot.",
                                },
                            );
                            admitted.await?
                        }
                    };
                    let Some(permit) = permit else {
                        bail!("Stopped by user");
                    };
                    Some(permit)
                } else {
                    None
                };
                if token.is_cancelled() {
                    bail!("Stopped by user");
                }
                if kind == JobType::Train
                    || task_job.params.as_ref().is_some_and(|p| {
                        !p["setup"].is_null()
                            || (!p["model"].is_null() && !p["outputFormat"].is_null())
                    })
                {
                    engine.worker.stop().await?;
                }
                engine.jobs.running(&id);
                work(engine.clone(), task_job, token).await
            })
            .catch_unwind()
            .await;
            match result {
                Ok(Ok(output)) => engine.jobs.done(&id, output.result, output.output_file),
                Ok(Err(error)) => {
                    engine.jobs.log(&id, &format!("ERROR: {error:#}"));
                    engine
                        .jobs
                        .error(&id, error.to_string(), Some(format!("{error:#}")));
                }
                Err(_) => engine.jobs.error(&id, "The job stopped unexpectedly", None),
            }
        });
        Ok(job)
    }

    pub async fn shutdown(&self) -> Result<()> {
        let _shutdown = self.shutdown_gate.lock().await;
        if self.shutdown_done.load(Ordering::SeqCst) {
            return Ok(());
        }
        self.request_shutdown();
        let worker = self.worker.stop().await;
        let mut tasks = std::mem::take(&mut *self.tasks.lock().await);
        if tokio::time::timeout(Duration::from_secs(10), async {
            while tasks.join_next().await.is_some() {}
        })
        .await
        .is_err()
        {
            tasks.abort_all();
            while tasks.join_next().await.is_some() {}
        }
        let history = self.jobs.flush().await;
        worker?;
        history?;
        self.jobs.seal().await;
        self.shutdown_done.store(true, Ordering::SeqCst);
        Ok(())
    }
}

pub(crate) const ENGINE_PROBE: &str = r#"
import sys, os
if sys.version_info[:2] not in ((3, 11), (3, 12)):
    raise RuntimeError('Python 3.11 or 3.12 is required')
import torch, uvicorn, librosa
version = getattr(torch, '__version__', '')
legacy = broken = False
gpu = ''
if torch.cuda.is_available() and os.environ.get('APPLIO_PROBE_SKIP_GPU') != '1':
    try:
        for index in range(torch.cuda.device_count()):
            gpu = torch.cuda.get_device_name(index)
            if not getattr(torch.version, 'hip', None) and not any(name in gpu.upper() for name in ('AMD', 'RADEON')):
                major, minor = torch.cuda.get_device_capability(index)
                legacy = legacy or (major + minor / 10 < 7.5)
            torch.zeros(1, device=f'cuda:{index}')
    except Exception as error:
        broken = legacy or 'no kernel image' in str(error) or 'CUDA error' in str(error)
if (legacy or broken) and not version.startswith('2.7.'):
    raise RuntimeError(f'torch {version} is incompatible with older GPU {gpu}; run Install/Repair for PyTorch 2.7.1 (cu126)')
print(f'OK|{version}')
"#;
