//! Batch conversion shares native worker/process ownership and the GPU lease.
use crate::{
    engine::{JobResult, NativeEngine},
    infer_params::{self, ValidationErrors},
    jobs::{Job, JobType},
    processing_routes::{
        accepted, cli, final_output, infer_cli, model_paths, path_string, ready, string, Accepted,
        Error,
    },
    scheduler::Resource,
    uploads,
};
use anyhow::{bail, Context, Result};
use axum::{
    extract::{Path as RoutePath, Request, State},
    http::{header, StatusCode},
    response::{IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio_util::sync::CancellationToken;
use tower::ServiceExt;
use tower_http::services::ServeFile;

pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/inference/batch", post(start))
        .route("/api/inference/batch/preview", post(preview))
        .route("/api/inference/batch/{id}/outputs/{item}", get(download))
        .with_state(engine)
}
fn supported(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()).is_some_and(|s| {
        [
            "wav", "mp3", "flac", "ogg", "m4a", "aac", "aiff", "aif", "wma", "opus",
        ]
        .contains(&s.to_lowercase().as_str())
    })
}
fn source_files(path: &Path, single: bool) -> Result<Vec<PathBuf>> {
    if single {
        if !path.is_file() {
            bail!("Input file or folder not found");
        }
        if !supported(path) {
            bail!("Unsupported input audio file");
        }
        return Ok(vec![path.into()]);
    }
    if !path.is_dir() {
        bail!("Input file or folder not found");
    }
    let mut files = Vec::new();
    for entry in std::fs::read_dir(path)? {
        let entry = entry?;
        if entry.file_type()?.is_file() {
            let path = entry.path();
            if supported(&path) {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}
fn text(value: &Value, key: &str, default: &str, errors: &mut ValidationErrors) -> String {
    match value.get(key) {
        Some(Value::String(value)) => value.clone(),
        None => default.into(),
        _ => {
            errors
                .field_errors
                .insert(key.into(), vec!["Expected string".into()]);
            String::new()
        }
    }
}
fn list(value: &Value, key: &str, errors: &mut ValidationErrors) -> Vec<String> {
    match value.get(key) {
        None => Vec::new(),
        Some(Value::Array(items))
            if items.len() <= 10_000
                && items
                    .iter()
                    .all(|item| item.as_str().is_some_and(|s| !s.is_empty())) =>
        {
            items.iter().map(|s| s.as_str().unwrap().into()).collect()
        }
        _ => {
            errors.field_errors.insert(
                key.into(),
                vec!["Expected up to 10000 nonempty filenames".into()],
            );
            Vec::new()
        }
    }
}
fn normalize(value: &Value) -> Result<(Value, Value), ValidationErrors> {
    let conversion = infer_params::batch_base(value)?;
    let mut params = conversion.clone();
    let mut errors = ValidationErrors::default();
    for (key, default) in [
        ("mode", "files"),
        ("inputFolder", ""),
        ("inputPath", ""),
        ("outputFolder", ""),
    ] {
        params[key] = json!(text(value, key, default, &mut errors));
    }
    let mode = string(&params, "mode");
    if !["files", "models", "both"].contains(&mode.as_str()) {
        errors
            .field_errors
            .insert("mode".into(), vec!["Invalid enum value".into()]);
    }
    for field in [
        if mode == "models" {
            "inputPath"
        } else {
            "inputFolder"
        },
        "outputFolder",
    ] {
        if string(&params, field).trim().is_empty() {
            errors
                .field_errors
                .insert(field.into(), vec!["Input is required".into()]);
        }
    }
    if mode == "files" && string(&params, "pthPath").trim().is_empty() {
        errors
            .field_errors
            .insert("pthPath".into(), vec!["Select a model".into()]);
    }
    params["excludedFiles"] = json!(list(value, "excludedFiles", &mut errors));
    if value.get("selectedFiles").is_some() {
        params["selectedFiles"] = json!(list(value, "selectedFiles", &mut errors));
    }
    let continue_on_error = match value.get("continueOnError") {
        None => true,
        Some(Value::Bool(value)) => *value,
        Some(Value::String(value)) => {
            !["false", "0", "no", "off", ""].contains(&value.to_lowercase().trim())
        }
        Some(Value::Number(value)) => value.as_f64() != Some(0.0),
        Some(Value::Null) => {
            errors
                .field_errors
                .insert("continueOnError".into(), vec!["Required".into()]);
            true
        }
        _ => true,
    };
    params["continueOnError"] = json!(continue_on_error);
    let mut models = Vec::new();
    match value.get("models") {
        None => {}
        Some(Value::Array(values)) if values.len() <= 100 => {
            for model in values {
                let pth = text(model, "pthPath", "", &mut errors);
                let index = text(model, "indexPath", "", &mut errors);
                if pth.is_empty() {
                    errors
                        .field_errors
                        .insert("models".into(), vec!["Each model requires pthPath".into()]);
                }
                match infer_params::overrides(model.get("overrides").unwrap_or(&json!({}))) {
                    Ok(overrides) => {
                        models.push(json!({"pthPath":pth,"indexPath":index,"overrides":overrides}))
                    }
                    Err(error) => {
                        errors
                            .field_errors
                            .insert("models".into(), vec![error.to_string()]);
                    }
                }
            }
        }
        _ => {
            errors
                .field_errors
                .insert("models".into(), vec!["Expected up to 100 models".into()]);
        }
    }
    if mode != "files" && models.is_empty() {
        errors
            .field_errors
            .insert("models".into(), vec!["Select at least one model".into()]);
    }
    params["models"] = json!(models);
    if errors.field_errors.is_empty() {
        Ok((params, conversion))
    } else {
        Err(errors)
    }
}
async fn preview(
    State(engine): State<Arc<NativeEngine>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    let mut errors = ValidationErrors::default();
    let file = text(&input.body, "inputPath", "", &mut errors);
    let folder = text(&input.body, "inputFolder", "", &mut errors);
    if !errors.field_errors.is_empty() {
        return Err(errors.into());
    }
    let single = !file.trim().is_empty();
    let source = engine
        .runtime
        .resolve_user_path(if single { &file } else { &folder })?;
    let files = tokio::task::spawn_blocking(move || {
        source_files(&source, single)?
            .into_iter()
            .map(|file| {
                Ok(json!({"name": file.file_name().unwrap().to_string_lossy(), "bytes": file.metadata()?.len()}))
            })
            .collect::<Result<Vec<_>>>()
    })
    .await
    .map_err(Error::internal)??;
    Ok(Json(json!({"files":files})))
}

fn select_files(files: &mut Vec<PathBuf>, params: &Value) -> Result<(), Error> {
    let filenames = |key: &str| {
        params[key].as_array().map(|names| {
            names
                .iter()
                .filter_map(Value::as_str)
                .collect::<HashSet<_>>()
        })
    };
    let excluded = filenames("excludedFiles").unwrap_or_default();
    let selected = filenames("selectedFiles");
    files.retain(|file| {
        let name = file.file_name().and_then(|name| name.to_str());
        !name.is_some_and(|name| excluded.contains(name))
            && selected
                .as_ref()
                .is_none_or(|names| name.is_some_and(|name| names.contains(name)))
    });
    if selected.is_some_and(|names| names.len() != files.len()) {
        return Err(Error::input(
            "Selected input files changed. Review audio files again.",
        ));
    }
    if files.is_empty() {
        return Err(Error::input("No supported audio files found"));
    }
    Ok(())
}

async fn start(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    ready(&engine).await?;
    let (params, conversion) = normalize(&input.body)?;
    let single = params["mode"] == "models";
    let source = engine.runtime.resolve_user_path(&string(
        &params,
        if single { "inputPath" } else { "inputFolder" },
    ))?;
    let output = engine
        .runtime
        .resolve_user_path(&string(&params, "outputFolder"))?;
    let mut files = tokio::task::spawn_blocking(move || source_files(&source, single))
        .await
        .map_err(Error::internal)??;
    select_files(&mut files, &params)?;
    let files_mode = params["mode"] == "files";
    let continue_on_error = params["continueOnError"] != false;
    let models = if files_mode {
        vec![json!({"pthPath":params["pthPath"],"indexPath":params["indexPath"],"overrides":{}})]
    } else {
        params["models"].as_array().unwrap().clone()
    };
    let mut resolved = Vec::with_capacity(models.len());
    for model in &models {
        let mut selected = conversion.clone();
        crate::engine_runtime::merge(&mut selected, model["overrides"].clone());
        selected["pthPath"] = model["pthPath"].clone();
        selected["indexPath"] = model["indexPath"].clone();
        model_paths(&engine, &mut selected)?;
        resolved.push(selected);
    }
    tokio::fs::create_dir_all(&output)
        .await
        .map_err(anyhow::Error::from)?;
    let job = engine
        .start_job(
            JobType::BatchInference,
            params,
            Some(Resource::Gpu),
            move |engine, job, token| {
                run(
                    engine,
                    job,
                    token,
                    files_mode,
                    continue_on_error,
                    files,
                    models,
                    resolved,
                    output,
                )
            },
        )
        .await
        .map_err(Error::internal)?;
    Ok(accepted(job))
}
#[allow(clippy::too_many_arguments)]
async fn run(
    engine: Arc<NativeEngine>,
    job: Job,
    token: CancellationToken,
    files_mode: bool,
    continue_on_error: bool,
    inputs: Vec<PathBuf>,
    models: Vec<Value>,
    resolved: Vec<Value>,
    output: PathBuf,
) -> Result<JobResult> {
    let output = output.join(format!("batch_{}", &job.id[..8]));
    let total = models.len() * inputs.len();
    let (mut done, mut failed) = (0, 0);
    engine.jobs.result(
        &job.id,
        json!({
            "files": 0, "failed": 0, "total": total, "models": models.len(),
            "items": [], "outputFolder": output,
        }),
    );
    for (number, selected) in resolved.iter().enumerate() {
        let model = &models[number];
        let stem = Path::new(model["pthPath"].as_str().unwrap())
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy();
        let directory = if files_mode {
            output.clone()
        } else {
            output.join(format!("{}_{stem}", number + 1))
        };
        tokio::fs::create_dir_all(&directory).await?;
        for input in &inputs {
            if token.is_cancelled() {
                bail!("Stopped by user");
            }
            let name = input.file_name().unwrap().to_string_lossy();
            let wav = directory.join(format!("{name}_output.wav"));
            let mut item = json!({"input":name,"model":model["pthPath"],"status":"running"});
            engine.jobs.update_result(&job.id, |result| {
                result["items"].as_array_mut().unwrap().push(item.clone());
            });
            engine.jobs.stage(
                &job.id,
                "Converting audio…",
                Some((done + failed + 1) as u64),
                Some(total as u64),
            );
            engine.jobs.log(
                &job.id,
                &format!("{}/{}: {name} -> {stem}", done + failed + 1, total),
            );
            let mut stdout = String::new();
            let conversion: Result<String> = async {
                let response = match engine.worker.request(json!({"command":"infer","id":job.id,"params":selected,"inputPath":input,"outputPath":wav}),&token,|line| engine.jobs.log(&job.id,line)).await {
                    Ok(response) => response,
                    Err(error) => {
                        if token.is_cancelled() { bail!("Stopped by user"); }
                        engine.jobs.log(&job.id,&format!("Worker notice: {error}; falling back to standalone CLI runner..."));
                        cli(&engine,&job.id,infer_cli(selected,input,&wav),&token,&mut stdout).await?; Value::Null
                    }
                };
                let file = final_output(&engine,&wav,&string(selected,"exportFormat"),&response,&["outputPath"])?;
                // Batch download records always contain an absolute filename.
                Ok(path_string(&engine.runtime.data.join(file)))
            }.await;
            if token.is_cancelled() {
                bail!("Stopped by user");
            }
            let error = match conversion {
                Ok(file) => {
                    item["status"] = json!("done");
                    item["output"] = json!(file);
                    done += 1;
                    None
                }
                Err(error) => {
                    item["status"] = json!("error");
                    item["error"] = json!(error.to_string());
                    failed += 1;
                    engine
                        .jobs
                        .log(&job.id, &format!("Failed: {name} -> {stem}: {error}"));
                    Some(error)
                }
            };
            engine.jobs.update_result(&job.id, |result| {
                let items = result["items"].as_array_mut().unwrap();
                *items.last_mut().unwrap() = item;
                result["files"] = json!(done);
                result["failed"] = json!(failed);
            });
            if let Some(error) = error.filter(|_| !continue_on_error) {
                return Err(error);
            }
            engine
                .jobs
                .progress(&job.id, ((done + failed) * 100) as f64 / total as f64);
        }
    }
    engine.jobs.stage(&job.id, "Checking output…", None, None);
    if done == 0 && failed > 0 {
        bail!("Batch conversion failed for every file. Check the individual results.");
    }
    Ok(JobResult::new(
        engine
            .jobs
            .result_snapshot(&job.id)
            .context("Batch result unavailable")?,
        Some(engine.runtime.repo_relative(&output)),
    ))
}
async fn download(
    State(engine): State<Arc<NativeEngine>>,
    RoutePath((id, index)): RoutePath<(String, String)>,
    request: Request,
) -> Result<Response, Error> {
    let missing = || Error(StatusCode::NOT_FOUND, json!({"error":"Output not found"}));
    let index: usize = index.parse().map_err(|_| missing())?;
    let (root, file) = engine.jobs.batch_output(&id, index).ok_or_else(missing)?;
    let root = tokio::fs::canonicalize(root).await.map_err(|_| missing())?;
    let file = tokio::fs::canonicalize(file).await.map_err(|_| missing())?;
    if !file.starts_with(root) || !file.is_file() {
        return Err(missing());
    }
    let disposition = uploads::attachment(file.file_name().unwrap_or_default());
    let mut response = ServeFile::new(file)
        .oneshot(request)
        .await
        .unwrap()
        .into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_DISPOSITION, disposition);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn batch_selection_preserves_order_and_rejects_removed_files() {
        let source = ["voice-a.wav", "voice-b.wav", "voice-c.wav"].map(PathBuf::from);
        let mut files = source.to_vec();
        assert!(select_files(
            &mut files,
            &json!({"excludedFiles":["voice-b.wav"],"selectedFiles":["voice-c.wav","voice-a.wav","voice-c.wav"]}),
        ).is_ok());
        assert_eq!(files, [source[0].clone(), source[2].clone()]);

        for file in ["voice-b.wav", "moved.wav"] {
            let error = select_files(
                &mut source.to_vec(),
                &json!({"excludedFiles":["voice-b.wav"],"selectedFiles":[file]}),
            )
            .unwrap_err();
            assert_eq!(
                error.1["error"],
                "Selected input files changed. Review audio files again."
            );
        }
    }

    #[test]
    fn batch_worker_parameters_omit_file_selection_and_keep_conversion_defaults() {
        let input = json!({
            "inputFolder": "inputs",
            "outputFolder": "outputs",
            "pthPath": "logs/voice.pth",
            "selectedFiles": ["voice.wav"],
            "pitch": -3,
        });
        let (batch, conversion) = normalize(&input).unwrap();
        assert_eq!(batch["selectedFiles"], input["selectedFiles"]);
        assert!(conversion.get("selectedFiles").is_none());
        assert_eq!(conversion, infer_params::inference(&input).unwrap());
    }
}
