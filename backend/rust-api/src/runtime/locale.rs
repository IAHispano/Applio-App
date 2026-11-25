//! UI language negotiation shared by settings and first-run preferences.
use super::metadata_cache::{stamp, Stamp};
use serde_json::{json, Value};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
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
struct Dictionary {
    path: PathBuf,
    stamp: Stamp,
    value: Arc<Value>,
}

pub fn shared_dictionary(code: &Path, data: &Path, language: &str) -> Arc<Value> {
    static LAST_DICTIONARY: Mutex<Option<Dictionary>> = Mutex::new(None);
    let dir = directory(code, data);
    let path = dir.join(format!("{language}.json"));
    let path = if path.is_file() {
        path
    } else {
        dir.join("en_US.json")
    };
    let before = stamp(&path).ok().flatten();
    let mut cached = LAST_DICTIONARY.lock().unwrap();
    if let Some(entry) = cached
        .as_ref()
        .filter(|entry| entry.path == path && Some(&entry.stamp) == before.as_ref())
    {
        return entry.value.clone();
    }
    let Some(value) = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
        .filter(Value::is_object)
    else {
        return Arc::new(json!({}));
    };
    let value = Arc::new(value);
    if let Some(stamp) =
        before.filter(|before| stamp(&path).ok().flatten().as_ref() == Some(before))
    {
        *cached = Some(Dictionary {
            path,
            stamp,
            value: value.clone(),
        });
    }
    value
}

pub fn dictionary(code: &Path, data: &Path, language: &str) -> Value {
    shared_dictionary(code, data, language).as_ref().clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{Duration, UNIX_EPOCH},
    };

    #[test]
    fn dictionary_handles_replaced_and_missing_translation_files() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("assets/i18n/languages");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("en_US.json"), r#"{"Title":"English"}"#).unwrap();
        let spanish = dir.join("es_ES.json");
        fs::write(&spanish, r#"{"Title":"Hola"}"#).unwrap();
        let get = || shared_dictionary(root.path(), root.path(), "es_ES");
        let original = get();
        assert_eq!(original["Title"], "Hola");
        fs::write(&spanish, r#"{"Title":"Olas"}"#).unwrap();
        fs::OpenOptions::new()
            .write(true)
            .open(&spanish)
            .unwrap()
            .set_modified(UNIX_EPOCH + Duration::from_secs(1_000_000_000))
            .unwrap();
        assert_eq!(get()["Title"], "Olas");
        assert_eq!(original["Title"], "Hola");
        fs::remove_file(spanish).unwrap();
        assert_eq!(get()["Title"], "English");
    }
}
