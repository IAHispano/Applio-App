//! Streaming multipart uploads with per-field policies and failure cleanup.
use anyhow::{bail, Context, Result};
use axum::{
    extract::{FromRequest, Multipart, Request},
    http::header,
};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
};
use tokio::io::AsyncWriteExt;
use uuid::Uuid;

pub(crate) fn active_uploads() -> MutexGuard<'static, HashSet<PathBuf>> {
    static FILES: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();
    FILES
        .get_or_init(Mutex::default)
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

/// Preserve Unicode download names while keeping the header itself ASCII.
pub fn attachment(filename: &std::ffi::OsStr) -> axum::http::HeaderValue {
    let name = filename.to_string_lossy();
    let fallback: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || ['.', '_', '-', ' '].contains(&c) {
                c
            } else {
                '_'
            }
        })
        .collect();
    let mut encoded = String::new();
    for byte in name.bytes() {
        if byte.is_ascii_alphanumeric() || b"._-".contains(&byte) {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    format!("attachment; filename=\"{fallback}\"; filename*=UTF-8''{encoded}")
        .parse()
        .expect("ASCII attachment header")
}

pub struct UploadRule {
    pub name: &'static str,
    pub extensions: &'static [&'static str],
    pub max_bytes: usize,
    pub max_files: usize,
}
pub const AUDIO_EXTENSIONS: &[&str] = &[
    "wav", "mp3", "flac", "ogg", "opus", "m4a", "mp4", "aac", "alac", "wma", "aiff", "webm", "ac3",
];
pub fn audio_rule() -> Vec<UploadRule> {
    vec![UploadRule {
        name: "audio",
        extensions: AUDIO_EXTENSIONS,
        max_bytes: 200 * 1024 * 1024,
        max_files: 1,
    }]
}
pub fn text_rule() -> Vec<UploadRule> {
    vec![UploadRule {
        name: "txt_file",
        extensions: &["txt"],
        max_bytes: 5 * 1024 * 1024,
        max_files: 1,
    }]
}
pub fn blend_rules() -> Vec<UploadRule> {
    ["pth_file_1", "pth_file_2"]
        .into_iter()
        .map(|name| UploadRule {
            name,
            extensions: &["pth"],
            max_bytes: 1024 * 1024 * 1024,
            max_files: 1,
        })
        .collect()
}

pub struct UploadedFile {
    pub path: PathBuf,
    pub original_name: String,
    pub bytes: usize,
}
pub struct Input {
    pub body: Value,
    pub files: HashMap<String, UploadedFile>,
    pub repeated: HashMap<String, Vec<UploadedFile>>,
    retained: bool,
}
impl Input {
    pub fn retain(&mut self) {
        self.retained = true;
    }
    pub fn file(&self, field: &str) -> Option<&Path> {
        self.files.get(field).map(|file| file.path.as_path())
    }
}
impl Drop for Input {
    fn drop(&mut self) {
        let mut active = active_uploads();
        for file in self.files.values().chain(self.repeated.values().flatten()) {
            active.remove(&file.path);
        }
        if !self.retained {
            for file in self.files.values() {
                let _ = std::fs::remove_file(&file.path);
            }
            for file in self.repeated.values().flatten() {
                let _ = std::fs::remove_file(&file.path);
            }
        }
    }
}

pub async fn parse(request: Request, directory: &Path, rules: &[UploadRule]) -> Result<Input> {
    let multipart = request
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| {
            value
                .to_ascii_lowercase()
                .starts_with("multipart/form-data")
        });
    let mut input = Input {
        body: json!({}),
        files: HashMap::new(),
        repeated: HashMap::new(),
        retained: false,
    };
    if !multipart {
        let content_type = request
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or("")
            .to_owned();
        let bytes = axum::body::to_bytes(request.into_body(), 2 * 1024 * 1024)
            .await
            .context("JSON request exceeds 2 MB or could not be read")?;
        if bytes.is_empty() {
            return Ok(input);
        }
        if !content_type
            .split(';')
            .next()
            .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
        {
            bail!("Expected application/json or multipart/form-data");
        }
        input.body = serde_json::from_slice(&bytes).context("Invalid JSON request")?;
        if !input.body.is_object() {
            bail!("Request body must be an object");
        }
        return Ok(input);
    }
    let mut fields = Multipart::from_request(request, &())
        .await
        .context("Invalid multipart request")?;
    let mut count = 0;
    while let Some(mut field) = fields.next_field().await? {
        count += 1;
        if count > 100 + rules.iter().map(|rule| rule.max_files).sum::<usize>() {
            bail!("Too many multipart fields");
        }
        let name = field
            .name()
            .context("Multipart field has no name")?
            .to_owned();
        if let Some(filename) = field.file_name().map(str::to_owned) {
            let rule = rules
                .iter()
                .find(|rule| rule.name == name)
                .context("Unexpected upload field")?;
            let existing = input.repeated.get(&name).map_or(0, Vec::len)
                + usize::from(input.files.contains_key(&name));
            if existing >= rule.max_files {
                bail!("Too many uploaded files for {name}");
            }
            // Treat Windows and POSIX separators alike, regardless of the host OS.
            let filename = filename.rsplit(['/', '\\']).next().unwrap_or("upload");
            let extension = Path::new(filename)
                .extension()
                .and_then(|extension| extension.to_str())
                .unwrap_or("")
                .to_ascii_lowercase();
            if !rule.extensions.is_empty() && !rule.extensions.contains(&extension.as_str()) {
                bail!("Unsupported file type: .{extension}");
            }
            let safe: String = Path::new(filename)
                .file_stem()
                .and_then(|stem| stem.to_str())
                .unwrap_or("upload")
                .chars()
                .map(|character| {
                    if character.is_ascii_alphanumeric() || ['.', '_', '-'].contains(&character) {
                        character
                    } else {
                        '_'
                    }
                })
                .take(160)
                .collect();
            let suffix = if extension.is_empty() {
                String::new()
            } else {
                format!(".{extension}")
            };
            let path = directory.join(format!("{}_{}{}", Uuid::new_v4(), safe, suffix));
            active_uploads().insert(path.clone());
            let uploaded = UploadedFile {
                path: path.clone(),
                original_name: filename.into(),
                bytes: 0,
            };
            if rule.max_files == 1 {
                input.files.insert(name.clone(), uploaded);
            } else {
                input
                    .repeated
                    .entry(name.clone())
                    .or_default()
                    .push(uploaded);
            }
            let mut options = tokio::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            options.mode(0o600);
            let mut file = options.open(path).await?;
            let mut size = 0;
            while let Some(chunk) = field.chunk().await? {
                size += chunk.len();
                if size > rule.max_bytes {
                    bail!(
                        "Uploaded file exceeds {} MB",
                        rule.max_bytes / (1024 * 1024)
                    );
                }
                file.write_all(&chunk).await?;
            }
            file.flush().await?;
            if rule.max_files == 1 {
                input.files.get_mut(&name).unwrap().bytes = size;
            } else {
                input
                    .repeated
                    .get_mut(&name)
                    .unwrap()
                    .last_mut()
                    .unwrap()
                    .bytes = size;
            }
        } else {
            if input.body.get(&name).is_some() {
                bail!("Duplicate multipart field: {name}");
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = field.chunk().await? {
                if bytes.len() + chunk.len() > 1024 * 1024 {
                    bail!("Multipart text field exceeds 1 MB");
                }
                bytes.extend_from_slice(&chunk);
            }
            input.body[&name] =
                json!(String::from_utf8(bytes).context("Multipart text must be UTF-8")?);
        }
    }
    Ok(input)
}
