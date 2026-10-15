//! Native HTTP API and desktop engine services.
pub use axum::Router;
pub mod app_runtime;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, sync::Arc};
pub mod batch_routes;
#[cfg(test)]
mod bridge_checks;
pub mod bridge_gateway;
pub mod bridge_mode;
#[cfg(test)]
mod bridge_mode_checks;
pub mod bridge_page;
pub mod bridge_policy;
pub mod bridge_sessions;
pub mod bridge_tunnel;
pub mod cleaner;
#[cfg(test)]
mod dataset_checks;
pub mod dataset_routes;
pub mod download;
#[cfg(test)]
mod download_checks;
pub mod download_routes;
pub mod engine;
#[cfg(test)]
mod engine_checks;
pub mod engine_runtime;
pub mod gpu_runtime;
pub mod infer_params;
pub mod job_routes;
pub mod jobs;
pub mod locale;
pub mod metadata_cache;
#[cfg(test)]
mod model_checks;
pub mod model_routes;
pub mod native;
pub mod native_host;
#[cfg(test)]
mod native_host_checks;
#[cfg(test)]
mod plugin_checks;
pub mod plugin_routes;
pub mod process;
#[cfg(test)]
mod processing_checks;
pub mod processing_routes;
pub mod python_runtime;
pub mod realtime;
#[cfg(test)]
mod realtime_checks;
pub mod realtime_routes;
#[cfg(test)]
mod report_checks;
pub mod report_routes;
pub mod scheduler;
pub mod service;
#[cfg(test)]
mod service_checks;
#[cfg(test)]
mod settings_checks;
pub mod settings_routes;
#[cfg(test)]
mod setup_checks;
pub mod setup_install;
pub mod setup_requirements;
pub mod setup_routes;
pub mod storage;
pub mod tensorboard_routes;
pub mod training_artifacts;
#[cfg(test)]
mod training_checks;
pub mod training_params;
pub mod training_routes;
pub mod uploads;
#[cfg(test)]
mod uvr_checks;
pub mod uvr_routes;
#[cfg(test)]
mod version_checks;
pub mod version_routes;
pub mod worker;

pub async fn serve(listener: tokio::net::TcpListener, router: Router) -> anyhow::Result<()> {
    use axum::serve::ListenerExt;
    axum::serve(
        listener.tap_io(|stream| {
            let _ = stream.set_nodelay(true);
        }),
        router,
    )
    .await?;
    Ok(())
}

#[derive(Clone)]
pub struct ApiConfig {
    pub code_root: PathBuf,
    pub data_root: PathBuf,
    pub config_dir: PathBuf,
}

#[derive(Clone)]
struct ApiState {
    config: ApiConfig,
}

type ApiResult = Result<Json<Value>, (StatusCode, Json<Value>)>;
fn failure(status: StatusCode, error: impl ToString) -> (StatusCode, Json<Value>) {
    (status, Json(json!({"error": error.to_string()})))
}
async fn read_json(path: PathBuf) -> Result<Value, (StatusCode, Json<Value>)> {
    let data = tokio::fs::read(path)
        .await
        .map_err(|e| failure(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    serde_json::from_slice(&data).map_err(|e| failure(StatusCode::INTERNAL_SERVER_ERROR, e))
}
async fn settings(state: &ApiState) -> Result<Value, (StatusCode, Json<Value>)> {
    let mut defaults =
        read_json(state.config.code_root.join("assets/config_template.json")).await?;
    let path = state.config.config_dir.join("config.json");
    if tokio::fs::try_exists(&path).await.unwrap_or(false) {
        let mut saved = read_json(path).await?;
        if let Some(object) = saved.as_object_mut() {
            object.remove("version");
        }
        merge(&mut defaults, saved);
    }
    Ok(defaults)
}
fn merge(base: &mut Value, value: Value) {
    if let (Some(base), Some(values)) = (base.as_object_mut(), value.as_object()) {
        for (key, value) in values {
            if ["__proto__", "constructor", "prototype"].contains(&key.as_str()) {
                continue;
            }
            merge(
                base.entry(key.clone()).or_insert(Value::Null),
                value.clone(),
            );
        }
    } else {
        *base = value;
    }
}
async fn version() -> Json<Value> {
    Json(json!({"version": env!("CARGO_PKG_VERSION")}))
}

const LANGUAGES: &[(&str, &str)] = &[
    ("ar_AR", "العربية"),
    ("de_DE", "Deutsch"),
    ("en_US", "English"),
    ("es_ES", "Español"),
    ("fr_FR", "Français"),
    ("hi_IN", "हिन्दी"),
    ("id_ID", "Bahasa Indonesia"),
    ("it_IT", "Italiano"),
    ("ja_JA", "日本語"),
    ("ko_KO", "한국어"),
    ("pt_BR", "Português (Brasil)"),
    ("ru_RU", "Русский"),
    ("tr_TR", "Türkçe"),
    ("vi_VI", "Tiếng Việt"),
    ("zh_CN", "简体中文"),
];
async fn voices(State(state): State<Arc<ApiState>>) -> ApiResult {
    let raw = read_json(
        state
            .config
            .code_root
            .join("backend/applio/rvc/lib/tools/tts_voices.json"),
    )
    .await?;
    let voices: Vec<Value> = raw
        .as_array()
        .ok_or_else(|| failure(StatusCode::INTERNAL_SERVER_ERROR, "Invalid voice catalog"))?
        .iter()
        .map(|v| {
            json!({"shortName": v["ShortName"],
            "friendlyName": v.get("FriendlyName").unwrap_or(&v["ShortName"]),
            "gender": v.get("Gender").and_then(Value::as_str).unwrap_or(""),
            "locale": v.get("Locale").and_then(Value::as_str).unwrap_or("")})
        })
        .collect();
    Ok(Json(json!({"voices": voices})))
}
async fn themes(State(state): State<Arc<ApiState>>) -> ApiResult {
    let dir = state.config.data_root.join("assets/themes");
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| failure(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let mut entries = tokio::fs::read_dir(&dir)
        .await
        .map_err(|e| failure(StatusCode::INTERNAL_SERVER_ERROR, e))?;
    let mut themes = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|e| failure(StatusCode::INTERNAL_SERVER_ERROR, e))?
    {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".json") || name.ends_with(".example.json") {
            continue;
        }
        let raw = read_json(entry.path())
            .await
            .unwrap_or(json!({"description": "Invalid JSON — fix or remove this file."}));
        themes.push(json!({"id": name, "name": raw["name"].as_str().filter(|s| !s.is_empty()).unwrap_or(name.trim_end_matches(".json")),
            "description": raw["description"].as_str().unwrap_or(""), "colors": raw.get("colors").unwrap_or(&json!({})), "example": false}));
    }
    themes.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    let config = settings(&state).await?;
    Ok(Json(
        json!({"themes": themes, "selected": config["theme"]["file"].as_str().unwrap_or("")}),
    ))
}
async fn theme(
    State(state): State<Arc<ApiState>>,
    Query(query): Query<HashMap<String, String>>,
) -> ApiResult {
    let config = settings(&state).await?;
    let file = query
        .get("file")
        .map(String::as_str)
        .unwrap_or_else(|| config["theme"]["file"].as_str().unwrap_or(""));
    let (id, mut theme) = if file.ends_with(".json") {
        // Reject both Windows and POSIX separators on every platform.
        if file.contains(['/', '\\', '\0']) || file == ".." {
            return Err(failure(
                StatusCode::FORBIDDEN,
                "Only assets/themes/*.json files.",
            ));
        }
        let dir = state.config.data_root.join("assets/themes");
        let path = dir.join(file);
        let canonical = tokio::fs::canonicalize(&path)
            .await
            .map_err(|_| failure(StatusCode::NOT_FOUND, "Theme not found"))?;
        let root = tokio::fs::canonicalize(dir)
            .await
            .map_err(|e| failure(StatusCode::INTERNAL_SERVER_ERROR, e))?;
        if !canonical.starts_with(root) {
            return Err(failure(
                StatusCode::FORBIDDEN,
                "Theme outside themes directory",
            ));
        }
        (file, read_json(canonical).await?)
    } else {
        (
            "",
            json!({"name": "Default", "version": "1.0.0", "colors": {}, "fonts": {}, "radius": {}}),
        )
    };
    if let Some(fonts) = config["theme"]["font"].as_array() {
        let fonts: Vec<_> = fonts.iter().filter(|f| f.is_string()).cloned().collect();
        if !fonts.is_empty() {
            if !theme["fonts"].is_object() {
                theme["fonts"] = json!({});
            }
            theme["fonts"]["body"] = json!(fonts);
            theme["fonts"]["display"] = json!(fonts);
        }
    }
    Ok(Json(json!({"id": id, "theme": theme})))
}
