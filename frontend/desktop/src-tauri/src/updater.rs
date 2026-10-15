use crate::AppState;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct UpdateState {
    status: Value,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}
impl Default for UpdateState {
    fn default() -> Self {
        Self {
            status: if cfg!(debug_assertions) {
                json!({"status": "dev-mode", "message": "Updates are disabled in development."})
            } else {
                json!({"status": "idle"})
            },
            update: None,
            bytes: None,
        }
    }
}
fn publish(app: &AppHandle, state: &mut UpdateState, status: Value) -> Value {
    state.status = status.clone();
    let _ = app.emit("updater-status", &status);
    status
}
#[tauri::command]
pub async fn updater_command(
    app: AppHandle,
    state: State<'_, AppState>,
    action: String,
) -> Result<Value, String> {
    let mut updates = state.updates.lock().await;
    if action == "status" || cfg!(debug_assertions) {
        return Ok(updates.status.clone());
    }
    let result: Result<Value, String> = async {
        match action.as_str() {
            "check" => {
                let key = option_env!("APPLIO_UPDATER_PUBLIC_KEY").filter(|k| !k.is_empty())
                    .ok_or("Signed updates are not configured for this build. Download the installer from the releases page.")?;
                publish(&app, &mut updates, json!({"status": "checking"}));
                let updater = app.updater_builder().pubkey(key)
                    .endpoints(vec!["https://github.com/IAHispano/Applio-App/releases/latest/download/latest.json".parse().map_err(|e| format!("{e}"))?])
                    .map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
                let update = updater.check().await.map_err(|e| e.to_string())?;
                updates.bytes = None;
                if let Some(update) = update {
                    let status = json!({"status": "available", "version": update.version});
                    updates.update = Some(update);
                    Ok(publish(&app, &mut updates, status))
                } else {
                    updates.update = None;
                    Ok(publish(&app, &mut updates, json!({"status": "not-available", "version": env!("CARGO_PKG_VERSION")})))
                }
            }
            "download" => {
                let update = updates.update.as_ref().ok_or("Check for updates first")?;
                let mut transferred = 0_u64;
                let started = std::time::Instant::now();
                let bytes = update.download(|chunk, total| {
                    transferred += chunk as u64;
                    let percent = total.filter(|n| *n > 0).map(|n| transferred as f64 / n as f64 * 100.0).unwrap_or(0.0);
                    let _ = app.emit("updater-status", json!({"status": "downloading", "percent": percent,
                        "transferred": transferred, "total": total.unwrap_or(0),
                        "bytesPerSecond": transferred as f64 / started.elapsed().as_secs_f64().max(0.001)}));
                }, || {}).await.map_err(|e| e.to_string())?;
                let version = update.version.clone();
                let notes = update.body.clone();
                updates.bytes = Some(bytes);
                Ok(publish(&app, &mut updates, json!({"status": "downloaded", "version": version, "releaseNotes": notes})))
            }
            "install" => {
                let bytes = updates.bytes.as_ref().ok_or("Download the update first")?;
                let update = updates.update.as_ref().ok_or("No update available")?;
                state.stop().await;
                update.install(bytes).map_err(|e| e.to_string())?;
                app.restart();
            }
            _ => Err("Unknown updater action".into()),
        }
    }.await;
    if let Err(message) = &result {
        publish(
            &app,
            &mut updates,
            json!({"status": "error", "message": message}),
        );
    }
    result
}
