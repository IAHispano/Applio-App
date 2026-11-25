//! Installed data preparation. Imports copy user content and never relocate a
//! Python environment or overwrite content already present in the new install.
use anyhow::{bail, Context, Result};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    ffi::OsString,
    fs::{self, Metadata},
    io::{self, Write},
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

fn linked(metadata: &Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return true;
        }
    }
    metadata.file_type().is_symlink()
}

fn same_file_contents(source: &Path, destination: &Path, size: u64) -> io::Result<bool> {
    let metadata = fs::symlink_metadata(destination)?;
    if !metadata.is_file() || linked(&metadata) || metadata.len() != size {
        return Ok(false);
    }
    crate::storage::file_contents_equal(source, destination, 8192)
}

fn copy_tree(
    source: &Path,
    destination: &Path,
    replace: bool,
    relocation: Option<(&Path, &Path)>,
) -> Result<()> {
    let metadata = std::fs::symlink_metadata(source)?;
    // Do not follow model junctions, symlinks, or other links during an import.
    // Linked content stays where it is (its absolute paths in configuration
    // remain intact) and must never block startup: skip it instead of failing.
    if linked(&metadata) {
        eprintln!(
            "Skipping linked legacy content during import: {}",
            source.display()
        );
        return Ok(());
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
            // Packaged themes and requirements are refreshed on every launch.
            // Keep byte-identical regular copies to avoid another sync and rename.
            if replace && same_file_contents(source, destination, metadata.len()).unwrap_or(false) {
                return Ok(());
            }
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
        let version = env!("CARGO_PKG_VERSION");
        let seeded = std::fs::read_to_string(&marker).unwrap_or_default();
        let changed = seeded.trim() != version;
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
        if seeded != version
            || !fs::symlink_metadata(&marker).is_ok_and(|m| m.is_file() && !linked(&m))
        {
            publish(&marker, version.as_bytes(), true)?;
        }
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, UNIX_EPOCH};

    #[test]
    fn packaged_startup_preserves_identical_files_and_repairs_refreshed_resources() {
        let root = tempfile::tempdir().unwrap();
        let code = root.path().join("code");
        let data = root.path().join("data");
        let config = root.path().join("config");
        fs::create_dir_all(code.join("assets/themes")).unwrap();
        fs::write(code.join("requirements.txt"), "packages").unwrap();
        fs::write(code.join("core.py"), "current engine entry").unwrap();
        fs::write(code.join("assets/themes/builtin.json"), "ruby").unwrap();
        fs::write(code.join("assets/preset.json"), "factory").unwrap();
        fs::create_dir_all(data.join("assets/themes")).unwrap();
        fs::write(data.join("assets/preset.json"), "user preset").unwrap();
        fs::write(data.join("assets/themes/user.json"), "user theme").unwrap();
        let start = || prepare(&code, &data, &config, true, false, &[]).unwrap();
        start();

        let theme = data.join("assets/themes/builtin.json");
        let requirements = data.join("requirements.txt");
        let marker = data.join(".seed-version");
        let timestamps: Vec<_> = [&theme, &requirements, &marker]
            .into_iter()
            .map(|path| {
                fs::OpenOptions::new()
                    .write(true)
                    .open(path)
                    .unwrap()
                    .set_modified(UNIX_EPOCH + Duration::from_secs(1_000_000_000))
                    .unwrap();
                fs::metadata(path).unwrap().modified().unwrap()
            })
            .collect();
        start();
        for (path, timestamp) in [&theme, &requirements, &marker].into_iter().zip(timestamps) {
            assert_eq!(fs::metadata(path).unwrap().modified().unwrap(), timestamp);
        }

        fs::write(&theme, "jade").unwrap();
        fs::remove_file(&requirements).unwrap();
        fs::write(&marker, "previous version").unwrap();
        fs::write(data.join("core.py"), "old engine entry").unwrap();
        start();
        assert_eq!(fs::read_to_string(theme).unwrap(), "ruby");
        assert_eq!(fs::read_to_string(requirements).unwrap(), "packages");
        assert_eq!(
            fs::read_to_string(marker).unwrap(),
            env!("CARGO_PKG_VERSION")
        );
        assert_eq!(
            fs::read_to_string(data.join("core.py")).unwrap(),
            "current engine entry"
        );
        assert_eq!(
            fs::read_to_string(data.join("assets/preset.json")).unwrap(),
            "user preset"
        );
        assert_eq!(
            fs::read_to_string(data.join("assets/themes/user.json")).unwrap(),
            "user theme"
        );
    }

    #[cfg(unix)]
    #[test]
    fn packaged_refresh_replaces_an_identical_destination_symlink() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source.json");
        let destination = root.path().join("destination.json");
        fs::write(&source, "{}\n").unwrap();
        std::os::unix::fs::symlink(&source, &destination).unwrap();
        copy_tree(&source, &destination, true, None).unwrap();
        assert!(fs::symlink_metadata(&destination).unwrap().is_file());
        assert_eq!(fs::read(destination).unwrap(), b"{}\n");
    }
}
