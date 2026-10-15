#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod desktop_policy;
mod language;
mod runtime;
mod tray;
mod updater;

use runtime::{Host, Paths};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Instant,
};
use tauri::{AppHandle, Emitter, Listener, Manager, State, WebviewUrl, WebviewWindow};
use tauri_plugin_clipboard_manager::ClipboardExt;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

const WEBVIEW_ARGS: &str = "--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows";

pub struct AppState {
    paths: Paths,
    host: tokio::sync::Mutex<Option<Arc<Host>>>,
    server: Mutex<
        Option<(
            tokio_util::sync::CancellationToken,
            tauri::async_runtime::JoinHandle<()>,
        )>,
    >,
    starting: AtomicBool,
    quitting: AtomicBool,
    ready: AtomicBool,
    interface_loaded: tokio::sync::Notify,
    startup_error: Mutex<Option<String>>,
    hotkey: Mutex<String>,
    realtime: Mutex<Option<(Value, Instant)>>,
    notified: Mutex<HashSet<String>>,
    updates: tokio::sync::Mutex<updater::UpdateState>,
}
impl AppState {
    async fn stop(&self) {
        self.ready.store(false, Ordering::SeqCst);
        if let Some(host) = self.host.lock().await.take() {
            host.stop().await;
        }
        let server = self.server.lock().unwrap().take();
        if let Some((stop, mut server)) = server {
            stop.cancel();
            if tokio::time::timeout(std::time::Duration::from_secs(25), &mut server)
                .await
                .is_err()
            {
                server.abort();
                let _ = server.await;
            }
        }
    }
    async fn host(&self) -> Result<Arc<Host>, String> {
        self.host
            .lock()
            .await
            .clone()
            .ok_or_else(|| "The engine is not running".into())
    }
}

fn focus(app: &AppHandle) {
    if let Some(window) = app
        .get_webview_window("splash")
        .or_else(|| app.get_webview_window("main"))
    {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn show_splash(app: &AppHandle) -> tauri::Result<()> {
    if let Some(window) = app.get_webview_window("splash") {
        window.show()?;
        return Ok(());
    }
    let window =
        tauri::WebviewWindowBuilder::new(app, "splash", WebviewUrl::App("index.html".into()))
            .title("Applio")
            .inner_size(1140.0, 640.0)
            .center()
            .decorations(false)
            .resizable(false)
            .minimizable(false)
            .maximizable(false)
            .background_color(tauri::webview::Color(6, 6, 6, 255))
            .data_directory(app.state::<AppState>().paths.config.join("session"))
            .additional_browser_args(WEBVIEW_ARGS)
            .devtools(false)
            .initialization_script(desktop_policy::SCRIPT)
            .visible(false)
            .on_page_load(|window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Finished {
                    let _ = window.show();
                }
            })
            .on_navigation(|url| {
                url.scheme() == "tauri"
                    || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
            })
            .build()?;
    desktop_policy::apply(&window)?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
            handle.exit(0);
        }
    });
    Ok(())
}

async fn startup(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.starting.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    *state.startup_error.lock().unwrap() = None;
    let _ = app.emit("startup-status", "Loading Applio…");
    let result: anyhow::Result<()> = async {
        state.stop().await;
        // Reserve the public API before starting any worker. A conflicting
        // instance must never load somebody else's loopback UI with native IPC.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:8000").await?;
        let web_reservation = tokio::net::TcpListener::bind("127.0.0.1:3000").await?;
        let environment = runtime::prepare(&state.paths)?;
        let _ = app.emit("startup-status", "Starting engine…");
        let config = applio_api::ApiConfig {
            code_root: state.paths.code.clone(),
            data_root: state.paths.data.clone(),
            config_dir: state.paths.config.clone(),
        };
        let stop = tokio_util::sync::CancellationToken::new();
        let server_stop = stop.clone();
        let server_env = environment.clone();
        let handle = app.clone();
        *state.server.lock().unwrap() = Some((
            stop,
            tauri::async_runtime::spawn(async move {
                if let Err(error) = applio_api::native_host::serve_with_environment(
                    listener,
                    config,
                    server_stop.clone(),
                    server_env,
                )
                .await
                {
                    eprintln!("Rust API stopped: {error:#}");
                }
                if !server_stop.is_cancelled() {
                    let _ = handle.emit("host-stopped", ());
                }
            }),
        ));
        drop(web_reservation);
        let host = Host::start(app.clone(), &state.paths, environment).await?;
        *state.host.lock().await = Some(host.clone());
        runtime::wait_for_services(&host).await?;
        let _ = app.emit("startup-status", "Loading Applio…");
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| anyhow::anyhow!("Main window is missing"))?;
        window.navigate("http://127.0.0.1:3000/".parse()?)?;
        tokio::time::timeout(std::time::Duration::from_secs(30), async {
            while !state.ready.load(Ordering::SeqCst) {
                // notify_one retains a permit if the page finishes between
                // checking ready and registering this waiter.
                state.interface_loaded.notified().await;
            }
        })
        .await
        .map_err(|_| anyhow::anyhow!("The interface did not finish loading. Retry startup."))?;
        Ok(())
    }
    .await;
    state.starting.store(false, Ordering::SeqCst);
    if let Err(error) = result {
        state.stop().await;
        let message = format!(
            "{error:#}\n\nLauncher log: {}",
            state.paths.config.join("app-logs/launcher.log").display()
        );
        *state.startup_error.lock().unwrap() = Some(message.clone());
        let _ = app.emit("startup-error", &message);
        let _ = tray::refresh(&app);
        return Err(message);
    }
    let _ = tray::refresh(&app);
    Ok(())
}

#[tauri::command]
async fn retry_startup(app: AppHandle) -> Result<(), String> {
    startup(app).await
}

#[tauri::command]
async fn startup_error(state: State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state.startup_error.lock().unwrap().clone())
}

#[tauri::command]
async fn window_action(
    window: WebviewWindow,
    app: AppHandle,
    action: String,
    url: Option<String>,
) -> Result<Value, String> {
    let result: tauri::Result<Value> = (|| {
        match action.as_str() {
            "minimize" => window.minimize()?,
            "toggle-maximize" => {
                if window.is_maximized()? {
                    window.unmaximize()?
                } else {
                    window.maximize()?
                }
            }
            "toggle-fullscreen" => window.set_fullscreen(!window.is_fullscreen()?)?,
            "close" => window.close()?,
            "is-maximized" => return Ok(json!(window.is_maximized()?)),
            "is-fullscreen" => return Ok(json!(window.is_fullscreen()?)),
            "open-external" => {
                let url = url
                    .as_deref()
                    .ok_or_else(|| tauri::Error::Anyhow(anyhow::anyhow!("Missing URL")))?;
                let parsed = tauri::Url::parse(url).map_err(|e| tauri::Error::Anyhow(e.into()))?;
                if !["https", "http"].contains(&parsed.scheme()) {
                    return Err(tauri::Error::Anyhow(anyhow::anyhow!(
                        "Only HTTP(S) links can be opened"
                    )));
                }
                app.opener()
                    .open_url(url, None::<&str>)
                    .map_err(|e| tauri::Error::Anyhow(e.into()))?;
            }
            _ => {
                return Err(tauri::Error::Anyhow(anyhow::anyhow!(
                    "Unknown window action"
                )))
            }
        }
        Ok(Value::Null)
    })();
    result.map_err(|e| e.to_string())
}

#[tauri::command]
async fn bridge_command(
    state: State<'_, AppState>,
    app: AppHandle,
    action: String,
    value: Option<String>,
) -> Result<Value, String> {
    if ![
        "status",
        "start",
        "stop",
        "invite",
        "copy-invite",
        "approve",
        "revoke",
    ]
    .contains(&action.as_str())
    {
        return Err("Unknown Bridge Mode command".into());
    }
    let host = state.host().await?;
    if action == "copy-invite" {
        let status = host.call("bridge:status", None).await?;
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis() as u64;
        if status["inviteExpiresAt"].as_u64().unwrap_or(0) <= now {
            return Err("Create a fresh invitation first".into());
        }
        app.clipboard()
            .write_text(status["link"].as_str().ok_or("No invitation link")?)
            .map_err(|e| e.to_string())?;
        return Ok(Value::Null);
    }
    host.call(&format!("bridge:{action}"), value).await
}

#[tauri::command]
async fn choose_folder(
    app: AppHandle,
    default_path: Option<String>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut dialog = app.dialog().file().set_title("Choose folder");
    if let Some(path) = default_path.filter(|path| std::path::Path::new(path).is_absolute()) {
        dialog = dialog.set_directory(path);
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    dialog.pick_folder(move |folder| {
        let _ = sender.send(folder.map(|f| f.to_string()));
    });
    receiver.await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn restart_after_setup(
    app: AppHandle,
    state: State<'_, AppState>,
    job_id: String,
) -> Result<(), String> {
    state
        .host()
        .await?
        .call("setup:validate", Some(job_id))
        .await?;
    let handle = app.clone();
    // Allow the invoke reply to reach the setup screen before stopping services.
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        handle.state::<AppState>().stop().await;
        handle.restart();
    });
    Ok(())
}

#[tauri::command]
async fn notify_job(
    app: AppHandle,
    state: State<'_, AppState>,
    value: Value,
) -> Result<bool, String> {
    let id = value["id"].as_str().ok_or("Missing job ID")?;
    let href = value["href"].as_str().ok_or("Missing job link")?;
    let title = value["title"].as_str().ok_or("Missing title")?;
    let body = value["body"].as_str().ok_or("Missing body")?;
    if id.len() > 100
        || id.is_empty()
        || !id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        || href != format!("/jobs/{id}")
    {
        return Err("Invalid job notification".into());
    }
    let mut notified = state.notified.lock().unwrap();
    if notified.contains(id) {
        return Ok(false);
    }
    app.notification()
        .builder()
        .extra("href", href)
        .title(format!(
            "Applio Â· {}",
            title.chars().take(100).collect::<String>()
        ))
        .body(body.chars().take(300).collect::<String>())
        .show()
        .map_err(|e| e.to_string())?;
    if notified.len() >= 500 {
        notified.clear();
    }
    notified.insert(id.to_owned());
    Ok(true)
}

#[tauri::command]
async fn set_passthrough_hotkey(
    app: AppHandle,
    state: State<'_, AppState>,
    accelerator: String,
) -> Result<Value, String> {
    if accelerator.len() > 80 {
        return Ok(json!({"registered": false}));
    }
    let mut current = state.hotkey.lock().unwrap();
    if *current == accelerator {
        return Ok(json!({"registered": true}));
    }
    if !accelerator.is_empty() {
        if !accelerator.contains('+') {
            return Ok(json!({"registered": false}));
        }
        if app
            .global_shortcut()
            .on_shortcut(accelerator.as_str(), |app, _, event| {
                if event.state() == ShortcutState::Pressed {
                    let state = app.state::<AppState>();
                    let realtime = state.realtime.lock().unwrap();
                    if realtime.as_ref().is_some_and(|(value, at)| {
                        at.elapsed().as_secs() < 10 && value["streaming"] == true
                    }) {
                        let _ = app.emit("realtime-command", "passthrough-toggle");
                    }
                }
            })
            .is_err()
        {
            return Ok(json!({"registered": false}));
        }
    }
    if !current.is_empty() {
        let _ = app.global_shortcut().unregister(current.as_str());
    }
    *current = accelerator;
    Ok(json!({"registered": true}))
}

#[tauri::command]
async fn report_realtime_state(
    app: AppHandle,
    state: State<'_, AppState>,
    state_value: Option<Value>,
) -> Result<(), String> {
    // state_value is renamed to `state` in JS below to avoid a state injection collision.
    let valid = state_value.filter(|value| {
        ["connecting", "streaming", "muted", "monitor"]
            .iter()
            .all(|key| value[key].is_boolean())
            && value["model"].as_str().is_some_and(|v| v.len() <= 4096)
            && ["processingMs", "roundTripMs"].iter().all(|key| {
                value[key]
                    .as_f64()
                    .is_some_and(|v| (0.0..=120000.0).contains(&v))
            })
    });
    *state.realtime.lock().unwrap() = valid.map(|value| (value, Instant::now()));
    tray::refresh(&app).map_err(|e| e.to_string())
}

fn main() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| focus(app)))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            window_action,
            bridge_command,
            choose_folder,
            restart_after_setup,
            notify_job,
            set_passthrough_hotkey,
            report_realtime_state,
            updater::updater_command,
            retry_startup,
            startup_error
        ])
        .setup(|app| {
            let paths = Paths::resolve(app.handle())?;
            app.handle().plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_filename(
                        paths
                            .config
                            .join("tauri-window-state.json")
                            .to_string_lossy()
                            .into_owned(),
                    )
                    .with_denylist(&["splash"])
                    .with_state_flags(
                        tauri_plugin_window_state::StateFlags::SIZE
                            | tauri_plugin_window_state::StateFlags::POSITION
                            | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                    )
                    .build(),
            )?;
            app.manage(AppState {
                paths,
                host: tokio::sync::Mutex::new(None),
                server: Mutex::new(None),
                starting: AtomicBool::new(false),
                quitting: AtomicBool::new(false),
                ready: AtomicBool::new(false),
                interface_loaded: tokio::sync::Notify::new(),
                startup_error: Mutex::new(None),
                hotkey: Mutex::new(String::new()),
                realtime: Mutex::new(None),
                notified: Mutex::new(HashSet::new()),
                updates: tokio::sync::Mutex::new(updater::UpdateState::default()),
            });
            let platform = if cfg!(windows) {
                "win32"
            } else if cfg!(target_os = "macos") {
                "darwin"
            } else {
                "linux"
            };
            let bridge = include_str!("bridge.js")
                .replace("__APPLIO_PLATFORM__", &serde_json::to_string(platform)?);
            let window =
                tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Applio")
                    .inner_size(1280.0, 860.0)
                    .min_inner_size(960.0, 640.0)
                    .visible(false)
                    .data_directory(app.state::<AppState>().paths.config.join("session"))
                    .additional_browser_args(WEBVIEW_ARGS)
                    .devtools(false)
                    .initialization_script(desktop_policy::SCRIPT)
                    .initialization_script(&bridge)
                    .on_page_load(|window, payload| {
                        if payload.event() == tauri::webview::PageLoadEvent::Finished
                            && payload.url().origin().ascii_serialization()
                                == "http://127.0.0.1:3000"
                        {
                            let state = window.state::<AppState>();
                            if state.startup_error.lock().unwrap().is_some() {
                                return;
                            }
                            state.ready.store(true, Ordering::SeqCst);
                            state.interface_loaded.notify_one();
                            let _ = window.show();
                            let _ = window.set_focus();
                            if let Some(splash) = window.app_handle().get_webview_window("splash") {
                                let _ = splash.destroy();
                            }
                            let _ = tray::refresh(window.app_handle());
                        }
                    })
                    .on_navigation(|url| {
                        // The native bridge is granted to this exact origin only.
                        url.as_str() == "about:blank"
                            || url.scheme() == "tauri"
                            || (url.scheme() == "http" && url.host_str() == Some("tauri.localhost"))
                            || url.origin().ascii_serialization() == "http://127.0.0.1:3000"
                    })
                    .build()?;
            desktop_policy::apply(&window)?;
            let handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let state = handle.state::<AppState>();
                    if state.ready.load(Ordering::SeqCst) && !state.quitting.load(Ordering::SeqCst)
                    {
                        api.prevent_close();
                        if let Some(window) = handle.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                }
                tauri::WindowEvent::Resized(_) => {
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.emit(
                            "window-maximize-changed",
                            window.is_maximized().unwrap_or(false),
                        );
                    }
                }
                _ => {}
            });
            show_splash(app.handle())?;
            tray::create(app.handle())?;
            let notification_handle = app.handle().clone();
            app.notification().on_action(move |event| {
                if event.action_id() != "tap" {
                    return;
                }
                let Some(notification) = event.notification() else {
                    return;
                };
                let Some(href) = notification.extra().get("href").and_then(Value::as_str) else {
                    return;
                };
                if href == "/settings"
                    || (href.starts_with("/jobs/") && !href.contains(['\\', '?', '#']))
                {
                    focus(&notification_handle);
                    let event = if href.starts_with("/jobs/") {
                        "job-open"
                    } else {
                        "app-navigate"
                    };
                    let _ = notification_handle.emit(event, href);
                }
            })?;
            let handle = app.handle().clone();
            app.listen("host-stopped", move |_| {
                if handle
                    .state::<AppState>()
                    .ready
                    .swap(false, Ordering::SeqCst)
                {
                    let message =
                        "An application service stopped. Check the launcher log, then retry."
                            .to_string();
                    *handle.state::<AppState>().startup_error.lock().unwrap() = Some(message);
                    if let Some(window) = handle.get_webview_window("main") {
                        let url = if cfg!(windows) {
                            "http://tauri.localhost/index.html"
                        } else {
                            "tauri://localhost/index.html"
                        };
                        if let Ok(url) = url.parse() {
                            let _ = window.navigate(url);
                        }
                    }
                    focus(&handle);
                    let cleanup = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        cleanup.state::<AppState>().stop().await;
                    });
                }
            });
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = startup(handle).await;
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("could not initialize Applio");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            let state = app.state::<AppState>();
            if !state.quitting.swap(true, Ordering::SeqCst) {
                api.prevent_exit();
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    handle.state::<AppState>().stop().await;
                    handle.exit(0);
                });
            }
        }
    });
}
