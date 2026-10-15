use crate::AppState;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_updater::{Update, UpdaterExt};

pub struct UpdateState {
    status: std::sync::Mutex<Value>,
    operation: tokio::sync::Mutex<Operation>,
}
#[derive(Default)]
struct Operation {
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}
impl Default for UpdateState {
    fn default() -> Self {
        Self {
            status: std::sync::Mutex::new(if cfg!(debug_assertions) {
                json!({"status": "dev-mode", "message": "Updates are disabled in development."})
            } else {
                json!({"status": "idle"})
            }),
            operation: tokio::sync::Mutex::new(Operation::default()),
        }
    }
}
fn publish(app: &AppHandle, state: &UpdateState, status: Value) -> Value {
    *state.status.lock().unwrap() = status.clone();
    let _ = app.emit("updater-status", &status);
    status
}
#[tauri::command]
pub async fn updater_command(
    app: AppHandle,
    state: State<'_, AppState>,
    action: String,
) -> Result<Value, String> {
    let updates = &state.updates;
    if action == "status" || cfg!(debug_assertions) {
        return Ok(updates.status.lock().unwrap().clone());
    }
    let mut operation = updates.operation.lock().await;
    let result: Result<Value, String> = async {
        match action.as_str() {
            "check" => {
                let current = updates.status.lock().unwrap().clone();
                if current["status"] == "downloaded" {
                    return Ok(current);
                }
                let configured = app.config().plugins.0.get("updater").and_then(|value| value["pubkey"].as_str());
                let key = option_env!("APPLIO_UPDATER_PUBLIC_KEY").filter(|k| !k.is_empty()).or(configured).filter(|k| !k.is_empty())
                    .ok_or("Signed updates are not configured for this build. Download the installer from the releases page.")?;
                publish(&app, updates, json!({"status": "checking"}));
                let updater = app.updater_builder().pubkey(key)
                    .endpoints(vec!["https://github.com/IAHispano/Applio-App/releases/latest/download/latest.json".parse().map_err(|e| format!("{e}"))?])
                    .map_err(|e| e.to_string())?.build().map_err(|e| e.to_string())?;
                operation.bytes = None;
                operation.update = None;
                let update = updater.check().await.map_err(|e| e.to_string())?;
                if let Some(update) = update {
                    let status = json!({"status": "available", "version": update.version});
                    operation.update = Some(update);
                    Ok(publish(&app, updates, status))
                } else {
                    operation.update = None;
                    Ok(publish(&app, updates, json!({"status": "not-available", "version": env!("CARGO_PKG_VERSION")})))
                }
            }
            "download" => {
                operation.bytes = None;
                let update = operation.update.as_ref().ok_or("Check for updates first")?;
                let mut transferred = 0_u64;
                let started = std::time::Instant::now();
                let bytes = update.download(|chunk, total| {
                    transferred += chunk as u64;
                    let percent = total.filter(|n| *n > 0).map(|n| transferred as f64 / n as f64 * 100.0).unwrap_or(0.0);
                    publish(&app, updates, json!({"status": "downloading", "percent": percent,
                        "transferred": transferred, "total": total.unwrap_or(0),
                        "bytesPerSecond": transferred as f64 / started.elapsed().as_secs_f64().max(0.001)}));
                }, || {}).await.map_err(|e| e.to_string())?;
                let version = update.version.clone();
                let notes = update.body.clone();
                operation.bytes = Some(bytes);
                Ok(publish(&app, updates, json!({"status": "downloaded", "version": version, "releaseNotes": notes})))
            }
            "install" => {
                let bytes = operation.bytes.as_ref().ok_or("Download the update first")?;
                let update = operation.update.as_ref().ok_or("No update available")?;
                state.stop().await;
                if let Err(error) = update.install(bytes) {
                    let handle = app.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = crate::startup(handle).await {
                            eprintln!("Recovery after update install failure: {error}");
                        }
                    });
                    return Err(error.to_string());
                }
                #[cfg(not(windows))]
                app.restart();
                #[cfg(windows)]
                Ok(Value::Null)
            }
            _ => Err("Unknown updater action".into()),
        }
    }.await;
    if let Err(message) = &result {
        publish(
            &app,
            updates,
            json!({"status": "error", "message": message}),
        );
    }
    result
}

#[cfg(test)]
mod checks {
    use super::*;
    use axum::{routing::get, Json, Router};
    use std::sync::{Arc, Mutex};
    use tauri::test::{mock_builder, mock_context, noop_assets};

    /// Downloads a real signed installer through the actual updater plugin.
    /// Never runs the installer or opens a native window.
    #[tokio::test]
    #[ignore = "Requires APPLIO_UPDATE_ARTIFACT pointing to a signed release installer"]
    async fn signed_update_download_rejects_tampering_and_version_substitution() {
        let artifact = std::env::var("APPLIO_UPDATE_ARTIFACT").expect("Select a signed installer");
        let bytes = std::fs::read(&artifact).unwrap();
        let signature = std::fs::read_to_string(format!("{artifact}.sig")).unwrap();
        let config: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let version = config["version"].as_str().unwrap();
        let payload = Arc::new(Mutex::new(bytes.clone()));
        let manifest = Arc::new(Mutex::new(Value::Null));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let origin = format!("http://{}", listener.local_addr().unwrap());
        let feed = manifest.clone();
        let file = payload.clone();
        let router = Router::new()
            .route(
                "/latest.json",
                get(move || {
                    let feed = feed.clone();
                    async move { Json(feed.lock().unwrap().clone()) }
                }),
            )
            .route(
                "/installer.exe",
                get(move || {
                    let file = file.clone();
                    async move { file.lock().unwrap().clone() }
                }),
            );
        let server = tokio::spawn(async move {
            axum::serve(listener, router).await.unwrap();
        });
        *manifest.lock().unwrap() = json!({
            "version": version,
            "platforms": {"windows-x86_64": {
                "url": format!("{origin}/installer.exe"), "signature": signature.trim()
            }}
        });
        let mut context = mock_context(noop_assets());
        let mut updater_config = config["plugins"]["updater"].clone();
        // HTTP is allowed only inside this isolated loopback test.
        updater_config["dangerousInsecureTransportProtocol"] = json!(true);
        context
            .config_mut()
            .plugins
            .0
            .insert("updater".into(), updater_config);
        let app = mock_builder()
            .plugin(tauri_plugin_updater::Builder::new().build())
            .build(context)
            .unwrap();
        let updater = app
            .updater_builder()
            .target("windows-x86_64")
            .endpoints(vec![format!("{origin}/latest.json").parse().unwrap()])
            .unwrap()
            .no_proxy()
            .build()
            .unwrap();
        let update = updater.check().await.unwrap().expect("Newer release");
        let downloaded = update.download(|_, _| {}, || {}).await.unwrap();
        assert_eq!(downloaded, bytes);
        payload.lock().unwrap()[0] ^= 1;
        assert!(
            update.download(|_, _| {}, || {}).await.is_err(),
            "Modified artifact was accepted"
        );
        *payload.lock().unwrap() = bytes;
        manifest.lock().unwrap()["version"] = json!("999.0.0");
        let substituted = updater.check().await.unwrap().unwrap();
        assert!(
            substituted.download(|_, _| {}, || {}).await.is_err(),
            "An older signed artifact accepted a fabricated version"
        );
        manifest.lock().unwrap()["version"] = json!("0.0.1");
        assert!(
            updater.check().await.unwrap().is_none(),
            "Downgrade offered"
        );
        server.abort();
        let _ = server.await;
    }
}
