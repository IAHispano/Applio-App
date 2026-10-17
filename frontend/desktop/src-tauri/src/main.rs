#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
mod desktop_policy;
mod language;
mod logging;
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

// Keep realtime audio timers reliable while allowing Chromium to reduce
// rendering work and priority when the window is covered or minimized.
const WEBVIEW_ARGS: &str =
    "--autoplay-policy=no-user-gesture-required --disable-background-timer-throttling";

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
    stopped: AtomicBool,
    quit_deadline: Mutex<Option<Instant>>,
    ready: AtomicBool,
    tray_ready: AtomicBool,
    interface_loaded: tokio::sync::Notify,
    startup_error: Mutex<Option<String>>,
    hotkey: Mutex<String>,
    realtime: Mutex<Option<(Value, Instant)>>,
    notified: Mutex<HashSet<String>>,
    updates: updater::UpdateState,
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

fn valid_job_link(href: &str) -> bool {
    href.strip_prefix("/jobs/view?id=")
        .or_else(|| href.strip_prefix("/jobs/"))
        .is_some_and(|id| {
            !id.is_empty()
                && id.len() <= 100
                && id
                    .chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
        })
}

fn focus(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// True while background work keeps the app useful after the window closes.
/// Closing hides to the tray only in that case; otherwise it quits, so users
/// are never left with a process they cannot exit.
async fn services_busy(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    if !state.ready.load(Ordering::SeqCst) {
        return false;
    }
    let realtime = state.realtime.lock().unwrap().clone();
    let active_stream = realtime
        .as_ref()
        .filter(|(_, at)| at.elapsed().as_secs() < 10)
        .is_some_and(|(value, _)| value["streaming"] == true || value["connecting"] == true);
    if active_stream {
        return true;
    }
    if let Ok(host) = state.host().await {
        if let Ok(status) = host.call("bridge:status", None).await {
            if matches!(status["status"].as_str(), Some("starting" | "sharing")) {
                return true;
            }
        }
    }
    let Ok(client) = reqwest::Client::builder()
        .no_proxy()
        .timeout(std::time::Duration::from_secs(2))
        .build()
    else {
        return false;
    };
    let Ok(response) = client.get("http://127.0.0.1:8000/api/jobs").send().await else {
        return false;
    };
    let Ok(value) = response.json::<Value>().await else {
        return false;
    };
    let scheduling = &value["scheduling"];
    let live_job = value["jobs"].as_array().is_some_and(|jobs| {
        jobs.iter()
            .any(|job| matches!(job["status"].as_str(), Some("queued" | "running")))
    });
    live_job
        || scheduling["realtime"] == true
        || scheduling["active"]
            .as_array()
            .is_some_and(|list| !list.is_empty())
        || scheduling["queued"]
            .as_array()
            .is_some_and(|list| !list.is_empty())
}

/// Explain, once per installation, why the window closed to the tray and how to
/// exit the app completely.
fn tray_hint(app: &AppHandle) {
    let state = app.state::<AppState>();
    let marker = state.paths.config.join("tray-hint-shown");
    if marker.exists() {
        return;
    }
    let _ = std::fs::write(&marker, b"1");
    use tauri_plugin_notification::NotificationExt;
    let (_, dictionary) = crate::language::load(&state.paths.code, &state.paths.config);
    let translate = |key: &str| {
        dictionary[key]
            .as_str()
            .filter(|value| !value.is_empty())
            .unwrap_or(key)
            .to_owned()
    };
    let _ = app
        .notification()
        .builder()
        .title(translate("Applio keeps running in the background"))
        .body(translate(
            "Realtime, jobs, or Bridge Mode are still active. Click the tray icon to reopen the window, or right-click it and choose Quit Applio to exit completely.",
        ))
        .show();
}

fn show_startup_error(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let url = if cfg!(windows) {
            "http://tauri.localhost/index.html"
        } else {
            "tauri://localhost/index.html"
        };
        if let Ok(url) = url.parse() {
            let _ = window.navigate(url);
        }
        focus(app);
    }
}

async fn startup(app: AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();
    if state.starting.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    *state.startup_error.lock().unwrap() = None;
    logging::write(&state.paths.config, "Starting native application services");
    let result: anyhow::Result<()> = async {
        state.stop().await;
        // Reserve the public API before starting any worker. A conflicting
        // instance must never load somebody else's loopback UI with native IPC.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:8000").await?;
        let web_reservation = tokio::net::TcpListener::bind("127.0.0.1:3000").await?;
        let environment = runtime::prepare(&state.paths)?;
        let config = applio_api::ApiConfig {
            code_root: state.paths.code.clone(),
            data_root: state.paths.data.clone(),
            config_dir: state.paths.config.clone(),
        };
        let stop = tokio_util::sync::CancellationToken::new();
        let server_stop = stop.clone();
        let server_env = environment.clone();
        let handle = app.clone();
        let (failed, mut failure) = tokio::sync::oneshot::channel();
        *state.server.lock().unwrap() = Some((
            stop,
            tauri::async_runtime::spawn(async move {
                let result = applio_api::native_host::serve_with_ui(
                    listener,
                    Some(web_reservation),
                    config,
                    server_stop.clone(),
                    server_env,
                )
                .await;
                if !server_stop.is_cancelled() {
                    let message = match result {
                        Ok(()) => "Native application services stopped unexpectedly".to_string(),
                        Err(error) => format!("Native application services failed: {error:#}"),
                    };
                    logging::write(&handle.state::<AppState>().paths.config, &message);
                    let _ = failed.send(message.clone());
                    let _ = handle.emit("host-stopped", &message);
                }
            }),
        ));
        let host = Host::start(app.clone(), &state.paths).await?;
        *state.host.lock().await = Some(host.clone());
        tokio::select! {
            result = runtime::wait_for_services() => result?,
            message = &mut failure => anyhow::bail!(message.unwrap_or_else(|_| "Native application services stopped during startup".into())),
        }
        let window = app
            .get_webview_window("main")
            .ok_or_else(|| anyhow::anyhow!("Main window is missing"))?;
        window.navigate("http://127.0.0.1:3000/".parse()?)?;
        let loaded = tokio::time::timeout(std::time::Duration::from_secs(30), async {
            while !state.ready.load(Ordering::SeqCst) {
                // notify_one retains a permit if the page finishes between
                // checking ready and registering this waiter.
                state.interface_loaded.notified().await;
            }
        });
        tokio::select! {
            result = loaded => result.map_err(|_| anyhow::anyhow!("The interface did not finish loading. Retry startup."))?,
            message = &mut failure => anyhow::bail!(message.unwrap_or_else(|_| "Native application services stopped during startup".into())),
        }
        Ok(())
    }
    .await;
    state.starting.store(false, Ordering::SeqCst);
    if let Err(error) = result {
        logging::write(&state.paths.config, &format!("Startup failed: {error:#}"));
        state.stop().await;
        let message = format!(
            "{error:#}\n\nLauncher log: {}",
            state.paths.config.join("app-logs/launcher.log").display()
        );
        *state.startup_error.lock().unwrap() = Some(message.clone());
        let _ = app.emit("startup-error", &message);
        show_startup_error(&app);
        let _ = tray::refresh(&app);
        return Err(message);
    }
    let _ = tray::refresh(&app);
    logging::write(&state.paths.config, "Interface ready");
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

/// Quit request from the in-app Settings card; runs the same cleanup gate as
/// the tray Quit item so services and the realtime port are released.
#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
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
        || (href != format!("/jobs/{id}") && href != format!("/jobs/view?id={id}"))
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
            "Applio \u{00b7} {}",
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
    let next = valid.map(|value| (value, Instant::now()));
    let changed = {
        let mut current = state.realtime.lock().unwrap();
        // Heartbeats repeat unchanged snapshots to keep the freshness window
        // open; rebuilding the tray menu for those can close it while the user
        // is aiming at an item, so only changed states reach the tray.
        let changed =
            current.as_ref().map(|(value, _)| value) != next.as_ref().map(|(value, _)| value);
        *current = next;
        changed
    };
    if !changed {
        return Ok(());
    }
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
            startup_error,
            quit_app
        ])
        .setup(|app| {
            let paths = Paths::resolve(app.handle())?;
            logging::write(
                &paths.config,
                concat!("Applio ", env!("CARGO_PKG_VERSION"), " launched"),
            );
            let panic_config = paths.config.clone();
            let previous_hook = std::panic::take_hook();
            std::panic::set_hook(Box::new(move |panic| {
                logging::write(&panic_config, &format!("Native panic: {panic}"));
                previous_hook(panic);
            }));
            app.handle().plugin(
                tauri_plugin_window_state::Builder::default()
                    .with_filename(
                        paths
                            .config
                            .join("tauri-window-state.json")
                            .to_string_lossy()
                            .into_owned(),
                    )
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
                stopped: AtomicBool::new(false),
                quit_deadline: Mutex::new(None),
                ready: AtomicBool::new(false),
                tray_ready: AtomicBool::new(false),
                interface_loaded: tokio::sync::Notify::new(),
                startup_error: Mutex::new(None),
                hotkey: Mutex::new(String::new()),
                realtime: Mutex::new(None),
                notified: Mutex::new(HashSet::new()),
                updates: updater::UpdateState::default(),
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
            let tensorboard_port = applio_api::tensorboard_routes::configured_port();
            let window =
                tauri::WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .title("Applio")
                    .inner_size(1280.0, 860.0)
                    .min_inner_size(960.0, 640.0)
                    .visible(false)
                    .background_color(tauri::webview::Color(6, 6, 6, 255))
                    .data_directory(app.state::<AppState>().paths.config.join("session"))
                    .additional_browser_args(WEBVIEW_ARGS)
                    // The React upload controls handle HTML5 file drops.
                    .disable_drag_drop_handler()
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
                            let _ = tray::refresh(window.app_handle());
                        }
                    })
                    .on_navigation(move |url| {
                        desktop_policy::navigation_allowed(url, tensorboard_port)
                    })
                    .on_permission_request(|webview, kind| {
                        let url = webview.url().ok();
                        desktop_policy::permission_response(url.as_ref(), kind)
                    })
                    .build()?;
            desktop_policy::apply(&window)?;
            let handle = app.handle().clone();
            window.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    // While background work is active the window hides to the
                    // tray; otherwise closing really quits.
                    if handle.state::<AppState>().quitting.load(Ordering::SeqCst) {
                        return;
                    }
                    api.prevent_close();
                    let handle = handle.clone();
                    tauri::async_runtime::spawn(async move {
                        // Hiding is only safe when a tray icon can bring the
                        // window back; without one, closing always quits.
                        let tray_ready =
                            handle.state::<AppState>().tray_ready.load(Ordering::SeqCst);
                        if tray_ready && services_busy(&handle).await {
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.hide();
                            }
                            tray_hint(&handle);
                        } else {
                            // The window disappears immediately; cleanup runs
                            // behind the scenes before the process exits.
                            if let Some(window) = handle.get_webview_window("main") {
                                let _ = window.hide();
                            }
                            handle.exit(0);
                        }
                    });
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
            if let Err(error) = tray::create(app.handle()) {
                // A missing tray must not block the app; closing the window
                // falls back to quitting when no tray icon is available.
                logging::write(
                    &app.state::<AppState>().paths.config,
                    &format!("System tray unavailable: {error}"),
                );
            }
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
                if href == "/settings" || valid_job_link(href) {
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
            app.listen("host-stopped", move |event| {
                if handle
                    .state::<AppState>()
                    .ready
                    .swap(false, Ordering::SeqCst)
                {
                    let detail = serde_json::from_str::<String>(event.payload())
                        .unwrap_or_else(|_| "Native application services stopped".into());
                    let message = format!(
                        "{detail}\n\nLauncher log: {}",
                        handle
                            .state::<AppState>()
                            .paths
                            .config
                            .join("app-logs/launcher.log")
                            .display()
                    );
                    *handle.state::<AppState>().startup_error.lock().unwrap() = Some(message);
                    show_startup_error(&handle);
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
        // macOS: clicking the dock icon while the window is hidden reopens it.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = event {
            focus(app);
        }
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            let state = app.state::<AppState>();
            if state.stopped.load(Ordering::SeqCst) {
                return;
            }
            // A second quit request while cleanup is running must not abandon
            // child processes; only a stalled shutdown may be forced through.
            let stalled = state
                .quit_deadline
                .lock()
                .unwrap()
                .is_some_and(|started| started.elapsed() > std::time::Duration::from_secs(30));
            if stalled {
                return;
            }
            api.prevent_exit();
            if !state.quitting.swap(true, Ordering::SeqCst) {
                *state.quit_deadline.lock().unwrap() = Some(Instant::now());
                let handle = app.clone();
                tauri::async_runtime::spawn(async move {
                    let state = handle.state::<AppState>();
                    // Quitting must always finish: stopping talks to child
                    // processes and the OS, and a service that refuses to stop
                    // must not leave the app unquittable.
                    let _ = tokio::time::timeout(std::time::Duration::from_secs(30), state.stop())
                        .await;
                    state.stopped.store(true, Ordering::SeqCst);
                    handle.exit(0);
                });
            }
        }
    });
}
