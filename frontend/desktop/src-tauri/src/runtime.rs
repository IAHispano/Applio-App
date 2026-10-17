use anyhow::{bail, Context, Result};
use applio_api::{
    app_runtime::{self, Environment},
    bridge_mode::{BridgeMode, Options},
};
use serde_json::Value;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tauri::AppHandle;
use tokio_util::sync::CancellationToken;

pub struct Paths {
    pub code: PathBuf,
    pub data: PathBuf,
    pub config: PathBuf,
    pub legacy_config: PathBuf,
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
        std::fs::create_dir_all(config.join("app-logs"))?;
        Ok(Self {
            code: dunce::simplified(&code).to_path_buf(),
            data: dunce::simplified(&data).to_path_buf(),
            config: dunce::simplified(&config).to_path_buf(),
            legacy_config: dunce::simplified(&legacy_config).to_path_buf(),
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
}
impl Host {
    pub async fn start(app: AppHandle, paths: &Paths) -> Result<Arc<Self>> {
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
        Ok(Arc::new(Self { bridge, stop }))
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
    pub async fn stop(&self) {
        let _ = self.bridge.stop().await;
        self.stop.cancel();
    }
}
impl Drop for Host {
    fn drop(&mut self) {
        self.stop.cancel();
    }
}

pub async fn wait_for_services() -> Result<()> {
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(2))
        .build()?;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(180);
    while tokio::time::Instant::now() < deadline {
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
