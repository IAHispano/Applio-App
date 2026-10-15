use anyhow::Result;
use base64::Engine;
use serde_json::{json, Value};
use std::sync::OnceLock;
fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
pub fn pairing_page(language: &str, dictionary: &Value) -> Result<(String, String)> {
    static TEMPLATE: OnceLock<Value> = OnceLock::new();
    let template =
        TEMPLATE.get_or_init(|| serde_json::from_str(include_str!("bridge-page.json")).unwrap());
    let nonce =
        base64::engine::general_purpose::STANDARD.encode(crate::bridge_sessions::random::<16>()?);
    let mut messages = serde_json::Map::new();
    for key in template["keys"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(Value::as_str)
    {
        messages.insert(
            key.into(),
            json!(dictionary[key]
                .as_str()
                .filter(|s| !s.is_empty())
                .unwrap_or(key)),
        );
    }
    let lang = language
        .split(['_', '-'])
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or("en");
    let script = serde_json::to_string(&messages)?.replace('<', r"\u003c");
    let mut html = String::new();
    for segment in template["segments"].as_array().unwrap() {
        if let Some(text) = segment["text"].as_str() {
            html.push_str(text);
            continue;
        }
        match segment["kind"].as_str().unwrap() {
            "lang" => html.push_str(&escape(lang)),
            "nonce" => html.push_str(&nonce),
            "direction" => html.push_str(if lang == "ar" { "rtl" } else { "ltr" }),
            "scriptMessages" => html.push_str(&script),
            "translation" => html.push_str(&escape(
                messages[segment["key"].as_str().unwrap()].as_str().unwrap(),
            )),
            _ => unreachable!(),
        }
    }
    Ok((html, nonce))
}
#[cfg(test)]
mod checks {
    #[test]
    fn pairing_page_preserves_localization_and_escapes_html_and_script_contexts() {
        let (html, nonce) = super::pairing_page(
            "ar_SA",
            &serde_json::json!({"Bridge Mode":"جسر </script><script>bad()</script>"}),
        )
        .unwrap();
        assert!(html.contains("dir=\"rtl\""));
        assert!(html.contains("جسر &lt;/script&gt;"));
        assert!(html.contains(r"\u003c/script>"));
        assert!(!html.contains("<script>bad()"));
        assert!(html.contains(&format!("nonce=\"{nonce}\"")));
        assert!(html.contains("history.replaceState"));
        assert!(html.contains("/bridge/pair"));
    }
}
