//! Dataset quality review and creation of a separate curated training copy.
use crate::{
    engine::{JobResult, NativeEngine},
    jobs::{Job, JobType},
    process::{ManagedProcess, Stream},
    processing_routes::{path_string, string, Accepted, Error},
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
use uuid::Uuid;
pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/train/dataset-review/scan", post(scan))
        .route("/api/train/dataset-review/{id}", get(report))
        .route("/api/train/dataset-review/{id}/audio/{clip}", get(audio))
        .route("/api/train/dataset-review/{id}/prepare", post(prepare))
        .with_state(engine)
}
fn report_path(engine: &NativeEngine, id: &str) -> Result<PathBuf> {
    Uuid::parse_str(id).context("Invalid dataset review.")?;
    Ok(engine
        .runtime
        .config_dir
        .join("dataset-reviews")
        .join(format!("{id}.json")))
}
fn read_report(engine: &NativeEngine, id: &str) -> Result<Value> {
    let value: Value = serde_json::from_slice(&std::fs::read(report_path(engine, id)?)?)?;
    if !value["clips"].is_array() || !value["root"].is_string() {
        bail!("Invalid review report. Scan the dataset again.");
    }
    Ok(value)
}
fn usable(clip: &Value) -> bool {
    clip.get("error")
        .is_none_or(|value| value.is_null() || value == false || value.as_str() == Some(""))
}
async fn run(
    engine: &NativeEngine,
    job: &Job,
    token: &CancellationToken,
    args: Vec<String>,
    review_id: &str,
    preparing: bool,
) -> Result<JobResult> {
    let stage = if preparing {
        "Preparing a separate training copy…"
    } else {
        "Scanning recordings…"
    };
    engine.jobs.stage(&job.id, stage, None, None);
    let mut reported = None;
    let spec = engine.runtime.python_command(
        std::iter::once("backend/python/datasets/quality.py".to_owned()).chain(args),
    )?;
    let result = ManagedProcess::run(&spec, token, |stream, line| {
        if stream == Stream::Stderr {
            engine.jobs.log(&job.id, line);
            return;
        }
        if let Some(progress) = line.strip_prefix("REVIEW_PROGRESS:") {
            if let Some((current, total)) = progress.split_once('/') {
                if let (Ok(current), Ok(total)) = (current.parse::<u64>(), total.parse::<u64>()) {
                    if total > 0 {
                        engine
                            .jobs
                            .stage(&job.id, stage, Some(current), Some(total));
                        engine
                            .jobs
                            .progress(&job.id, current as f64 / total as f64 * 100.0);
                    }
                }
            }
        } else if let Some(json) = line.strip_prefix("REVIEW_RESULT:") {
            // Parse the protocol line directly, before the bounded stdout tail
            // can truncate a large scan report. Raw report data is not a log.
            reported = Some(serde_json::from_str::<Value>(json).map_err(|error| error.to_string()));
        }
    })
    .await?;
    result.ensure_success()?;
    let mut output = reported
        .context("Dataset review produced no report.")?
        .map_err(anyhow::Error::msg)?;
    if !output.is_object() {
        bail!("Dataset review returned an invalid result");
    }
    output["reviewId"] = json!(review_id);
    engine.jobs.stage(&job.id, "Checking output…", None, None);
    Ok(JobResult::new(output, None))
}
async fn scan(State(engine): State<Arc<NativeEngine>>, request: Request) -> Accepted {
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    let dataset = string(&input.body, "datasetPath");
    if dataset.is_empty() {
        return Err(Error::input("datasetPath is required"));
    }
    let silence = match input.body.get("silenceDb") {
        None => -50.0,
        Some(value) => value
            .as_f64()
            .filter(|number| (-80.0..=-30.0).contains(number))
            .context("silenceDb must be a number between -80 and -30")?,
    };
    let root = tokio::fs::canonicalize(engine.runtime.resolve_user_path(&dataset)?)
        .await
        .map_err(Error::input)?;
    if !root.is_dir() {
        return Err(Error::input("Choose a training folder."));
    }
    let review_id = Uuid::new_v4().to_string();
    let report = report_path(&engine, &review_id)?;
    tokio::fs::create_dir_all(report.parent().unwrap())
        .await
        .map_err(Error::internal)?;
    let id = review_id.clone();
    let job = engine
        .start_job(
            JobType::Other,
            json!({"step":"dataset-review","datasetPath":root,"reviewId":review_id}),
            Some(Resource::DatasetReview),
            move |engine, job, token| async move {
                run(
                    &engine,
                    &job,
                    &token,
                    vec![
                        "scan".into(),
                        "--root".into(),
                        path_string(&root),
                        "--report".into(),
                        path_string(&report),
                        "--silence-db".into(),
                        silence.to_string(),
                    ],
                    &id,
                    false,
                )
                .await
            },
        )
        .await
        .map_err(Error::internal)?;
    Ok((
        StatusCode::ACCEPTED,
        Json(json!({"jobId":job.id,"reviewId":review_id})),
    ))
}
async fn report(
    State(engine): State<Arc<NativeEngine>>,
    RoutePath(id): RoutePath<String>,
) -> Result<Response, Error> {
    let mut value = read_report(&engine, &id)
        .map_err(|error| Error(StatusCode::NOT_FOUND, json!({"error":error.to_string()})))?;
    for clip in value["clips"].as_array_mut().unwrap() {
        if let Some(clip) = clip.as_object_mut() {
            clip.remove("sourceHash");
            clip.remove("pcmHash");
        }
    }
    let mut response = Json(value).into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    Ok(response)
}
async fn audio(
    State(engine): State<Arc<NativeEngine>>,
    RoutePath((id, clip)): RoutePath<(String, String)>,
    request: Request,
) -> Result<Response, Error> {
    let report = read_report(&engine, &id)?;
    let clip = report["clips"]
        .as_array()
        .unwrap()
        .iter()
        .find(|value| value["id"] == clip && usable(value))
        .context("Recording is unavailable.")?;
    let root = tokio::fs::canonicalize(string(&report, "root"))
        .await
        .map_err(Error::input)?;
    let file = tokio::fs::canonicalize(root.join(string(clip, "path")))
        .await
        .map_err(Error::input)?;
    if file == root || !file.starts_with(&root) || !file.is_file() {
        return Err(Error::input("Recording is outside the reviewed folder."));
    }
    let mut response = ServeFile::new(file)
        .oneshot(request)
        .await
        .unwrap()
        .into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, "no-store".parse().unwrap());
    Ok(response)
}
struct PrepareCleanup {
    plan: PathBuf,
    output: PathBuf,
}
impl Drop for PrepareCleanup {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.plan);
        if let Some(parent) = self.output.parent() {
            let prefix = format!(
                ".applio-review-{}-",
                self.output
                    .file_name()
                    .unwrap_or_default()
                    .to_string_lossy()
            );
            if let Ok(entries) = std::fs::read_dir(parent) {
                for entry in entries.flatten() {
                    if entry.file_type().is_ok_and(|kind| kind.is_dir())
                        && entry.file_name().to_string_lossy().starts_with(&prefix)
                    {
                        let stage = entry.path();
                        if stage.parent() == Some(parent) {
                            let _ = std::fs::remove_dir_all(stage);
                        }
                    }
                }
            }
        }
    }
}
async fn prepare(
    State(engine): State<Arc<NativeEngine>>,
    RoutePath(id): RoutePath<String>,
    request: Request,
) -> Accepted {
    let report = read_report(&engine, &id)?;
    let input = uploads::parse(request, &engine.runtime.uploads, &[]).await?;
    let include = input.body["include"]
        .as_array()
        .filter(|items| !items.is_empty() && items.len() <= 5000)
        .context("Choose valid recordings from this review.")?;
    let mut seen = HashSet::new();
    for value in include {
        let value = value
            .as_str()
            .filter(|value| {
                value.len() == 24
                    && value
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            })
            .context("Choose valid recordings from this review.")?;
        if !seen.insert(value)
            || !report["clips"]
                .as_array()
                .unwrap()
                .iter()
                .any(|clip| clip["id"] == value && usable(clip))
        {
            return Err(Error::input("Choose valid recordings from this review."));
        }
    }
    let mut plan = json!({"include":include});
    for key in ["trimSilence", "normalize", "lowerPeaks"] {
        plan[key] = json!(input.body[key]
            .as_bool()
            .context("Preparation options must be booleans")?);
    }
    let folder: String = Path::new(report["root"].as_str().unwrap())
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || ['_', '-'].contains(&c) {
                c
            } else {
                '_'
            }
        })
        .take(60)
        .collect();
    let folder = if folder.is_empty() {
        "dataset"
    } else {
        &folder
    };
    let output = engine
        .runtime
        .data
        .join("assets/curated-datasets")
        .join(format!("{folder}-{}", &Uuid::new_v4().to_string()[..8]));
    let review_id = id.clone();
    let report_file = report_path(&engine, &id)?;
    let job = engine
        .start_job(
            JobType::Other,
            json!({"step":"dataset-prepare","reviewId":id,"datasetPath":report["root"]}),
            Some(Resource::DatasetReview),
            move |engine, job, token| async move {
                let cleanup = PrepareCleanup {
                    plan: report_file
                        .parent()
                        .unwrap()
                        .join(format!("{}.plan.json", job.id)),
                    output,
                };
                let mut options = tokio::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                options.mode(0o600);
                let mut file = options.open(&cleanup.plan).await?;
                use tokio::io::AsyncWriteExt;
                file.write_all(&serde_json::to_vec(&plan)?).await?;
                file.flush().await?;
                drop(file);
                run(
                    &engine,
                    &job,
                    &token,
                    vec![
                        "prepare".into(),
                        "--report".into(),
                        path_string(&report_file),
                        "--plan".into(),
                        path_string(&cleanup.plan),
                        "--destination".into(),
                        path_string(&cleanup.output),
                    ],
                    &review_id,
                    true,
                )
                .await
            },
        )
        .await
        .map_err(Error::internal)?;
    Ok((StatusCode::ACCEPTED, Json(json!({"jobId":job.id}))))
}
