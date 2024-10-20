// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command

use declarative_discord_rich_presence::activity::Activity;
use declarative_discord_rich_presence::{activity, DeclarativeDiscordIpcClient};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use std::io;

fn get_server_path() -> io::Result<PathBuf> {
    let base_dir = std::env::current_dir()?;
    println!("{:?}", base_dir);
    Ok(if cfg!(dev) {
        base_dir.join("python").join("server.exe")
    } else {
        base_dir.join("python").join("server.exe")
    })
}

fn start_server() -> io::Result<Child> {
    let server_path = get_server_path()?;

    println!("Project root: {:?}", server_path);

    let child = Command::new(server_path)
        .spawn() 
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Failed to start server: {}", e)))?;

    println!("Initializing server...");
    Ok(child)
}

#[tauri::command]
fn set_discord_presence(state: &str, details: &str) {
    let client = DeclarativeDiscordIpcClient::new("1182749528059813908");

    client.enable();

    let _ = client.set_activity(
        Activity::new().state(state).details(details).assets(
            activity::Assets::new()
                .large_image("logo")
                .large_text("Applio App"),
        ),
    );
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let flask_server = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup({
            let flask_server = Arc::clone(&flask_server);
            move |_app| {
                match start_server() {
                    Ok(server_process) => {
                        *flask_server.lock().unwrap() = Some(server_process);
                    }
                    Err(e) => {
                        eprintln!("Error starting server: {}", e);
                    }
                }
                Ok(())
            }
        })
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![set_discord_presence, is_dev])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn is_dev() -> bool {
    cfg!(debug_assertions) 
}