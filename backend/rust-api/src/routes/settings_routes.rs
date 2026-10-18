//! Native preferences, language negotiation, presets and temporary storage.
use crate::{
    cleaner,
    engine::NativeEngine,
    infer_params::ValidationErrors,
    locale,
    processing_routes::{string, Error},
    storage, uploads,
};
use anyhow::{bail, Result};
use axum::{
    extract::{Query, Request, State},
    http::{HeaderMap, StatusCode},
    routing::{get, post},
    Json, Router,
};
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    path::Path,
    sync::{Arc, Mutex},
};
struct Settings {
    engine: Arc<NativeEngine>,
    presets: Mutex<()>,
}
pub fn router(engine: Arc<NativeEngine>) -> Router {
    Router::new()
        .route("/api/settings", get(read).put(update))
        .route("/api/settings/languages", get(languages))
        .route("/api/settings/language", get(language))
        .route("/api/settings/model-presets", get(presets).put(save_preset))
        .route("/api/settings/storage", get(stats))
        .route("/api/settings/storage/clean", post(clean))
        .route("/api/settings/presence", get(presence).post(set_presence))
        .route("/api/settings/presence/stop", post(stop_presence))
        .route("/api/settings/restart", post(restart))
        .with_state(Arc::new(Settings {
            engine,
            presets: Mutex::new(()),
        }))
}
async fn restart(State(state): State<Arc<Settings>>) -> Json<Value> {
    state.engine.restart_token().cancel();
    Json(json!({"ok":true,"message":"API is restarting.","instanceId":state.engine.instance_id}))
}

async fn presence(State(state): State<Arc<Settings>>) -> Json<Value> {
    Json(json!({"running":!state.engine.no_env()&&state.engine.presence.status().await.running}))
}
async fn stop_presence(State(state): State<Arc<Settings>>) -> Result<Json<Value>, Error> {
    state
        .engine
        .presence
        .stop()
        .await
        .map_err(Error::internal)?;
    Ok(Json(json!({"ok":true})))
}
async fn set_presence(
    State(state): State<Arc<Settings>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(request, &state.engine.runtime.uploads, &[]).await?;
    let enabled=input.body["enabled"].as_bool().ok_or_else(||Error(StatusCode::BAD_REQUEST,json!({"error":"Invalid params","details":{"formErrors":[],"fieldErrors":{"enabled":["Expected boolean"]}}})))?;
    state
        .engine
        .runtime
        .config
        .update(json!({"discord_presence":enabled}))
        .map_err(Error::internal)?;
    if enabled {
        state.engine.start_presence().await.map_err(|error|Error(StatusCode::BAD_GATEWAY,json!({"error":format!("Could not start Discord presence (is Discord running? pypresence installed?): {error}")})))?;
    } else {
        state
            .engine
            .presence
            .stop()
            .await
            .map_err(Error::internal)?;
    }
    Ok(Json(
        json!({"ok":true,"running":state.engine.presence.status().await.running}),
    ))
}
async fn read(State(state): State<Arc<Settings>>) -> Result<Json<Value>, Error> {
    let runtime = &state.engine.runtime;
    let mut value = json!({"config":runtime.config.load().map_err(Error::internal)?,"logsDir":runtime.logs,"defaultLogsDir":runtime.data.join("logs")});
    if let Some(error) = &runtime.logs_move_error {
        value["logsMoveError"] = json!(error);
    }
    Ok(Json(value))
}
fn setting_error(errors: ValidationErrors) -> Error {
    Error(
        StatusCode::BAD_REQUEST,
        json!({"error":"Invalid settings","details":errors}),
    )
}
fn nested(value: &Value, fields: &[(&str, &str)], optional: &[&str]) -> Option<Value> {
    let source = value.as_object()?;
    let mut output = Map::new();
    for (name, kind) in fields {
        let Some(value) = source.get(*name) else {
            if optional.contains(name) {
                continue;
            }
            return None;
        };
        let valid = match *kind {
            "boolean" => value.is_boolean(),
            "string" => value.is_string(),
            "nonempty" => value.as_str().is_some_and(|value| !value.is_empty()),
            "strings" => value
                .as_array()
                .is_some_and(|values| values.iter().all(Value::is_string)),
            _ => false,
        };
        if !valid {
            return None;
        }
        output.insert((*name).into(), value.clone());
    }
    Some(Value::Object(output))
}
pub(crate) fn normalize(input: &Value) -> Result<Value, ValidationErrors> {
    let mut errors = ValidationErrors::default();
    let Some(input) = input.as_object() else {
        errors.form_errors.push("Expected an object".into());
        return Err(errors);
    };
    let mut result = Map::new();
    for (key, value) in input {
        let validated = match key.as_str() {
            "logs_dir" => value.as_str().map(|_| value.clone()),
            "model_index_filter" | "discord_presence" => value.as_bool().map(|_| value.clone()),
            "model_author" => (value.is_string() || value.is_null()).then(|| value.clone()),
            "precision" => value
                .as_str()
                .filter(|value| ["fp32", "fp16", "bf16"].contains(value))
                .map(|_| value.clone()),
            "realtime" => value.as_object().map(|_| value.clone()),
            "lang" => nested(
                value,
                &[("override", "boolean"), ("selected_lang", "nonempty")],
                &[],
            ),
            "theme" => nested(value, &[("file", "string"), ("font", "strings")], &["font"]),
            "rmvpe_high_register" => {
                let valid = value["enabled"].is_boolean()
                    && value["mode"]
                        .as_str()
                        .is_some_and(|mode| ["true_pitch", "fold"].contains(&mode))
                    && value["f0_ceil"]
                        .as_f64()
                        .is_some_and(|number| (1000.0..=2000.0).contains(&number));
                valid.then(||json!({"enabled":value["enabled"],"mode":value["mode"],"f0_ceil":value["f0_ceil"]}))
            }
            _ => continue,
        };
        if let Some(value) = validated {
            result.insert(key.clone(), value);
        } else {
            errors
                .field_errors
                .insert(key.clone(), vec!["Invalid value".into()]);
        }
    }
    if errors.field_errors.is_empty() {
        Ok(Value::Object(result))
    } else {
        Err(errors)
    }
}
async fn update(
    State(state): State<Arc<Settings>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(request, &state.engine.runtime.uploads, &[]).await?;
    let mut patch = normalize(&input.body).map_err(setting_error)?;
    let engine = state.engine.clone();
    let config = tokio::task::spawn_blocking(move || -> Result<Value, Error> {
        if let Some(value) = patch["logs_dir"].as_str() {
            let destination = if value.trim().is_empty() {
                engine.runtime.data.join("logs")
            } else {
                Path::new(value.trim()).into()
            };
            if !destination.is_absolute() || value.contains('\0') {
                return Err(Error::input(
                    "Cannot use logs folder: Logs folder must be an absolute path.",
                ));
            }
            storage::validate_move(&engine.runtime.logs, &destination)
                .map_err(|error| Error::input(format!("Cannot use logs folder: {error}")))?;
            let normalized = storage::validate_logs_dir(value)
                .map_err(|error| Error::input(format!("Cannot use logs folder: {error}")))?;
            let destination = if normalized.is_empty() {
                engine.runtime.data.join("logs")
            } else {
                Path::new(&normalized).into()
            };
            patch["logs_dir"] = json!(normalized);
            patch["logs_move_from"] =
                if storage::absolute(&destination)? == storage::absolute(&engine.runtime.logs)? {
                    json!("")
                } else {
                    json!(engine.runtime.logs)
                };
        }
        engine.runtime.config.update(patch).map_err(Error::internal)
    })
    .await
    .map_err(Error::internal)??;
    Ok(Json(json!({"ok":true,"config":config})))
}
async fn languages(State(state): State<Arc<Settings>>) -> Result<Json<Value>, Error> {
    let runtime = &state.engine.runtime;
    let languages = locale::available(&runtime.code, &runtime.data);
    let config = runtime.config.load().map_err(Error::internal)?;
    let detected = locale::resolve([locale::system().as_str()], &languages);
    let named:Vec<_>=languages.iter().map(|code|json!({"code":code,"name":crate::LANGUAGES.iter().find(|(name,_)|name==code).map(|(_,label)|*label).unwrap_or(code)})).collect();
    Ok(Json(
        json!({"languages":languages,"named":named,"selected":config.get("lang").cloned().unwrap_or(json!({"override":false,"selected_lang":detected})),"detected":detected}),
    ))
}
async fn language(
    State(state): State<Arc<Settings>>,
    Query(query): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> Result<Json<Value>, Error> {
    let runtime = &state.engine.runtime;
    let config = runtime.config.load().map_err(Error::internal)?;
    let available = locale::available(&runtime.code, &runtime.data);
    let before_setup = state.engine.require_ready(false).await.is_err();
    let code = if before_setup || config["lang"]["override"] != true {
        let code = locale::resolve(
            [
                query
                    .get("clientLang")
                    .map(String::as_str)
                    .unwrap_or_default(),
                headers
                    .get("accept-language")
                    .and_then(|value| value.to_str().ok())
                    .unwrap_or_default(),
                locale::system().as_str(),
            ],
            &available,
        );
        if config["lang"]["selected_lang"] != code
            || before_setup && config["lang"]["override"] == true
        {
            let _ = runtime
                .config
                .update(json!({"lang":{"override":false,"selected_lang":code}}));
        }
        code
    } else {
        locale::resolve(
            [config["lang"]["selected_lang"].as_str().unwrap_or_default()],
            &available,
        )
    };
    Ok(Json(
        json!({"code":code,"dict":locale::dictionary(&runtime.code,&runtime.data,&code)}),
    ))
}
fn read_presets(path: &Path) -> Result<Value> {
    if !path.exists() {
        return Ok(json!({}));
    }
    let file: Value = serde_json::from_slice(&std::fs::read(path)?)?;
    if file["version"] != 1 || !file["presets"].is_object() {
        bail!("Invalid model presets file");
    }
    Ok(file["presets"].clone())
}
async fn presets(State(state): State<Arc<Settings>>) -> Result<Json<Value>, Error> {
    Ok(Json(
        json!({"presets":read_presets(&state.engine.runtime.config_dir.join("model-presets.json")).map_err(Error::internal)?}),
    ))
}
async fn save_preset(
    State(state): State<Arc<Settings>>,
    request: Request,
) -> Result<Json<Value>, Error> {
    let input = uploads::parse(request, &state.engine.runtime.uploads, &[]).await?;
    let model = string(&input.body, "model");
    let scope = string(&input.body, "scope");
    let Some(values) = input.body["values"].as_object() else {
        return Err(Error::input("Invalid model preset"));
    };
    let valid = !model.is_empty()
        && model.encode_utf16().count() <= 4096
        && ["conversion", "realtime"].contains(&scope.as_str())
        && values.len() <= 100
        && values.values().all(|value| match value {
            Value::String(value) => value.encode_utf16().count() <= 4096,
            Value::Number(value) => value.as_f64().is_some_and(f64::is_finite),
            Value::Bool(_) => true,
            _ => false,
        });
    if !valid {
        return Err(Error::input("Invalid model preset"));
    }
    let _gate = state.presets.lock().unwrap();
    let path = state.engine.runtime.config_dir.join("model-presets.json");
    let mut presets = read_presets(&path).map_err(Error::internal)?;
    presets[format!("{scope}:{}", model.replace('\\', "/"))] = json!(values);
    storage::atomic_json(&path, &json!({"version":1,"presets":presets}))
        .map_err(Error::internal)?;
    Ok(Json(json!({"ok":true})))
}
async fn stats(State(state): State<Arc<Settings>>) -> Json<Value> {
    let engine = state.engine.clone();
    Json(
        json!({"stats":tokio::task::spawn_blocking(move||cleaner::stats(&engine.runtime)).await.unwrap_or_default()}),
    )
}
async fn clean(State(state): State<Arc<Settings>>, request: Request) -> Result<Json<Value>, Error> {
    let input = uploads::parse(request, &state.engine.runtime.uploads, &[]).await?;
    let options = cleaner::Options {
        max_age_ms: input.body["maxAgeMs"].as_f64().unwrap_or_default(),
        uploads: input.body["cleanUploads"] != false,
        outputs: input.body["cleanOutputs"] != false,
    };
    let engine = state.engine.clone();
    let result = tokio::task::spawn_blocking(move || cleaner::clean(&engine, options))
        .await
        .map_err(Error::internal)?;
    Ok(Json(json!({"ok":true,"result":result})))
}
