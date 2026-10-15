//! Native training normalization checked against the legacy Zod/CLI contract.
use crate::{
    infer_params::{ParameterSchema, ValidationErrors},
    processing_routes::string,
};
use serde_json::{json, Value};
use std::{collections::HashMap, path::Path, sync::OnceLock};
pub fn cores() -> usize {
    std::thread::available_parallelism()
        .map_or(1, usize::from)
        .min(32)
}
pub fn normalize(kind: &str, input: &Value) -> Result<Value, ValidationErrors> {
    static SCHEMAS: OnceLock<HashMap<String, ParameterSchema>> = OnceLock::new();
    let schemas = SCHEMAS.get_or_init(|| {
        serde_json::from_str::<HashMap<String, Value>>(include_str!("training-schema.json"))
            .unwrap()
            .into_iter()
            .map(|(key, value)| (key, ParameterSchema::from_json(&value.to_string())))
            .collect()
    });
    let Some(schema) = schemas.get(kind) else {
        let mut error = ValidationErrors::default();
        error.form_errors.push("Unknown training step".into());
        return Err(error);
    };
    let mut input = input.clone();
    if input.is_object() && kind != "index" && input.get("cpuCores").is_none() {
        input["cpuCores"] = json!(cores());
    }
    schema.normalize(&input)
}
fn number(params: &Value, key: &str) -> String {
    params[key]
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| params[key].to_string())
}
fn boolean(params: &Value, key: &str) -> String {
    if params[key] == true { "True" } else { "False" }.into()
}
// JavaScript toFixed(1) rounds the exact stored binary float, not value*10
// rounded as another binary float (e.g. 1.15 -> 1.1, 1.25 -> 1.3).
fn fixed_one(value: f64) -> String {
    let bits = value.to_bits();
    let exponent = ((bits >> 52) & 0x7ff) as i32;
    let mantissa = (bits & ((1_u64 << 52) - 1)) | if exponent == 0 { 0 } else { 1_u64 << 52 };
    let shift = if exponent == 0 {
        -1074
    } else {
        exponent - 1023 - 52
    };
    let scaled = mantissa as u128 * 10;
    let rounded = if shift >= 0 {
        scaled << shift
    } else if -shift >= 128 {
        0
    } else {
        (scaled + (1_u128 << (-shift - 1))) >> (-shift)
    };
    format!("{}.{}", rounded / 10, rounded % 10)
}
pub fn preprocess(params: &Value, logs: &Path) -> Vec<String> {
    vec![
        "rvc/train/preprocess/preprocess.py".into(),
        logs.join(string(params, "modelName"))
            .to_string_lossy()
            .into_owned(),
        string(params, "datasetPath"),
        string(params, "sampleRate"),
        number(params, "cpuCores"),
        string(params, "cutPreprocess"),
        boolean(params, "processEffects"),
        fixed_one(params["chunkLen"].as_f64().unwrap_or_default()),
        fixed_one(params["overlapLen"].as_f64().unwrap_or_default()),
        string(params, "normalizationMode"),
    ]
}
pub fn extract(params: &Value, logs: &Path) -> Vec<String> {
    vec![
        "rvc/train/extract/extract.py".into(),
        logs.join(string(params, "modelName"))
            .to_string_lossy()
            .into_owned(),
        string(params, "f0Method"),
        number(params, "cpuCores"),
        string(params, "gpu"),
        string(params, "sampleRate"),
        string(params, "embedderModel"),
        params["embedderModelCustom"]
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("None")
            .into(),
        number(params, "includeMutes"),
    ]
}
pub fn train(params: &Value, pretrained: &[String; 2]) -> Vec<String> {
    vec![
        "rvc/train/train.py".into(),
        string(params, "modelName"),
        number(params, "saveEveryEpoch"),
        number(params, "totalEpoch"),
        pretrained[0].clone(),
        pretrained[1].clone(),
        string(params, "gpu"),
        number(params, "batchSize"),
        string(params, "sampleRate"),
        boolean(params, "saveOnlyLatest"),
        boolean(params, "saveEveryWeights"),
        boolean(params, "cacheDataInGpu"),
        boolean(params, "cleanup"),
        string(params, "vocoder"),
        boolean(params, "checkpointing"),
    ]
}
pub fn index(params: &Value, logs: &Path) -> Vec<String> {
    vec![
        "rvc/train/process/extract_index.py".into(),
        logs.join(string(params, "modelName"))
            .to_string_lossy()
            .into_owned(),
        string(params, "indexAlgorithm"),
    ]
}
