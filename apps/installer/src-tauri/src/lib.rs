use reqwest::blocking::{Client, Response};
use reqwest::header::{HeaderMap, AUTHORIZATION};
use std::fs::{self, File};
use std::io::{BufReader, Read, Write};
use zip::read::ZipArchive;
use tauri::Emitter; 
use std::env;

#[tauri::command]
fn download_zip(
    url: String,
    output_path: String,
    token: String,
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

    match extract_zip(&output_path, &extract_dir) {
        Ok(_) => Ok(format!(
            "downloaded at: {}",
            extract_dir
        )),
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

#[tauri::command]
fn get_actual_dir() -> Result<String, String> {
    let actual_dir = env::current_dir().map_err(|e| e.to_string())?;
    Ok(actual_dir.to_str().unwrap().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![download_zip, get_actual_dir])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
