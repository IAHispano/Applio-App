//! Read a consistent language selection and dictionary for a desktop operation.
use serde_json::Value;
use std::path::Path;

pub fn load(code: &Path, config: &Path) -> (String, Value) {
    let settings = std::fs::read(config.join("config.json"))
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok());
    let language = settings
        .as_ref()
        .and_then(|value| value["lang"]["selected_lang"].as_str())
        .filter(|value| {
            value.len() == 5
                && value.as_bytes()[2] == b'_'
                && value
                    .bytes()
                    .enumerate()
                    .all(|(index, byte)| index == 2 || byte.is_ascii_alphabetic())
        })
        .unwrap_or("en_US")
        .to_owned();
    let dictionary = applio_api::locale::dictionary(code, code, &language);
    (language, dictionary)
}
