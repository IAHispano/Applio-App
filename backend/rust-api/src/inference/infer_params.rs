//! Conversion/TTS parameter validation and CLI argument construction. The JSON
//! contract was exported from the existing API before removing its Zod schemas.
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Number, Value};
use std::{collections::BTreeMap, sync::OnceLock};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contract {
    inference: Vec<Field>,
    tts: Vec<Field>,
    cli_order: Vec<String>,
}
#[derive(Deserialize)]
struct Field {
    name: String,
    #[serde(rename = "type")]
    kind: String,
    default: Option<Value>,
    min: Option<f64>,
    max: Option<f64>,
    #[serde(default)]
    integer: bool,
    #[serde(default)]
    values: Vec<String>,
    #[serde(default)]
    optional: bool,
    pattern: Option<String>,
    #[serde(default)]
    trim: bool,
}
fn contract() -> &'static Contract {
    static CONTRACT: OnceLock<Contract> = OnceLock::new();
    CONTRACT.get_or_init(|| {
        serde_json::from_str(include_str!("inference-schema.json"))
            .expect("valid parameter contract")
    })
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationErrors {
    pub form_errors: Vec<String>,
    pub field_errors: BTreeMap<String, Vec<String>>,
}
impl std::fmt::Display for ValidationErrors {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "Invalid params")?;
        for (key, errors) in &self.field_errors {
            write!(f, "; {key}: {}", errors.join(", "))?;
        }
        Ok(())
    }
}
impl std::error::Error for ValidationErrors {}
impl ValidationErrors {
    pub fn body(&self) -> Value {
        json!({"error": "Invalid params", "details": self})
    }
}

pub fn inference(input: &Value) -> Result<Value, ValidationErrors> {
    normalize(input, false, false, true)
}
pub fn tts(input: &Value) -> Result<Value, ValidationErrors> {
    let params = normalize(input, true, false, true)?;
    let field = if params["ttsProvider"] == "rvc" {
        "ttsFrontend"
    } else {
        "ttsVoice"
    };
    if params[field]
        .as_str()
        .is_none_or(|value| value.trim().is_empty())
    {
        let mut errors = ValidationErrors::default();
        errors
            .field_errors
            .insert(field.into(), vec!["Expected a nonempty string".into()]);
        return Err(errors);
    }
    if params["ttsProvider"] == "rvc" {
        let mut errors = ValidationErrors::default();
        if params["exportFormat"] != "WAV" {
            errors.field_errors.insert(
                "exportFormat".into(),
                vec!["Direct RVC speech supports WAV output".into()],
            );
        }
        if params["indexPath"] != "" {
            errors.field_errors.insert(
                "indexPath".into(),
                vec!["Direct RVC speech does not use an audio feature index".into()],
            );
        }
        if !errors.field_errors.is_empty() {
            return Err(errors);
        }
    }
    Ok(params)
}
pub fn batch_base(input: &Value) -> Result<Value, ValidationErrors> {
    normalize(input, false, false, false)
}
pub fn overrides(input: &Value) -> Result<Value, ValidationErrors> {
    normalize(input, false, true, true)
}

pub struct ParameterSchema(Vec<Field>);
impl ParameterSchema {
    pub fn from_json(source: &str) -> Self {
        Self(serde_json::from_str(source).expect("valid parameter schema"))
    }
    pub fn normalize(&self, input: &Value) -> Result<Value, ValidationErrors> {
        let mut errors = ValidationErrors::default();
        let Some(input) = input.as_object() else {
            errors.form_errors.push("Expected an object".into());
            return Err(errors);
        };
        let mut output = Map::new();
        for field in &self.0 {
            let value = input.get(&field.name).or(field.default.as_ref());
            if field.optional && value.is_none() {
                continue;
            }
            match value
                .ok_or_else(|| "Required".to_string())
                .and_then(|value| validate(field, value, false))
            {
                Ok(value) => {
                    output.insert(field.name.clone(), value);
                }
                Err(error) => {
                    errors
                        .field_errors
                        .entry(field.name.clone())
                        .or_default()
                        .push(error);
                }
            }
        }
        if errors.field_errors.is_empty() {
            Ok(Value::Object(output))
        } else {
            Err(errors)
        }
    }
}

fn normalize(
    input: &Value,
    tts: bool,
    partial: bool,
    require_model: bool,
) -> Result<Value, ValidationErrors> {
    let mut errors = ValidationErrors::default();
    let Some(input) = input.as_object() else {
        errors.form_errors.push("Expected an object".into());
        return Err(errors);
    };
    let mut output = Map::new();
    let fields = contract()
        .inference
        .iter()
        .chain(contract().tts.iter().filter(|_| tts));
    for field in fields {
        if partial && !input.contains_key(&field.name) {
            continue;
        }
        let model_optional = field.name == "pthPath" && !require_model;
        let value = input.get(&field.name).or(field.default.as_ref());
        if model_optional && value.is_none() {
            output.insert(field.name.clone(), json!(""));
            continue;
        }
        let result = value
            .ok_or_else(|| "Required".to_string())
            .and_then(|value| validate(field, value, model_optional));
        match result {
            Ok(value) => {
                output.insert(field.name.clone(), value);
            }
            Err(error) => {
                errors
                    .field_errors
                    .entry(field.name.clone())
                    .or_default()
                    .push(error);
            }
        }
    }
    if errors.field_errors.is_empty() {
        Ok(Value::Object(output))
    } else {
        Err(errors)
    }
}

fn validate(field: &Field, value: &Value, allow_empty: bool) -> Result<Value, String> {
    match field.kind.as_str() {
        "string" => {
            let value = value.as_str().ok_or("Expected string")?;
            let value = if field.trim { value.trim() } else { value };
            if field.pattern.as_ref().is_some_and(|pattern| {
                !regex::Regex::new(pattern)
                    .expect("valid schema pattern")
                    .is_match(value)
            }) {
                return Err("Invalid string".into());
            }
            let size = value.encode_utf16().count() as f64;
            if !allow_empty && field.min.is_some_and(|min| size < min) {
                return Err(format!(
                    "String must contain at least {} character(s)",
                    field.min.unwrap()
                ));
            }
            if field.max.is_some_and(|max| size > max) {
                return Err(format!(
                    "String must contain at most {} character(s)",
                    field.max.unwrap()
                ));
            }
            Ok(json!(value))
        }
        "enum" => {
            let value = value.as_str().ok_or("Expected string")?;
            if !field.values.iter().any(|item| item == value) {
                return Err(format!("Expected one of {}", field.values.join(", ")));
            }
            Ok(json!(value))
        }
        "number" => {
            let number = match value {
                Value::Null => 0.0,
                Value::Bool(value) => {
                    if *value {
                        1.0
                    } else {
                        0.0
                    }
                }
                Value::Number(value) => value.as_f64().ok_or("Expected number")?,
                Value::String(value) => {
                    let value = value.trim();
                    if value.is_empty() {
                        0.0
                    } else {
                        value.parse::<f64>().map_err(|_| "Expected number")?
                    }
                }
                _ => return Err("Expected number".into()),
            };
            if !number.is_finite() {
                return Err("Number must be finite".into());
            }
            if field.integer && number.fract() != 0.0 {
                return Err("Expected integer".into());
            }
            if field.min.is_some_and(|min| number < min) {
                return Err(format!(
                    "Number must be greater than or equal to {}",
                    field.min.unwrap()
                ));
            }
            if field.max.is_some_and(|max| number > max) {
                return Err(format!(
                    "Number must be less than or equal to {}",
                    field.max.unwrap()
                ));
            }
            if number.fract() == 0.0 && number >= i64::MIN as f64 && number < i64::MAX as f64 {
                Ok(json!(number as i64))
            } else {
                Ok(Value::Number(Number::from_f64(number).unwrap()))
            }
        }
        "boolean" => {
            let value = match value {
                Value::Null => return Err("Required".into()),
                Value::Bool(value) => *value,
                Value::Number(value) => value.as_f64() != Some(0.0),
                Value::String(value) => !matches!(
                    value.trim().to_lowercase().as_str(),
                    "false" | "0" | "no" | "off" | ""
                ),
                _ => true,
            };
            Ok(json!(value))
        }
        _ => Err("Unsupported parameter type".into()),
    }
}

/// Arguments go directly to the child process, never through a shell. Preserve
/// the existing flag order and the special custom-embedder condition.
pub fn common_cli_args(params: &Value) -> Vec<String> {
    let mut arguments = Vec::new();
    for name in &contract().cli_order {
        if name == "embedderModelCustom"
            && (params["embedderModel"] != "custom"
                || params[name].as_str().unwrap_or("").is_empty())
        {
            continue;
        }
        let Some(value) = params.get(name) else {
            continue;
        };
        let mut flag = String::from("--");
        for character in name.chars() {
            if character.is_ascii_uppercase() {
                flag.push('-');
                flag.push(character.to_ascii_lowercase());
            } else {
                flag.push(character);
            }
        }
        if let Value::Bool(enabled) = value {
            if *enabled {
                arguments.push(flag);
            }
        } else {
            arguments.push(flag);
            arguments.push(
                value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string()),
            );
        }
    }
    arguments
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tts_providers_keep_edge_as_the_legacy_default() {
        let mut input = json!({"pthPath":"voice.pth", "ttsVoice":"en-US-AnaNeural"});
        assert_eq!(tts(&input).unwrap()["ttsProvider"], "edge");
        for provider in ["edge"] {
            input["ttsProvider"] = json!(provider);
            assert_eq!(tts(&input).unwrap()["ttsProvider"], provider);
        }
        input["ttsProvider"] = json!("unknown");
        assert!(tts(&input)
            .unwrap_err()
            .field_errors
            .contains_key("ttsProvider"));
    }

    #[test]
    fn direct_speech_requires_a_frontend_and_rejects_unsupported_outputs() {
        let mut input = json!({"pthPath":"voice.pth","ttsProvider":"rvc","ttsText":"Hello"});
        assert!(tts(&input)
            .unwrap_err()
            .field_errors
            .contains_key("ttsFrontend"));
        input["ttsFrontend"] = json!("logs/tts/voice/frontend.pt");
        assert_eq!(tts(&input).unwrap()["ttsVoice"], "");
        input["exportFormat"] = json!("MP3");
        assert!(tts(&input)
            .unwrap_err()
            .field_errors
            .contains_key("exportFormat"));
        input["exportFormat"] = json!("WAV");
        input["indexPath"] = json!("voice.index");
        assert!(tts(&input)
            .unwrap_err()
            .field_errors
            .contains_key("indexPath"));
    }

    #[test]
    fn retired_split_audio_is_ignored_without_shifting_other_conversion_options() {
        let legacy = json!({
            "pthPath": "voice.pth", "ttsVoice": "en-US-AnaNeural", "ttsText": "Hello",
            "splitAudio": true, "f0Autotune": true,
            "f0AutotuneStrength": 0.6, "proposedPitch": true,
            "proposedPitchThreshold": 180, "sid": 3, "formantShifting": true,
            "formantQfrency": 1.2, "formantTimbre": 1.4
        });
        for params in [
            inference(&legacy),
            tts(&legacy),
            batch_base(&legacy),
            overrides(&legacy),
        ] {
            let params = params.unwrap();
            assert!(params.get("splitAudio").is_none());
            assert_eq!(params["f0Autotune"], true);
            assert_eq!(params["f0AutotuneStrength"], 0.6);
            assert_eq!(params["proposedPitchThreshold"], 180);
            assert_eq!(params["sid"], 3);
            let args = common_cli_args(&params);
            assert!(!args.iter().any(|arg| arg == "--split-audio"));
            assert!(args.contains(&"--f0-autotune".into()));
            assert!(args.contains(&"--formant-shifting".into()));
        }
        assert_eq!(overrides(&json!({"splitAudio": true})).unwrap(), json!({}));
    }
}
