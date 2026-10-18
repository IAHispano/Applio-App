//! One catalog drives the authenticated allowlist, OpenAPI and in-app reference.
use serde_json::{json, Value};
use std::sync::OnceLock;

fn field_schema(field: &Value) -> Value {
    let kind = field["type"].as_str().unwrap_or("string");
    let mut schema = json!({"type": match kind {"enum" => "string", "number" if field["integer"] == true => "integer", value => value}});
    for (source, target) in [
        ("values", "enum"),
        ("default", "default"),
        (
            "min",
            if kind == "string" {
                "minLength"
            } else {
                "minimum"
            },
        ),
        (
            "max",
            if kind == "string" {
                "maxLength"
            } else {
                "maximum"
            },
        ),
    ] {
        if let Some(value) = field.get(source) {
            schema[target] = value.clone();
        }
    }
    schema
}

pub(crate) fn catalog() -> &'static Value {
    static CATALOG: OnceLock<Value> = OnceLock::new();
    CATALOG.get_or_init(|| {
        let mut operations: Value =
            serde_json::from_str(include_str!("../../../../assets/api-endpoints.json"))
                .expect("valid API catalog");
        let inference: Value =
            serde_json::from_str(include_str!("../inference/inference-schema.json")).unwrap();
        let training: Value =
            serde_json::from_str(include_str!("../training/training-schema.json")).unwrap();
        let separation: Value = serde_json::from_str(include_str!("uvr-schema.json")).unwrap();
        for operation in operations.as_array_mut().unwrap() {
            let source = operation["schema"].as_str().unwrap_or("").to_owned();
            let fields: Vec<&Value> = match source.as_str() {
                "inference" | "batch" => {
                    inference["inference"].as_array().unwrap().iter().collect()
                }
                "tts" => inference["inference"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .chain(inference["tts"].as_array().unwrap())
                    .collect(),
                "uvr" => separation.as_array().unwrap().iter().collect(),
                value if value.starts_with("training:") => {
                    training[&value[9..]].as_array().unwrap().iter().collect()
                }
                _ => Vec::new(),
            };
            if !operation["properties"].is_object() {
                operation["properties"] = json!({});
            }
            let mut required = operation["required"]
                .as_array()
                .cloned()
                .unwrap_or_default();
            for field in fields {
                let name = field["name"].as_str().unwrap();
                operation["properties"][name] = field_schema(field);
                if field.get("default").is_none() && field["optional"] != true {
                    required.push(json!(name));
                }
            }
            if source == "batch" {
                required.retain(|field| field != "pthPath");
                required.push(json!("outputFolder"));
            }
            operation["required"] = json!(required);
        }
        operations
    })
}

pub(crate) fn allowed(method: &str, path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    if path.contains('\\')
        || ["%5c", "%2e", "%25", "%00"]
            .iter()
            .any(|part| lower.contains(part))
        || path.split('/').any(|part| matches!(part, "." | ".."))
    {
        return false;
    }
    catalog().as_array().unwrap().iter().any(|operation| {
        let expected = operation["path"].as_str().unwrap();
        let expected: Vec<_> = expected.split('/').collect();
        let actual: Vec<_> = path.split('/').collect();
        (operation["method"] == method || method == "HEAD" && operation["method"] == "GET")
            && expected.len() == actual.len()
            && expected.iter().zip(actual).all(|(expected, actual)| {
                !actual.is_empty() && expected.starts_with('{') || *expected == actual
            })
    })
}

pub(crate) fn add_openapi(schema: &mut Value) {
    for operation in catalog().as_array().unwrap() {
        let method = operation["method"].as_str().unwrap().to_lowercase();
        let path = operation["path"].as_str().unwrap();
        let response = operation["response"].as_str().unwrap();
        let mut entry = json!({"tags":[operation["group"]],"summary":path,"x-applio-response":response,"responses":{"200":{"description":"Native application response"},"400":{"description":"Invalid native parameters; error and optional details.fieldErrors"},"401":{"description":"Bearer API key required"},"503":{"description":"Engine or dependencies unavailable"}}});
        if response == "job" {
            entry["responses"]["202"] = json!({"description":"Queued; returns jobId. Poll or stream until done/error.","content":{"application/json":{"schema":{"type":"object","required":["jobId"],"properties":{"jobId":{"type":"string"}}}}}});
        }
        if response == "sse" {
            entry["responses"]["200"] = json!({"description":"Native job events with heartbeat events","content":{"text/event-stream":{"schema":{"type":"string"}}}});
        }
        if response == "file" {
            entry["responses"]["200"] = json!({"description":"File bytes; supports native range/download behavior","content":{"application/octet-stream":{"schema":{"type":"string","format":"binary"}}}});
        }
        if response == "websocket" {
            entry["responses"]["101"] = json!({"description":"WebSocket upgrade; send Bearer authorization in the handshake"});
        }
        let mut parameters = Vec::new();
        for segment in path.split('/').filter(|segment| segment.starts_with('{')) {
            parameters.push(json!({"name":segment.trim_matches(['{','}']),"in":"path","required":true,"schema":{"type":"string"}}));
        }
        if let Some(query) = operation["query"].as_object() {
            for (name, value) in query {
                parameters.push(
                    json!({"name":name,"in":"query","schema":{"type":"string"},"example":value}),
                );
            }
        }
        if !parameters.is_empty() {
            entry["parameters"] = json!(parameters);
        }
        if matches!(method.as_str(), "post" | "put")
            && (operation["properties"]
                .as_object()
                .is_some_and(|p| !p.is_empty())
                || operation["files"].is_object())
        {
            let mut body = json!({"type":"object","properties":operation["properties"],"required":operation["required"],"additionalProperties":true});
            entry["requestBody"] = json!({"required":true,"content":{"application/json":{"schema":body,"example":operation["example"]}}});
            if let Some(files) = operation["files"].as_object() {
                for (name, file) in files {
                    body["properties"][name] = if file["multiple"] == true {
                        json!({"type":"array","items":{"type":"string","format":"binary"}})
                    } else {
                        json!({"type":"string","format":"binary"})
                    };
                }
                for (name, file) in files {
                    if file["required"] == true {
                        body["required"].as_array_mut().unwrap().push(json!(name));
                    }
                }
                entry["requestBody"]["content"]["multipart/form-data"] = json!({"schema":body});
                if operation["uploadOnly"] == true {
                    entry["requestBody"]["content"]
                        .as_object_mut()
                        .unwrap()
                        .remove("application/json");
                }
            }
        }
        schema["paths"][path][method] = entry;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn catalog_preserves_contracts_and_narrow_dispatch() {
        let operations = catalog();
        let find = |path: &str| {
            operations
                .as_array()
                .unwrap()
                .iter()
                .find(|op| op["path"] == path && op["method"] == "POST")
                .unwrap()
        };
        assert_eq!(
            find("/v1/applio/inference")["properties"]["indexRate"]["maximum"],
            1
        );
        assert_eq!(
            find("/v1/applio/voice-blender")["properties"]["ratio"]["maximum"],
            1
        );
        assert_eq!(
            find("/v1/applio/train/train")["properties"]["totalEpoch"]["type"],
            "integer"
        );
        assert!(!find("/v1/applio/inference/batch")["required"]
            .as_array()
            .unwrap()
            .contains(&json!("pthPath")));
        for (method, path, valid) in [
            ("POST", "/v1/applio/download", true),
            ("PUT", "/v1/applio/realtime/config", true),
            ("GET", "/v1/applio/jobs/abc/events", true),
            ("DELETE", "/v1/applio/models/logs%2Fvoice%2Fvoice.pth", true),
            ("POST", "/v1/applio/integrations/key", false),
            ("POST", "/v1/applio/models/library", false),
            ("GET", "/v1/applio/outputs/secrets", false),
            ("GET", "/v1/applio/../settings", false),
        ] {
            assert_eq!(allowed(method, path), valid, "{method} {path}");
        }
        let mut schema = json!({"paths":{}});
        add_openapi(&mut schema);
        assert!(
            schema["paths"]["/v1/applio/inference"]["post"]["requestBody"]["content"]
                ["multipart/form-data"]
                .is_object()
        );
        assert!(
            schema["paths"]["/v1/applio/train/upload-dataset"]["post"]["requestBody"]["content"]
                .get("application/json")
                .is_none()
        );
        assert_eq!(
            schema["paths"]["/v1/applio/jobs/{id}/events"]["get"]["x-applio-response"],
            "sse"
        );
        assert_eq!(
            schema["paths"]["/v1/applio/realtime/ws-audio"]["get"]["x-applio-response"],
            "websocket"
        );
    }
}
