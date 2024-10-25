// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command

use declarative_discord_rich_presence::activity::Activity;
use declarative_discord_rich_presence::{activity, DeclarativeDiscordIpcClient};
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use std::path::PathBuf;
use std::io;
use std::net::TcpListener;
use tauri::State;

fn get_server_path() -> io::Result<PathBuf> {
    let base_dir = std::env::current_dir()?;
    println!("{:?}", base_dir);
    Ok(if cfg!(dev) {
        base_dir.join("python").join("server.exe")
    } else {
        base_dir.join("python").join("server.exe")
    })
}

fn find_available_port() -> Option<u16> {
    if let Ok(listener) = TcpListener::bind("127.0.0.1:0") {
        let port = listener.local_addr().unwrap().port();
        println!("Port found: {}", port);
        return Some(port);
    }
    None
}

fn start_server(port: u16) -> io::Result<Child> {
    let server_path = get_server_path()?;

    println!("Project root: {:?}", server_path);

    let child = Command::new(server_path)
        .arg(port.to_string())
        .spawn() 
        .map_err(|e| io::Error::new(io::ErrorKind::Other, format!("Failed to start server: {}", e)))?;

    println!("Initializing server on port {}...", port);
    Ok(child)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let flask_server = Arc::new(Mutex::new(None));
    let port = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup({
            let flask_server = Arc::clone(&flask_server);
            let port_clone = Arc::clone(&port);

            move |_app| {
                if let Some(p) = find_available_port() {
                match start_server(p) {
                    Ok(server_process) => {
                        *flask_server.lock().unwrap() = Some(server_process);
                        *port_clone.lock().unwrap() = Some(p); 
                    }
                    Err(e) => {
                        eprintln!("Error starting server: {}", e);
                    }
                }
                Ok(())
                } else {
                    println!("Failed to find an available port.");
                    Ok(())
                }
            }
        })
        .manage(port.clone())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![set_discord_presence, is_dev, get_port])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[tauri::command]
fn is_dev() -> bool {
    cfg!(debug_assertions) 
}

#[tauri::command]
fn set_discord_presence(state: &str, details: &str) {
    let client = DeclarativeDiscordIpcClient::new("1144714449563955302");

    client.enable();

    let _ = client.set_activity(
        Activity::new().state(state).details(details).assets(
            activity::Assets::new()
                .large_image("logo")
                .large_text("Applio App"),
        ),
    );
}

#[tauri::command]
async fn get_port(port: State<'_, Arc<Mutex<Option<u16>>>>) -> Result<u16, String> {
    let port_guard = port.lock().unwrap(); 
    if let Some(p) = *port_guard {
        Ok(p)
    } else {
        Err("Port not available".into()) 
    }
}