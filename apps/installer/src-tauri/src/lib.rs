use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, AUTHORIZATION};
use std::env;
use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use std::path::Path;
use std::process::Command;
use tauri::Emitter;
use zip::read::ZipArchive;
use std::thread;

#[tauri::command]
fn download_zip(
    url: String,
    output_path: String,
    token: String,
    shortcut: bool,
    window: tauri::Window,
) -> Result<String, String> {
    let mut headers = HeaderMap::new();
    headers.insert(AUTHORIZATION, format!("Bearer {}", token).parse().unwrap());

    let client = Client::new();
    let response: Response = client
        .get(&url)
        .headers(headers)
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("download error: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let mut reader = BufReader::new(response);
    let mut file = File::create(&output_path).map_err(|e| e.to_string())?;

    let mut buffer = vec![0; 8192];
    let mut downloaded: u64 = 0;

    while let Ok(bytes_read) = reader.read(&mut buffer) {
        if bytes_read == 0 {
            break;
        }

        file.write_all(&buffer[..bytes_read])
            .map_err(|e| e.to_string())?;
        downloaded += bytes_read as u64;

        let progress = (downloaded as f64 / total_size as f64) * 100.0;
        window
            .emit("download-progress", progress)
            .map_err(|e| e.to_string())?;
    }

    let extract_dir = output_path.replace(".zip", "");
    fs::create_dir_all(&extract_dir).map_err(|e| e.to_string())?;
    let target_path = format!(r"{}\applio-app.exe", extract_dir);

    match extract_zip(&output_path, &extract_dir) {
        Ok(_) => {
            println!("shortcut: {}", shortcut);
            if shortcut == true {
                let desktop_shortcut_path = format!(r"{}\Desktop\Applio App.lnk", env::var("USERPROFILE").unwrap());
                let start_menu_shortcut_path = r"C:\ProgramData\Microsoft\Windows\Start Menu\Programs\Applio App.lnk";

                println!("Desktop_shortcut_path: {}", desktop_shortcut_path);
                println!("Start_menu_shortcut_path: {}", start_menu_shortcut_path);

                create_shortcut_async(
                    target_path.clone(),
                    desktop_shortcut_path.to_string(),
                    Some("Lightweight interface for fast interaction with AI-driven voice cloning technology".to_string())
                );
            
                create_shortcut_async(
                    target_path.clone(),
                    start_menu_shortcut_path.to_string(),
                    Some("Lightweight interface for fast interaction with AI-driven voice cloning technology".to_string())
                );
            }

            fs::remove_file(&output_path).map_err(|e| e.to_string())?;
            Ok(format!("downloaded at: {}", extract_dir))
        }
        Err(e) => Err(format!("unzip error: {}", e)),
    }
}

fn extract_zip(zip_path: &str, output_dir: &str) -> Result<(), String> {
    let file = File::open(zip_path).map_err(|e| e.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|e| e.to_string())?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| e.to_string())?;
        let outpath = std::path::Path::new(output_dir).join(file.sanitized_name());

        if file.name().ends_with('/') {
            fs::create_dir_all(&outpath).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = outpath.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut outfile = File::create(&outpath).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut outfile).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn create_shortcut_async(
    target_path: String,
    shortcut_path: String,
    description: Option<String>,
) {
    thread::spawn(move || {
        if let Err(e) = create_shortcut(&target_path, &shortcut_path, description.as_deref()) {
            eprintln!("Error creating shortcut: {}", e);
        }
    });
}

fn create_shortcut(
    target_path: &str,
    shortcut_path: &str,
    description: Option<&str>,
) -> std::io::Result<()> {
    if let Some(parent) = Path::new(shortcut_path).parent() {
        fs::create_dir_all(parent)?;
    }
    
    let mut powershell_cmd = Command::new("powershell");
    powershell_cmd.arg("-WindowStyle").arg("Hidden");
    powershell_cmd.arg("-Command").arg(format!(
        "$WshShell = New-Object -ComObject WScript.Shell; \
         $Shortcut = $WshShell.CreateShortcut('{}'); \
         $Shortcut.TargetPath = '{}'; {}
         $Shortcut.Save()",
        shortcut_path,
        target_path,
        description.map_or(String::new(), |desc| format!(
            "$Shortcut.Description = '{}'; ",
            desc
        ))
    ));

    let output = powershell_cmd.output()?;
    if !output.status.success() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Other,
            String::from_utf8_lossy(&output.stderr),
        ));
    }
    Ok(())
}

#[tauri::command]
fn get_actual_dir() -> Result<String, String> {
    let actual_dir = env::current_dir().map_err(|e| e.to_string())?;
    Ok(actual_dir.to_str().unwrap().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![download_zip, get_actual_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
