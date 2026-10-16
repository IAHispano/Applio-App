//! Installed data preparation. Imports copy user content and never relocate a
//! Python environment or overwrite content already present in the new install.
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    ffi::OsString,
    io::Write,
    path::{Path, PathBuf},
};

pub type Environment = BTreeMap<OsString, OsString>;

pub(crate) fn publish(path: &Path, bytes: &[u8], replace: bool) -> Result<()> {
    std::fs::create_dir_all(path.parent().context("Missing file parent")?)?;
    let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())?;
    file.write_all(bytes)?;
    file.as_file().sync_all()?;
    if replace {
        crate::storage::replace_file(file.path(), path)?;
    } else if let Err(error) = file.persist_noclobber(path) {
        if error.error.kind() != std::io::ErrorKind::AlreadyExists {
            return Err(error.error.into());
        }
    }
    Ok(())
}

fn rebase(value: &str, old: &Path, new: &Path) -> String {
    if !Path::new(value).is_absolute() {
        return value.into();
    }
    let normalized = value.replace('\\', "/");
    let prefix = old
        .to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string();
    let matches = if cfg!(windows) {
        normalized
            .to_lowercase()
            .starts_with(&prefix.to_lowercase())
    } else {
        normalized.starts_with(&prefix)
    };
    if matches
        && (normalized.len() == prefix.len()
            || normalized.as_bytes().get(prefix.len()) == Some(&b'/'))
    {
        let relative = normalized[prefix.len()..].trim_start_matches('/');
        if Path::new(relative)
            .components()
            .any(|c| c == std::path::Component::ParentDir)
        {
            return value.into();
        }
        return new.join(relative).to_string_lossy().into_owned();
    }
    value.into()
}
fn relocate(value: &mut Value, old: &Path, new: &Path) {
    match value {
        Value::String(s) => *s = rebase(s, old, new),
        Value::Array(items) => {
            for item in items {
                relocate(item, old, new);
            }
        }
        Value::Object(items) => {
            for item in items.values_mut() {
                relocate(item, old, new);
            }
        }
        _ => {}
    }
}
fn copy_tree(
    source: &Path,
    destination: &Path,
    replace: bool,
    relocation: Option<(&Path, &Path)>,
) -> Result<()> {
    let metadata = std::fs::symlink_metadata(source)?;
    // Do not follow external model junctions or symlinks during an import.
    // Their absolute paths in configuration remain intact.
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            bail!(
                "Linked content must be imported explicitly: {}",
                source.display()
            );
        }
    }
    if metadata.file_type().is_symlink() {
        bail!(
            "Linked content must be imported explicitly: {}",
            source.display()
        );
    }
    if metadata.is_dir() {
        std::fs::create_dir_all(destination)?;
        for item in std::fs::read_dir(source)? {
            let item = item?;
            copy_tree(
                &item.path(),
                &destination.join(item.file_name()),
                replace,
                relocation,
            )?;
        }
    } else if replace || !destination.exists() {
        let name = source.file_name().and_then(|v| v.to_str()).unwrap_or("");
        let rewrite = relocation.is_some()
            && ["config.json", "jobs.json", "filelist.txt"].contains(&name)
            && metadata.len() <= 32 * 1024 * 1024;
        if !rewrite {
            std::fs::create_dir_all(destination.parent().context("Missing import destination")?)?;
            let mut staged = tempfile::NamedTempFile::new_in(destination.parent().unwrap())?;
            std::io::copy(&mut std::fs::File::open(source)?, &mut staged)?;
            staged.as_file().sync_all()?;
            if replace {
                crate::storage::replace_file(staged.path(), destination)?;
            } else if let Err(error) = staged.persist_noclobber(destination) {
                if error.error.kind() != std::io::ErrorKind::AlreadyExists {
                    return Err(error.error.into());
                }
            }
            return Ok(());
        }
        let mut bytes = std::fs::read(source)?;
        if let Some((old, new)) = relocation {
            let name = source.file_name().and_then(|v| v.to_str()).unwrap_or("");
            if name == "config.json" || name == "jobs.json" {
                if let Ok(mut json) = serde_json::from_slice::<Value>(&bytes) {
                    relocate(&mut json, old, new);
                    bytes = serde_json::to_vec_pretty(&json)?;
                } else if name == "config.json"
                    && source.parent() == Some(old.parent().unwrap_or(old))
                {
                    bail!("Invalid existing settings: {}", source.display());
                }
            } else if name == "filelist.txt" {
                if let Ok(content) = std::str::from_utf8(&bytes) {
                    bytes = content
                        .split_inclusive('\n')
                        .map(|line| {
                            line.split('|')
                                .enumerate()
                                .map(|(index, field)| {
                                    if index < 4 {
                                        rebase(field, old, new)
                                    } else {
                                        field.into()
                                    }
                                })
                                .collect::<Vec<_>>()
                                .join("|")
                        })
                        .collect::<String>()
                        .into_bytes();
                }
            }
        }
        publish(destination, &bytes, replace)?;
    }
    Ok(())
}

pub fn import_legacy(legacy: &Path, config: &Path, data: &Path) -> Result<()> {
    // Retry imports made before plugin directories were included. Existing
    // destination files still win, so current settings and content are retained.
    let marker = config.join(".legacy-imported-v2");
    if legacy == config || marker.exists() {
        return Ok(());
    }
    let old = if legacy.join("runtime").is_dir() {
        legacy.join("runtime")
    } else {
        legacy.join("data")
    };
    // Validate settings before copying any files. Invalid settings are never reset.
    if legacy.join("config.json").is_file() {
        let value: Value = serde_json::from_slice(&std::fs::read(legacy.join("config.json"))?)?;
        if !value.is_object() {
            bail!("Existing settings must be an object");
        }
        if let Some(folder) = value["logs_dir"].as_str().filter(|s| !s.is_empty()) {
            let source = if Path::new(folder).is_absolute() {
                PathBuf::from(folder)
            } else {
                old.join(folder)
            };
            let relocated = rebase(&source.to_string_lossy(), &old, data);
            if relocated != source.to_string_lossy() && source.is_dir() {
                copy_tree(&source, Path::new(&relocated), false, Some((&old, data)))?;
            }
        }
    }
    for entry in [
        "logs",
        "assets",
        "rvc/models",
        "plugins/installed",
        "tabs/plugins/installed",
    ] {
        let source = old.join(entry);
        if source.exists() {
            copy_tree(&source, &data.join(entry), false, Some((&old, data)))?;
        }
    }
    if legacy.join("logs").is_dir() {
        copy_tree(&legacy.join("logs"), &config.join("app-logs"), false, None)?;
    }
    for name in ["config.json", "jobs.json", "window-state.json"] {
        if legacy.join(name).is_file() {
            copy_tree(
                &legacy.join(name),
                &config.join(name),
                false,
                Some((&old, data)),
            )?;
        }
    }
    publish(&marker, legacy.to_string_lossy().as_bytes(), false)
}

pub fn prepare(
    code: &Path,
    data: &Path,
    config: &Path,
    packaged: bool,
    local: bool,
    legacy: &[PathBuf],
) -> Result<Environment> {
    std::fs::create_dir_all(data)?;
    for name in ["cache", "temp", "session", "crash-dumps", "app-logs"] {
        std::fs::create_dir_all(config.join(name))?;
    }
    // A real create/write verifies Windows directory ACLs too.
    let mut probe = tempfile::NamedTempFile::new_in(config)?;
    probe.write_all(b"Applio storage check")?;
    drop(probe);
    if local {
        if let Some(old) = legacy.iter().find(|p| {
            *p != config
                && ["config.json", "runtime", "data"]
                    .iter()
                    .any(|e| p.join(e).exists())
        }) {
            import_legacy(old, config, data)?;
        }
    }
    if packaged && code != data {
        let marker = data.join(".seed-version");
        let changed = std::fs::read_to_string(&marker).unwrap_or_default().trim()
            != env!("CARGO_PKG_VERSION");
        for name in [
            "requirements.txt",
            "requirements-uvr.txt",
            "LICENSE",
            "core.py",
            "uvr",
            "tools",
        ] {
            if code.join(name).exists() && (changed || name.starts_with("requirements")) {
                copy_tree(&code.join(name), &data.join(name), true, None)?;
            }
        }
        for name in [
            "assets",
            "plugins",
            "logs/mute",
            "logs/mute_spin",
            "logs/mute_spin-v2",
            "logs/reference",
        ] {
            if code.join(name).exists() {
                copy_tree(&code.join(name), &data.join(name), false, None)?;
            }
        }
        if code.join("assets/themes").is_dir() {
            copy_tree(
                &code.join("assets/themes"),
                &data.join("assets/themes"),
                true,
                None,
            )?;
        }
        std::fs::create_dir_all(data.join("rvc/models"))?;
        publish(&marker, env!("CARGO_PKG_VERSION").as_bytes(), true)?;
    }
    let mut env = Environment::new();
    let dotenv = data.join(".env");
    if dotenv.is_file() {
        for item in dotenvy::from_path_iter(dotenv)? {
            let (key, value) = item?;
            if std::env::var_os(&key).is_none() {
                env.insert(key.into(), value.into());
            }
        }
    }
    if local {
        for (key, relative) in [
            ("TEMP", "temp"),
            ("TMP", "temp"),
            ("XDG_CACHE_HOME", "cache"),
            ("HF_HOME", "cache/huggingface"),
            ("TORCH_HOME", "cache/torch"),
            ("UV_CACHE_DIR", "cache/uv"),
            ("UV_PYTHON_INSTALL_DIR", "python"),
            ("UV_INSTALL_DIR", "tools"),
            ("UV_UNMANAGED_INSTALL", "tools"),
            ("UV_PYTHON_BIN_DIR", "tools"),
            ("UV_TOOL_BIN_DIR", "tools"),
            ("UV_TOOL_DIR", "uv-tools"),
            ("PIP_CACHE_DIR", "cache/pip"),
            ("NUMBA_CACHE_DIR", "cache/numba"),
            ("MPLCONFIGDIR", "cache/matplotlib"),
            ("LIBROSA_CACHE_DIR", "cache/librosa"),
            ("TORCHINDUCTOR_CACHE_DIR", "cache/torchinductor"),
            ("TRITON_CACHE_DIR", "cache/triton"),
        ] {
            env.insert(key.into(), config.join(relative).into_os_string());
        }
        for (key, value) in [
            ("APPLIO_LOCAL_STORAGE", "1"),
            ("UV_NO_MODIFY_PATH", "1"),
            ("UV_PYTHON_PREFERENCE", "only-managed"),
        ] {
            env.insert(key.into(), value.into());
        }
        let mut path = vec![config.join("tools")];
        path.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        env.insert("PATH".into(), std::env::join_paths(path)?);
    }
    Ok(env)
}
