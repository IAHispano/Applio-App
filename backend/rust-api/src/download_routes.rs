//! Model acquisition and audio downloads executed by Rust-owned jobs.
use crate::{
    download,
    engine::{JobResult, NativeEngine},
    jobs::JobType,
    process::{json_result, ManagedProcess},
    processing_routes::{accepted, path_string, Accepted, Error},
    scheduler::Resource,
    training_routes::{publish, safe_directory},
    uploads::{self, UploadRule},
};
use anyhow::{bail, Context, Result};
use axum::{
    extract::{DefaultBodyLimit, Request, State},
    routing::{get, post},
    Json, Router,
};
use regex::Regex;
use serde::Deserialize;
use serde_json::{json, Value};
use std::{
    path::Path,
    sync::{Arc, OnceLock},
    time::Duration,
};
use unicode_normalization::UnicodeNormalization;

const CATALOG: &str = "https://huggingface.co/IAHispano/Applio/raw/main/pretrains.json";
pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/download", post(model))
        .route("/api/download/drop", post(drop_model))
        .route(
            "/api/download/pretraineds",
            get(pretraineds).post(download_pretraineds),
        )
        .route("/api/audio/youtube", post(youtube))
        .layer(DefaultBodyLimit::disable())
        .with_state(engine)
}
fn format_title(name: &str) -> String {
    let mut value = String::new();
    let mut whitespace = false;
    for ch in name.nfc() {
        if ch.is_whitespace() {
            if !whitespace {
                value.push('_');
            }
            whitespace = true;
        } else if !(('\u{2500}'..='\u{257f}').contains(&ch))
            && (ch.is_alphanumeric() || matches!(ch, '_' | '.' | '-'))
        {
            value.push(ch);
            whitespace = false;
        }
    }
    if value.is_empty() {
        "model".into()
    } else {
        value
    }
}
fn model_name(name: &str) -> String {
    let lower = name.to_ascii_lowercase();
    let mut value = if let Some(i) = lower.find(".pth").or_else(|| lower.find(".onnx")) {
        name[..i].to_owned()
    } else {
        let mut value = name.to_owned();
        for part in ["nprobe_1_", "_v1", "_v2", "added_"] {
            value = value.replacen(part, "", 1);
        }
        if let Some(i) = value.to_ascii_lowercase().find(".index") {
            value.truncate(i);
        }
        value
    };
    if value.is_empty() || matches!(value.as_str(), "." | "..") {
        value = "model".into();
    }
    value
}
async fn drop_model(
    State(engine): State<Arc<NativeEngine>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(
        request,
        &engine.runtime.uploads,
        &[UploadRule {
            name: "file",
            extensions: &["pth", "onnx", "index"],
            max_bytes: 1024 * 1024 * 1024,
            max_files: 1,
        }],
    )
    .await?;
    let file = input
        .files
        .get("file")
        .context("Upload a 'file' (.pth, .onnx or .index).")?;
    let filename = format_title(&file.original_name);
    let name = model_name(&filename);
    let root = safe_directory(&engine.runtime.logs, &name)
        .await
        .map_err(Error::internal)?;
    publish(&file.path, &root.join(&filename))
        .await
        .map_err(Error::internal)?;
    Ok(Json(
        json!({"ok":true,"file":filename,"modelDir":format!("logs/{name}")}),
    ))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Model {
    model_link: String,
}
async fn model(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    let body: Model = serde_json::from_value(input.body.clone())
        .map_err(|_| Error::input("Invalid params (modelLink must be a URL)"))?;
    // Python supports model hosting providers, but never non-web URI schemes.
    download::http_url(&body.model_link).map_err(Error::input)?;
    let params = json!({"modelLink":body.model_link});
    let job = engine
        .start_job(
            JobType::Download,
            params,
            Some(Resource::ModelDownload),
            move |engine, job, token| async move {
                let spec = engine
                    .runtime
                    .python_command(["rvc/lib/tools/model_download.py", &body.model_link])?;
                let mut last = 0.;
                static PERCENT: OnceLock<Regex> = OnceLock::new();
                let percent = PERCENT.get_or_init(|| Regex::new(r"(\d{1,3})%\s*\|").unwrap());
                let output = ManagedProcess::run(&spec, &token, |_, line| {
                    engine.jobs.log(&job.id, line);
                    if let Some(value) = percent
                        .captures_iter(line)
                        .last()
                        .and_then(|m| m[1].parse::<f64>().ok())
                    {
                        if value > last {
                            last = value;
                            engine.jobs.progress(&job.id, value);
                        }
                    }
                })
                .await?;
                output.ensure_success()?;
                if !output.stdout.contains("Model downloaded successfully.") {
                    bail!("Model download did not report success.");
                }
                engine.jobs.progress(&job.id, 100.);
                Ok(JobResult::new(
                    json!({"message":"Model downloaded successfully."}),
                    None,
                ))
            },
        )
        .await?;
    Ok(accepted(job))
}
fn custom(engine: &NativeEngine) -> std::path::PathBuf {
    engine.runtime.data.join("rvc/models/pretraineds/custom")
}
async fn catalog(engine: &NativeEngine) -> Result<Value> {
    let cache = custom(engine).join("pretrains.json");
    if let Ok(bytes) = tokio::fs::read(&cache).await {
        if let Ok(data) = serde_json::from_slice::<Value>(&bytes) {
            if data.is_object() {
                return Ok(data);
            }
        }
    }
    let token = engine.cancellation_token();
    let fetch = async {
        let response = download::client()?
            .get(CATALOG)
            .send()
            .await?
            .error_for_status()?;
        let bytes = response.bytes().await?;
        let data: Value = serde_json::from_slice(&bytes)?;
        if !data.is_object() {
            bail!("Invalid pretrains catalog");
        }
        tokio::fs::create_dir_all(custom(engine)).await?;
        crate::storage::atomic_json(&cache, &data)?;
        Ok(data)
    };
    tokio::select! {
        _ = token.cancelled() => bail!("Applio is shutting down"),
        result = tokio::time::timeout(Duration::from_secs(15), fetch) => result.context("Could not fetch pretrains.json (timeout)")?,
    }
}
async fn pretraineds(State(engine): State<Arc<NativeEngine>>) -> Json<Value> {
    match catalog(&engine).await {
        Ok(data) => Json(
            json!({"models":data.as_object().unwrap().iter().map(|(name,rates)| json!({"name":name,"sampleRates":rates.as_object().map(|r|r.keys().collect::<Vec<_>>()).unwrap_or_default()})).collect::<Vec<_>>()}),
        ),
        Err(error) => Json(
            json!({"models":[{"name":"Titan","sampleRates":["32k"]}],"warning":error.to_string()}),
        ),
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pretrained {
    model: Option<String>,
    sample_rate: Option<String>,
    #[serde(default)]
    url_g: String,
    #[serde(default)]
    url_d: String,
}
fn download_name(url: &str) -> Result<String> {
    let parsed = download::http_url(url)?;
    let name = parsed
        .path_segments()
        .and_then(|mut parts| parts.next_back())
        .context("Missing download filename")?;
    if name.is_empty() || matches!(name, "." | "..") || name.contains(['\\', ':']) {
        bail!("Invalid download filename");
    }
    Ok(name.into())
}
async fn download_pretraineds(
    State(engine): State<Arc<NativeEngine>>,
    request: Request,
) -> Accepted {
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    let body: Pretrained =
        serde_json::from_value(input.body.clone()).map_err(|_| Error::input("Invalid params"))?;
    let urls: Vec<String> = if !body.url_g.is_empty() || !body.url_d.is_empty() {
        [body.url_g, body.url_d]
            .into_iter()
            .filter(|s| !s.is_empty())
            .map(|s| s.replace("?download=true", ""))
            .collect()
    } else {
        let (Some(model), Some(rate)) = (&body.model, &body.sample_rate) else {
            return Err(Error::input("Provide model+sampleRate or urlG/urlD."));
        };
        let data = catalog(&engine).await.map_err(Error::internal)?;
        let entry = &data[model][rate];
        if !entry.is_object() {
            return Err(Error::input("Unknown pretrained model/sample rate."));
        }
        ["D", "G"]
            .into_iter()
            .filter_map(|side| entry[side].as_str())
            .filter(|s| !s.is_empty() && *s != "null")
            .map(|s| format!("https://huggingface.co/{s}"))
            .collect()
    };
    if urls.is_empty() {
        return Err(Error::input("Nothing to download."));
    }
    let mut tasks = Vec::new();
    for url in &urls {
        tasks.push((url.clone(), custom(&engine).join(download_name(url)?)));
    }
    let job = engine
        .start_job(
            JobType::Download,
            json!({"model":body.model,"sampleRate":body.sample_rate,"files":urls}),
            Some(Resource::Network),
            move |engine, job, token| async move {
                let client = download::client()?;
                for (i, (url, destination)) in tasks.iter().enumerate() {
                    engine.jobs.log(&job.id, &format!("Downloading {url}"));
                    download::file(
                        &client,
                        url,
                        destination,
                        None,
                        &token,
                        |received, total| {
                            if total > 0 {
                                engine.jobs.progress(
                                    &job.id,
                                    ((i as f64 + received as f64 / total as f64)
                                        / tasks.len() as f64)
                                        * 100.,
                                );
                            }
                        },
                        |attempt| {
                            engine.jobs.log(
                                &job.id,
                                &format!(
                                    "Retrying {} ({attempt}/3)…",
                                    destination.file_name().unwrap().to_string_lossy()
                                ),
                            )
                        },
                    )
                    .await?;
                    engine
                        .jobs
                        .progress(&job.id, (i + 1) as f64 / tasks.len() as f64 * 100.);
                    engine
                        .jobs
                        .log(&job.id, &format!("Saved {}", destination.display()));
                }
                Ok(JobResult::new(
                    json!({"message":"Pretrained model downloaded successfully!"}),
                    None,
                ))
            },
        )
        .await?;
    Ok(accepted(job))
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Youtube {
    url: String,
    #[serde(default = "wav")]
    output_format: String,
}
fn wav() -> String {
    "wav".into()
}
async fn youtube(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    let body: Youtube =
        serde_json::from_value(input.body.clone()).map_err(|_| Error::input("Invalid params"))?;
    static YOUTUBE: OnceLock<Regex> = OnceLock::new();
    if !matches!(body.output_format.as_str(), "wav" | "mp3") || !YOUTUBE.get_or_init(|| Regex::new(r"(?i)^(https?://)?(www\.|m\.|music\.)?(youtube\.com/(watch|shorts|live|embed)|youtu\.be/)").unwrap()).is_match(&body.url) {
        return Err(Error::input("Only single YouTube video URLs are supported."));
    }
    let job = engine
        .start_job(
            JobType::Other,
            json!({"url":body.url,"outputFormat":body.output_format}),
            Some(Resource::Network),
            move |engine, job, token| async move {
                let directory = engine.runtime.data.join("assets/audios");
                tokio::fs::create_dir_all(&directory).await?;
                let mut args = vec![
                    path_string(&engine.runtime.code.join("tools/audio/youtube.py")),
                    "--url".into(),
                    body.url,
                    "--output-dir".into(),
                    path_string(&directory),
                    "--output-format".into(),
                    body.output_format,
                ];
                let local = engine.runtime.data.join(if cfg!(windows) {
                    "ffmpeg.exe"
                } else {
                    "ffmpeg"
                });
                let ffmpeg = if local.is_file() {
                    Some(local)
                } else if cfg!(target_os = "macos") {
                    [
                        "/opt/homebrew/bin/ffmpeg",
                        "/usr/local/bin/ffmpeg",
                        "/opt/local/bin/ffmpeg",
                    ]
                    .into_iter()
                    .map(Path::new)
                    .find(|p| p.is_file())
                    .map(Path::to_path_buf)
                } else {
                    None
                };
                if let Some(ffmpeg) = ffmpeg {
                    args.extend(["--ffmpeg-bin".into(), path_string(&ffmpeg)]);
                }
                let output = ManagedProcess::run(
                    &engine.runtime.python_command(args)?,
                    &token,
                    |_, line| engine.jobs.log(&job.id, line),
                )
                .await?;
                output.ensure_success()?;
                let data = json_result(&output.stdout)
                    .context("Download finished without reporting a file.")?;
                let file = engine.runtime.require_file(
                    data["file"]
                        .as_str()
                        .context("Downloaded file not found.")?,
                )?;
                if !std::fs::canonicalize(&file)?.starts_with(std::fs::canonicalize(&directory)?) {
                    bail!("Downloaded file escapes the audio folder");
                }
                let title = data["title"].as_str().unwrap_or("");
                let file = engine.runtime.repo_relative(&file);
                let message = if title.is_empty() {
                    "YouTube audio downloaded.".into()
                } else {
                    format!("Downloaded \"{title}\".")
                };
                Ok(JobResult::new(
                    json!({"file":file,"title":title,"message":message}),
                    Some(file),
                ))
            },
        )
        .await?;
    Ok(accepted(job))
}

#[cfg(test)]
mod checks {
    use super::*;
    #[test]
    fn preserves_unicode_model_and_index_names() {
        assert_eq!(format_title("─Cafe\u{301}  音声 ♥.pth"), "Café_音声_.pth");
        assert_eq!(model_name("added_IVF_音声_nprobe_1_v2.index"), "IVF_音声");
        assert_eq!(model_name(".pth"), "model");
        assert!(download_name("file:///tmp/model.pth").is_err());
        assert!(download_name("https://example.org/").is_err());
    }
}
