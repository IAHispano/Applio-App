use crate::{focus, AppState};
use serde_json::Value;
use std::time::Instant;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager,
};
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct RealtimeSnapshot {
    pub(crate) streaming: bool,
    connecting: bool,
    model_name: Option<String>,
    muted: bool,
    monitor: bool,
    timings: Option<[u32; 2]>,
}

impl RealtimeSnapshot {
    pub(crate) fn from_report(value: &Value) -> Option<Self> {
        let streaming = value["streaming"].as_bool()?;
        let model = value["model"].as_str().filter(|name| name.len() <= 4096)?;
        let milliseconds = |key: &str| {
            value[key]
                .as_f64()
                .filter(|v| (0.0..=120000.0).contains(v))
                .map(|v| v.round_ties_even() as u32)
        };
        // Compare exactly the values the menu displays, including integer timings.
        let timings = [milliseconds("processingMs")?, milliseconds("roundTripMs")?];
        let muted = value["muted"].as_bool()?;
        let monitor = value["monitor"].as_bool()?;
        Some(Self {
            streaming,
            connecting: value["connecting"].as_bool()?,
            model_name: (!model.is_empty())
                .then(|| model.rsplit(['/', '\\']).next().unwrap_or(model).to_owned()),
            muted: streaming && muted,
            monitor: streaming && monitor,
            timings: streaming.then_some(timings),
        })
    }
}

pub(crate) fn fresh_realtime(
    state: &Option<(RealtimeSnapshot, Instant)>,
) -> Option<&RealtimeSnapshot> {
    state
        .as_ref()
        .filter(|(_, at)| at.elapsed().as_secs() < 10)
        .map(|(snapshot, _)| snapshot)
}

fn menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let state = app.state::<AppState>();
    let (_, dictionary) = crate::language::load(&state.paths.code, &state.paths.config);
    let translate = |key: &str| {
        dictionary[key]
            .as_str()
            .filter(|value| !value.is_empty())
            .unwrap_or(key)
            .to_owned()
    };
    // Native menu creation can enter the platform event loop. Do not hold the
    // state lock while constructing it or block incoming realtime heartbeats.
    let realtime = fresh_realtime(&state.realtime.lock().unwrap()).cloned();
    let snapshot = realtime.as_ref();
    let active = snapshot.is_some_and(|value| value.streaming);
    let connecting = snapshot.is_some_and(|value| value.connecting);
    let available = state.ready.load(std::sync::atomic::Ordering::SeqCst);
    let status = if !available {
        "Service unavailable"
    } else if active {
        "Realtime active"
    } else if connecting {
        "Starting realtime…"
    } else {
        "Realtime stopped"
    };
    let item = |id: &str, key: &str, enabled| {
        MenuItem::with_id(app, id, translate(key), enabled, None::<&str>)
    };
    let separator = || PredefinedMenuItem::separator(app);
    let check = |id: &str, key: &str, enabled, checked| {
        CheckMenuItem::with_id(app, id, translate(key), enabled, checked, None::<&str>)
    };
    let window = app.get_webview_window("main");
    let visible = window
        .as_ref()
        .is_some_and(|window| window.is_visible().unwrap_or(false));
    let always_on_top = window
        .as_ref()
        .is_some_and(|window| window.is_always_on_top().unwrap_or(false));
    menu.append(&MenuItem::with_id(
        app,
        "status",
        format!("Applio · {}", translate(status)),
        false,
        None::<&str>,
    )?)?;
    menu.append(&separator()?)?;
    menu.append(&item("show", "Open Applio", true)?)?;

    let realtime_menu = Submenu::with_id(app, "realtime-menu", translate("Realtime"), true)?;
    realtime_menu.append(&item("realtime-status", status, false)?)?;
    if let Some(name) = snapshot.and_then(|value| value.model_name.as_deref()) {
        realtime_menu.append(&MenuItem::with_id(
            app,
            "realtime-model",
            format!("{}: {name}", translate("Voice model")),
            false,
            None::<&str>,
        )?)?;
    }
    if let Some([processing, round_trip]) = snapshot.and_then(|value| value.timings) {
        for (id, key, milliseconds) in [
            ("realtime-processing", "Processing", processing),
            ("realtime-roundtrip", "Round trip", round_trip),
        ] {
            realtime_menu.append(&MenuItem::with_id(
                app,
                id,
                format!("{}: {milliseconds} ms", translate(key)),
                false,
                None::<&str>,
            )?)?;
        }
    }
    realtime_menu.append(&separator()?)?;
    realtime_menu.append(&item("page:realtime", "Open Realtime", !connecting)?)?;
    realtime_menu.append(&item(
        "rt:start",
        "Start Realtime",
        available && !active && !connecting,
    )?)?;
    realtime_menu.append(&item("rt:stop", "Stop Realtime", active && !connecting)?)?;
    realtime_menu.append(&separator()?)?;
    realtime_menu.append(&item(
        "rt:passthrough-toggle",
        "Passthrough",
        active && !connecting,
    )?)?;
    let muted = snapshot.is_some_and(|value| value.muted);
    let monitor = snapshot.is_some_and(|value| value.monitor);
    realtime_menu.append(&check(
        if muted { "rt:unmute" } else { "rt:mute" },
        "Mute microphone",
        active && !connecting,
        muted,
    )?)?;
    realtime_menu.append(&check(
        if monitor {
            "rt:monitor-off"
        } else {
            "rt:monitor-on"
        },
        "Local monitor",
        active && !connecting,
        monitor,
    )?)?;
    menu.append(&realtime_menu)?;

    let studio = Submenu::with_id(app, "studio-menu", translate("Studio"), true)?;
    for (id, key) in [
        ("page:inference", "Convert Audio"),
        ("page:tts", "Text to Speech"),
        ("page:audio-separator", "Audio Separator"),
    ] {
        studio.append(&item(id, key, !connecting)?)?;
    }
    studio.append(&separator()?)?;
    for (id, key) in [
        ("page:models", "Models"),
        ("page:train", "Training"),
        ("page:tensorboard", "TensorBoard"),
    ] {
        studio.append(&item(id, key, !connecting)?)?;
    }
    studio.append(&separator()?)?;
    studio.append(&item("page:jobs", "Jobs", !connecting)?)?;
    studio.append(&item("page:extra", "Audio Tools", !connecting)?)?;
    menu.append(&studio)?;

    let window_menu = Submenu::with_id(app, "window-menu", translate("Window"), true)?;
    window_menu.append(&item("window:show", "Open Applio", true)?)?;
    window_menu.append(&item("hide", "Hide to tray", visible)?)?;
    window_menu.append(&check("top", "Always on top", true, always_on_top)?)?;
    menu.append(&window_menu)?;

    let folders = Submenu::with_id(app, "folders-menu", translate("Folders"), true)?;
    for (id, key) in [
        ("folder:models", "Voice models"),
        ("folder:outputs", "Audio outputs"),
        ("folder:logs", "App logs"),
        ("folder:preferences", "Preferences folder"),
    ] {
        folders.append(&item(id, key, true)?)?;
    }
    menu.append(&folders)?;
    menu.append(&separator()?)?;
    menu.append(&item("page:settings", "Settings", !connecting)?)?;
    menu.append(&item("page:report", "Report a problem", !connecting)?)?;
    menu.append(&separator()?)?;
    menu.append(&item("quit", "Quit Applio", true)?)?;
    Ok(menu)
}
pub fn refresh(app: &AppHandle) -> tauri::Result<()> {
    if let Some(tray) = app.tray_by_id("applio") {
        tray.set_menu(Some(menu(app)?))?;
    }
    Ok(())
}
pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let mut builder = TrayIconBuilder::with_id("applio")
        .tooltip("Applio")
        .menu(&menu(app)?)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                focus(tray.app_handle());
                let _ = refresh(tray.app_handle());
            }
        })
        .on_menu_event(|app, event| {
            let id = event.id().as_ref();
            if let Some(command) = id.strip_prefix("rt:") {
                let _ = app.emit("realtime-command", command);
            } else if let Some(page) = id.strip_prefix("page:") {
                focus(app);
                let _ = app.emit("app-navigate", format!("/{page}"));
            } else if let Some(kind) = id.strip_prefix("folder:") {
                let state = app.state::<AppState>();
                let folder = match kind {
                    "models" => {
                        let config: Value = std::fs::read(state.paths.config.join("config.json"))
                            .ok()
                            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
                            .unwrap_or(Value::Null);
                        config["logs_dir"]
                            .as_str()
                            .filter(|s| !s.is_empty())
                            .map(std::path::PathBuf::from)
                            .unwrap_or_else(|| state.paths.data.join("logs"))
                    }
                    "outputs" => state.paths.data.join("assets/audios"),
                    "logs" => state.paths.config.join("app-logs"),
                    _ => state.paths.config.clone(),
                };
                if std::fs::create_dir_all(&folder).is_ok() {
                    let _ = app
                        .opener()
                        .open_path(folder.to_string_lossy(), None::<&str>);
                }
            } else {
                match id {
                    "show" | "window:show" => focus(app),
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "top" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window
                                .set_always_on_top(!window.is_always_on_top().unwrap_or(false));
                        }
                    }
                    "quit" => {
                        if let Some(tray) = app.tray_by_id("applio") {
                            let _ = tray.set_tooltip(Some("Applio · Quitting…"));
                        }
                        app.exit(0);
                    }
                    _ => {}
                }
            }
            // Rebuilding the menu while the app shuts down can stall the exit.
            if id != "quit" {
                let _ = refresh(app);
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    app.state::<AppState>()
        .tray_ready
        .store(true, std::sync::atomic::Ordering::SeqCst);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::time::Duration;

    #[test]
    fn realtime_menu_snapshot_tracks_displayed_timings_and_controls() {
        let mut report = json!({
            "streaming": true, "connecting": false, "model": "logs/voice.pth",
            "muted": false, "monitor": false, "processingMs": 12.1, "roundTripMs": 19.8,
        });
        let original = RealtimeSnapshot::from_report(&report).unwrap();
        assert_eq!(original.model_name.as_deref(), Some("voice.pth"));
        assert_eq!(original.timings, Some([12, 20]));
        report["processingMs"] = json!(12.5);
        report["roundTripMs"] = json!(20.4);
        assert_eq!(
            RealtimeSnapshot::from_report(&report),
            Some(original.clone())
        );
        report["processingMs"] = json!(12.51);
        assert_ne!(
            RealtimeSnapshot::from_report(&report),
            Some(original.clone())
        );
        report["processingMs"] = json!(12.0);
        report["muted"] = json!(true);
        assert_ne!(RealtimeSnapshot::from_report(&report), Some(original));

        report["streaming"] = json!(false);
        let stopped = RealtimeSnapshot::from_report(&report).unwrap();
        report["processingMs"] = json!(257.0);
        report["muted"] = json!(false);
        assert_eq!(RealtimeSnapshot::from_report(&report), Some(stopped));
        report["roundTripMs"] = json!(120001);
        assert!(RealtimeSnapshot::from_report(&report).is_none());
    }

    #[test]
    fn expired_realtime_reports_are_unavailable_to_the_menu_and_hotkey() {
        let snapshot = RealtimeSnapshot {
            streaming: true,
            connecting: false,
            model_name: None,
            muted: false,
            monitor: false,
            timings: Some([12, 20]),
        };
        let fresh = Some((snapshot.clone(), Instant::now()));
        assert_eq!(fresh_realtime(&fresh), Some(&snapshot));
        let expired = Some((snapshot, Instant::now() - Duration::from_secs(11)));
        assert!(fresh_realtime(&expired).is_none());
    }
}
