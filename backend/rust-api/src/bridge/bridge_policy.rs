use regex::Regex;
use std::sync::OnceLock;
pub fn api_allowed(method: &str, path: &str) -> bool {
    if path.ends_with("/events") {
        return false;
    }
    if matches!(method, "GET" | "HEAD") {
        static SAFE: OnceLock<Regex> = OnceLock::new();
        return SAFE.get_or_init(||Regex::new(r"^(?:/api/(?:models(?:/|$)|jobs(?:/|$)|tts/voices$|uvr/models$|uvr/variants$|audio/raw$|health$|setup/status$|train/gpus$)|/api/settings(?:/(?:language|languages|theme|themes|model-presets|version))?$|/api/inference/batch/[a-zA-Z0-9_-]+/outputs/\d+$)").unwrap()).is_match(path);
    }
    if method == "PUT" {
        return path == "/api/settings/model-presets";
    }
    if method != "POST" {
        return false;
    }
    if [
        "/api/inference",
        "/api/inference/batch",
        "/api/inference/batch/preview",
        "/api/tts",
        "/api/uvr/separate",
        "/api/uvr/custom-models",
        "/api/extra/analyze",
        "/api/extra/f0",
        "/api/extra/model-info",
        "/api/models/inspect",
        "/api/models/preload",
        "/api/audio/youtube",
    ]
    .contains(&path)
    {
        return true;
    }
    static STOP: OnceLock<Regex> = OnceLock::new();
    STOP.get_or_init(|| Regex::new(r"^/api/jobs/[a-zA-Z0-9_-]+/stop$").unwrap())
        .is_match(path)
}
