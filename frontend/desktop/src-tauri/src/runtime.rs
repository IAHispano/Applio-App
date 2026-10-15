use anyhow::{bail, Context, Result};
use applio_api::{
    app_runtime::{self, Environment},
    bridge_mode::{BridgeMode, Options},
    process::{CommandSpec, ManagedProcess, ProcessEvent},
};
use serde_json::Value;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

pub struct Paths {
    pub code: PathBuf,
    pub data: PathBuf,
    pub config: PathBuf,
    pub legacy_config: PathBuf,
    pub node: PathBuf,
}
impl Paths {
    pub fn resolve(app: &AppHandle) -> Result<Self> {
        use tauri::Manager;
        let packaged = !cfg!(debug_assertions);
        let legacy_config = if cfg!(target_os = "windows") {
            PathBuf::from(std::env::var_os("APPDATA").context("APPDATA is unavailable")?)
                .join("Applio")
        } else if cfg!(target_os = "macos") {
            app.path()
                .home_dir()?
                .join("Library/Application Support/Applio")
        } else {
            std::env::var_os("XDG_CONFIG_HOME")
                .map(PathBuf::from)
                .unwrap_or(app.path().home_dir()?.join(".config"))
                .join("Applio")
        };
        let config = if !packaged && std::env::var_os("APPLIO_CONFIG_DIR").is_some() {
            PathBuf::from(std::env::var_os("APPLIO_CONFIG_DIR").unwrap())
        } else if packaged && cfg!(target_os = "windows") {
            std::env::current_exe()?
                .parent()
                .context("Missing executable directory")?
                .join("data")
        } else {
            legacy_config.clone()
        };
        let code = if packaged {
            app.path().resource_dir()?.join("app")
        } else {
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("../../..")
                .canonicalize()?
        };
        let data = if !packaged && std::env::var_os("APPLIO_ROOT").is_some() {
            PathBuf::from(std::env::var_os("APPLIO_ROOT").unwrap())
        } else if packaged {
            config.join(if cfg!(target_os = "windows") {
                "runtime"
            } else {
                "data"
            })
        } else {
            code.clone()
        };
        let node = if packaged {
            code.join(if cfg!(windows) { "node.exe" } else { "node" })
        } else {
            std::env::var_os("APPLIO_NODE")
                .map(PathBuf::from)
                .unwrap_or(PathBuf::from("node"))
        };
        std::fs::create_dir_all(config.join("app-logs"))?;
        Ok(Self {
            code: dunce::simplified(&code).to_path_buf(),
            data: dunce::simplified(&data).to_path_buf(),
            config: dunce::simplified(&config).to_path_buf(),
            legacy_config: dunce::simplified(&legacy_config).to_path_buf(),
            node: dunce::simplified(&node).to_path_buf(),
        })
    }
}

pub fn prepare(paths: &Paths) -> Result<Environment> {
    let local = !cfg!(debug_assertions) && cfg!(windows);
    let mut legacy = Vec::new();
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        legacy.push(PathBuf::from(base).join("Programs/Applio/data"));
    }
    legacy.push(paths.legacy_config.clone());
    let mut env = app_runtime::prepare(
        &paths.code,
        &paths.data,
        &paths.config,
        !cfg!(debug_assertions),
        local,
        &legacy,
    )?;
    env.insert("APPLIO_NODE".into(), paths.node.as_os_str().to_owned());
    env.insert(
        "APPLIO_LOCALE".into(),
        sys_locale::get_locale()
            .unwrap_or_else(|| "en-US".into())
            .into(),
    );
    Ok(env)
}

pub struct Host {
    bridge: Arc<BridgeMode>,
    stop: CancellationToken,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}
impl Host {
    pub async fn start(
        app: AppHandle,
        paths: &Paths,
        environment: Environment,
    ) -> Result<Arc<Self>> {
        let standalone =
            !cfg!(debug_assertions) || std::env::var("APPLIO_STANDALONE_WEB").as_deref() == Ok("1");
        let web = paths.code.join("frontend/web");
        let entry = if standalone {
            web.join(".next/standalone/server.js")
        } else {
            web.join("node_modules/next/dist/bin/next")
        };
        let mut command = CommandSpec::new(
            &paths.node,
            if standalone {
                entry.parent().unwrap().to_path_buf()
            } else {
                web
            },
        );
        command.args.push(entry.into_os_string());
        if !standalone {
            command
                .args
                .extend(["dev", "-p", "3000", "-H", "127.0.0.1"].map(Into::into));
        }
        command.env = environment;
        for (key, value) in [
            ("PORT", "3000"),
            ("HOSTNAME", "127.0.0.1"),
            ("NEXT_PUBLIC_API_URL", "http://127.0.0.1:8000"),
            (
                "NODE_ENV",
                if standalone {
                    "production"
                } else {
                    "development"
                },
            ),
        ] {
            command.env.insert(key.into(), value.into());
        }
        command
            .env_remove
            .extend(["ELECTRON_RUN_AS_NODE", "NODE_OPTIONS"].map(Into::into));
        let mut child =
            ManagedProcess::spawn(&command).context("Could not start the Next.js interface")?;
        let stop = CancellationToken::new();
        let config = paths.config.clone();
        let code = paths.code.clone();
        let notifications = app.clone();
        let bridge = BridgeMode::new(
            Options {
                cache_dir: paths.config.join("cache/bridge-helper"),
                web_port: 3000,
                api_port: 8000,
                font_path: Some(paths.code.join("assets/fonts/Syne-Variable.ttf")),
                language: Arc::new(move || crate::language::load(&code, &config)),
                on_request: Arc::new(move |device| {
                    use tauri_plugin_notification::NotificationExt;
                    let _ = notifications
                        .notification()
                        .builder()
                        .title("Applio Bridge · Connection request")
                        .extra("href", "/settings")
                        .body(format!(
                            "{} is requesting access. Check code {} in Settings → Bridge Mode.",
                            device.name, device.code
                        ))
                        .show();
                }),
            },
            stop.child_token(),
        );
        let token = stop.clone();
        let log_path = paths.config.join("app-logs/launcher.log");
        let task = tokio::spawn(async move {
            use std::io::Write;
            let mut log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(log_path)
                .ok();
            loop {
                tokio::select! {
                    _=token.cancelled()=>{let _=child.stop().await;break;},
                    event=child.next_event()=> match event {
                        Ok(ProcessEvent::Line(_,line))=>{if let Some(log)=log.as_mut(){let _=writeln!(log,"{line}");}},
                        Ok(ProcessEvent::Exited(code))=>{if let Some(log)=log.as_mut(){let _=writeln!(log,"Next.js exited: {code:?}");}let _=app.emit("host-stopped",());break;},
                        Ok(ProcessEvent::OutputClosed)=>{tokio::select!{_=token.cancelled()=>{let _=child.stop().await;},_=child.wait()=>{let _=app.emit("host-stopped",());}}break;}
                        Err(error)=>{if let Some(log)=log.as_mut(){let _=writeln!(log,"Next.js process error: {error:#}");}let _=child.stop().await;let _=app.emit("host-stopped",());break;}
                    }
                }
            }
        });
        Ok(Arc::new(Self {
            bridge,
            stop,
            task: Mutex::new(Some(task)),
        }))
    }
    pub async fn call(&self, action: &str, value: Option<String>) -> Result<Value, String> {
        let result: Result<Value> = async {
            Ok(match action {
                "bridge:status" => self.bridge.state(),
                "bridge:start" => self.bridge.start().await?,
                "bridge:stop" => self.bridge.stop().await?,
                "bridge:invite" => self.bridge.new_invite()?,
                "bridge:approve" => self
                    .bridge
                    .approve(value.as_deref().context("Missing device")?)?,
                "bridge:revoke" => self
                    .bridge
                    .revoke(value.as_deref().context("Missing device")?)?,
                "setup:validate" => {
                    let id = value.context("Missing setup job")?;
                    if id.is_empty()
                        || id.len() > 100
                        || !id
                            .chars()
                            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
                    {
                        bail!("Invalid setup job");
                    }
                    let response = reqwest::Client::builder()
                        .no_proxy()
                        .timeout(Duration::from_secs(10))
                        .build()?
                        .get(format!("http://127.0.0.1:8000/api/jobs/{id}"))
                        .send()
                        .await?
                        .error_for_status()?
                        .json::<Value>()
                        .await?;
                    let job = &response["job"];
                    if job["status"] != "done"
                        || job["params"]["setup"] != true
                        || job["result"]["ready"] != true
                    {
                        bail!("Setup must finish successfully before restarting.");
                    }
                    Value::Bool(true)
                }
                _ => bail!("Unknown native command"),
            })
        }
        .await;
        result.map_err(|error| format!("{error:#}"))
    }
    pub async fn exited(&self) -> bool {
        self.task
            .lock()
            .await
            .as_ref()
            .is_none_or(|t| t.is_finished())
    }
    pub async fn stop(&self) {
        let _ = self.bridge.stop().await;
        self.stop.cancel();
        if let Some(mut task) = self.task.lock().await.take() {
            if tokio::time::timeout(Duration::from_secs(10), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
    }
}
impl Drop for Host {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

pub async fn wait_for_services(host: &Host) -> Result<()> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
    while tokio::time::Instant::now() < deadline {
        if host.exited().await {
            bail!("Next.js exited. See launcher.log for details.");
        }
        let (api, web) = tokio::join!(
            client.get("http://127.0.0.1:8000/api/health").send(),
            client.get("http://127.0.0.1:3000/").send()
        );
        if api.is_ok_and(|r| r.status().is_success()) && web.is_ok_and(|r| r.status().is_success())
        {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    bail!("The engine or interface did not start within 180 seconds.")
}
