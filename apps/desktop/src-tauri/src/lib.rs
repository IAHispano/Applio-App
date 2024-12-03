// Learn more about Tauri commands at https://tauri.app/v1/guides/features/command

use declarative_discord_rich_presence::activity::Activity;
use declarative_discord_rich_presence::{activity, DeclarativeDiscordIpcClient};
use std::io;
use std::io::{Write};
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::{Arc, Mutex};
use tauri::State;

fn get_server_path() -> io::Result<PathBuf> {
    let base_dir: PathBuf;

    if cfg!(debug_assertions) {
        base_dir = std::env::current_dir()?;
    } else {
        base_dir = std::env::current_exe()?
            .parent()
            .ok_or_else(|| {
                io::Error::new(
                    io::ErrorKind::NotFound,
                    "Executable has no parent directory",
                )
            })?
            .to_path_buf();
    }

    println!("Base directory: {:?}", base_dir);

    let python_dir = base_dir.join("python");
    println!("Python directory: {:?}", python_dir);
    let server_path = python_dir.join("server.exe");
    println!("Server path: {:?}", server_path);

    if !server_path.exists() {
        let log_file = base_dir.join("error.txt");
        println!("Creating logs: {:?}", log_file);

        let mut file = std::fs::File::create(&log_file)?;
        writeln!(file, "ERROR: Server not found. Cannot run.")?;
        writeln!(file, "Server path: {}", server_path.display())?;

        return Err(io::Error::new(
            io::ErrorKind::NotFound,
            format!(
                "Server not found. See error tree in {}. A log file has been created called '{}'",
                base_dir.display(),
                log_file.display()
            ),
        ));
    }

    Ok(server_path)
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

    let mut child = Command::new(&server_path)
        .arg(port.to_string())
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .map_err(|e| {
            eprintln!("Error spawning server process: {}", e);
            eprintln!("Path used: {:?}", server_path);
            eprintln!("Error details: {:?}", e);
            e
        })?;

    println!("Initializing server on port {}...", port);

    std::thread::sleep(std::time::Duration::from_secs(1));

    match child.try_wait() {
        Ok(Some(status)) => {
            eprintln!("Server process exited immediately with status: {}", status);
            Err(io::Error::new(
                io::ErrorKind::Other,
                "Server exited immediately",
            ))
        }
        Ok(None) => {
            println!("Server process running successfully");
            Ok(child)
        }
        Err(e) => {
            eprintln!("Error checking server process: {}", e);
            Err(e)
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let flask_server = Arc::new(Mutex::new(None));
    let port = Arc::new(Mutex::new(None));

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
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
        .plugin(tauri_plugin_oauth::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            set_discord_presence,
            is_dev,
            get_port
        ])
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
