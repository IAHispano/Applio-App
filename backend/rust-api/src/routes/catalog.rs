//! Settings, language, voice and theme catalogs.
use crate::ApiConfig;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    Json,
};
use serde_json::{json, Value};
use std::{collections::HashMap, path::PathBuf, sync::Arc};

#[derive(Clone)]
pub(crate) struct ApiState {
    pub(crate) config: ApiConfig,
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
pub(crate) async fn version() -> Json<Value> {
    Json(json!({"version": env!("CARGO_PKG_VERSION")}))
}

pub(crate) const LANGUAGES: &[(&str, &str)] = &[
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
pub(crate) async fn voices(State(state): State<Arc<ApiState>>) -> ApiResult {
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
pub(crate) async fn themes(State(state): State<Arc<ApiState>>) -> ApiResult {
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
pub(crate) async fn theme(
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
