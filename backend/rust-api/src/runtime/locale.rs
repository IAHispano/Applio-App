//! UI language negotiation shared by settings and first-run preferences.
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
pub fn system() -> String {
    ["APPLIO_LOCALE", "LC_ALL", "LC_MESSAGES", "LANG", "LANGUAGE"]
        .into_iter()
        .find_map(|name| {
            std::env::var(name)
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(sys_locale::get_locale)
        .unwrap_or_else(|| "en_US".into())
}
fn directory(code: &Path, data: &Path) -> PathBuf {
    let shipped = code.join("assets/i18n/languages");
    if shipped.is_dir() {
        shipped
    } else {
        data.join("assets/i18n/languages")
    }
}
pub fn available(code: &Path, data: &Path) -> Vec<String> {
    let mut languages: Vec<_> = std::fs::read_dir(directory(code, data))
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| {
            entry
                .file_name()
                .to_str()
                .and_then(|name| name.strip_suffix(".json"))
                .map(str::to_owned)
        })
        .collect();
    if languages.is_empty() {
        languages = crate::LANGUAGES
            .iter()
            .map(|(code, _)| (*code).into())
            .collect();
    }
    languages.sort();
    languages
}
pub fn resolve<'a>(candidates: impl IntoIterator<Item = &'a str>, available: &[String]) -> String {
    for candidate in candidates {
        for value in candidate.split([',', ';']) {
            let value = value.trim();
            if value.is_empty() || value.starts_with("q=") {
                continue;
            }
            let value = value
                .split('.')
                .next()
                .unwrap_or_default()
                .replace('-', "_");
            if let Some(code) = available
                .iter()
                .find(|code| code.eq_ignore_ascii_case(&value))
            {
                return code.clone();
            }
            let prefix = value.split('_').next().unwrap_or_default().to_lowercase() + "_";
            if let Some(code) = available
                .iter()
                .find(|code| code.to_lowercase().starts_with(&prefix))
            {
                return code.clone();
            }
        }
    }
    "en_US".into()
}
pub fn dictionary(code: &Path, data: &Path, language: &str) -> Value {
    let dir = directory(code, data);
    let path = dir.join(format!("{language}.json"));
    let path = if path.is_file() {
        path
    } else {
        dir.join("en_US.json")
    };
    std::fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .filter(Value::is_object)
        .unwrap_or_else(|| json!({}))
}
