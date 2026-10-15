//! Python discovery and Windows venv interpreter staging. Commands retain their
//! argument boundaries; platform preparation never mutates the host environment.
use crate::{
    engine_runtime::EngineRuntime,
    process::{CommandSpec, ManagedProcess},
};
use anyhow::{Context, Result};
use regex::Regex;
use serde::Serialize;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::OnceLock,
    time::Duration,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

#[derive(Clone, Debug, Serialize)]
pub struct Python {
    pub cmd: Vec<String>,
    pub version: String,
    pub source: String,
}
impl Python {
    pub fn command(
        &self,
        runtime: &EngineRuntime,
        args: impl IntoIterator<Item = impl Into<std::ffi::OsString>>,
    ) -> Result<CommandSpec> {
        let mut spec = runtime.python_command(args)?;
        spec.program = self.cmd.first().context("Missing Python command")?.into();
        spec.args
            .splice(0..0, self.cmd.iter().skip(1).map(std::ffi::OsString::from));
        Ok(spec)
    }
}
pub fn supported(version: &str) -> bool {
    let mut parts = version.split('.');
    parts.next() == Some("3") && matches!(parts.next(), Some("11" | "12"))
}
pub fn version(output: &str) -> Option<String> {
    static VERSION: OnceLock<Regex> = OnceLock::new();
    VERSION
        .get_or_init(|| Regex::new(r"Python\s+(\d+\.\d+\.\d+)").unwrap())
        .captures(output)
        .map(|m| m[1].into())
}
pub fn base_from_config(venv: &Path) -> Option<PathBuf> {
    let content = std::fs::read_to_string(venv.join("pyvenv.cfg")).ok()?;
    let mut home = None;
    let mut executable = None;
    for line in content.lines() {
        if let Some((key, value)) = line.split_once('=') {
            match key.trim() {
                "home" => home = Some(PathBuf::from(value.trim())),
                "executable" => executable = Some(PathBuf::from(value.trim())),
                _ => {}
            }
        }
    }
    if let Some(executable) = executable.filter(|p| p.is_file()) {
        return Some(executable);
    }
    let home = home?;
    ["python.exe", "Scripts/python.exe", "bin/python.exe"]
        .into_iter()
        .map(|name| home.join(name))
        .find(|path| path.is_file())
}
fn copy_stale(source: &Path, destination: &Path) -> Result<()> {
    let current = std::fs::metadata(destination).ok();
    let metadata = std::fs::metadata(source)?;
    let stale = current.is_none_or(|current| {
        current.len() != metadata.len()
            || current
                .modified()
                .ok()
                .zip(metadata.modified().ok())
                .is_some_and(|(to, from)| {
                    from.duration_since(to)
                        .is_ok_and(|age| age > Duration::from_secs(1))
                })
    });
    if !stale {
        return Ok(());
    }
    let temporary = destination.with_file_name(format!(".applio-python-{}.tmp", Uuid::new_v4()));
    let operation = (|| {
        std::fs::copy(source, &temporary)?;
        crate::storage::replace_file(&temporary, destination)?;
        Ok::<_, anyhow::Error>(())
    })();
    let _ = std::fs::remove_file(temporary);
    operation
}
/// Best effort: a running/locked shim keeps its existing path, with the real
/// interpreter staged alongside it when possible. DLLs accompany copied EXEs.
pub fn stage_windows_venv(venv: &Path) -> Option<PathBuf> {
    let scripts = venv.join("Scripts");
    let probe = scripts.join("python.exe");
    if !probe.is_file() {
        return None;
    }
    let real = scripts.join("python.real.exe");
    let Some(base) = base_from_config(venv) else {
        return Some(if real.is_file() { real } else { probe });
    };
    if std::fs::canonicalize(&base).ok() == std::fs::canonicalize(&probe).ok() {
        return Some(probe);
    }
    let parent = base.parent()?;
    let replaced = copy_stale(&base, &probe).is_ok();
    let _ = copy_stale(&base, &real);
    let windowed = parent.join("pythonw.exe");
    if windowed.is_file() && scripts.join("pythonw.exe").is_file() {
        let _ = copy_stale(&windowed, &scripts.join("pythonw.exe"));
    }
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_file()
                && path
                    .extension()
                    .is_some_and(|ext| ext.eq_ignore_ascii_case("dll"))
            {
                let _ = copy_stale(&path, &scripts.join(entry.file_name()));
            }
        }
    }
    Some(if replaced {
        probe
    } else if real.is_file() {
        real
    } else {
        probe
    })
}
pub fn candidates(runtime: &EngineRuntime) -> Vec<Python> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    let mut add = |cmd: Vec<String>, source: &str| {
        if cmd.is_empty() || Path::new(&cmd[0]).is_absolute() && !Path::new(&cmd[0]).is_file() {
            return;
        }
        if seen.insert(if cfg!(windows) {
            cmd.join("\0").to_lowercase()
        } else {
            cmd.join("\0")
        }) {
            candidates.push(Python {
                cmd,
                version: String::new(),
                source: source.into(),
            });
        }
    };
    if let Some(python) = runtime.env("PYTHON_BIN") {
        add(vec![python.to_string_lossy().into_owned()], "PYTHON_BIN");
    }
    add(
        vec![runtime.python_bin().to_string_lossy().into_owned()],
        "runtime",
    );
    for name in [".venv", "venv", "env"] {
        let root = runtime.data.join(name);
        let python = if cfg!(windows) {
            stage_windows_venv(&root).unwrap_or_else(|| root.join("Scripts/python.exe"))
        } else {
            root.join("bin/python")
        };
        add(
            vec![python.to_string_lossy().into_owned()],
            &format!("app {name}"),
        );
    }
    if cfg!(windows) {
        let local = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_default();
        let profile = std::env::var_os("USERPROFILE")
            .map(PathBuf::from)
            .unwrap_or_default();
        let drive = std::env::var_os("SystemDrive")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("C:\\"));
        let pf = std::env::var_os("ProgramFiles")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
        let pf86 = std::env::var_os("ProgramFiles(x86)")
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)"));
        for version in ["312", "311"] {
            for suffix in ["", "-64", "-32", "-arm64"] {
                add(
                    vec![local
                        .join(format!(
                            "Programs/Python/Python{version}{suffix}/python.exe"
                        ))
                        .to_string_lossy()
                        .into_owned()],
                    "standard path",
                );
            }
            for base in [&pf, &pf86, &drive] {
                add(
                    vec![base
                        .join(format!("Python{version}/python.exe"))
                        .to_string_lossy()
                        .into_owned()],
                    "standard path",
                );
            }
        }
        for path in [
            profile.join("scoop/apps/python/current/python.exe"),
            profile.join("scoop/shims/python.exe"),
            profile.join(".pyenv/pyenv-win/shims/python.exe"),
            drive.join("tools/python312/python.exe"),
            drive.join("tools/python311/python.exe"),
        ] {
            add(vec![path.to_string_lossy().into_owned()], "standard path");
        }
        for launcher in [
            local.join("Programs/Python/Launcher/py.exe"),
            PathBuf::from("py"),
        ] {
            for flag in ["-V:3.12", "-3.12", "-V:3.11", "-3.11"] {
                add(
                    vec![launcher.to_string_lossy().into_owned(), flag.into()],
                    "py launcher",
                );
            }
        }
    } else {
        for base in ["/opt/homebrew/bin", "/usr/local/bin", "/opt/local/bin"] {
            for python in ["python3.12", "python3.11"] {
                add(
                    vec![Path::new(base).join(python).to_string_lossy().into_owned()],
                    "standard path",
                );
            }
        }
    }
    for python in ["python3.12", "python3.11", "python3", "python"] {
        add(vec![python.into()], "PATH");
    }
    candidates
}
pub async fn find(runtime: &EngineRuntime, token: &CancellationToken) -> Option<Python> {
    if let Some(python) = find_from(runtime, candidates(runtime), token).await {
        return Some(python);
    }
    let registered = registered_paths()
        .into_iter()
        .map(|path| Python {
            cmd: vec![path.to_string_lossy().into_owned()],
            version: String::new(),
            source: "registry".into(),
        })
        .collect();
    find_from(runtime, registered, token).await
}
#[cfg(not(windows))]
fn registered_paths() -> Vec<PathBuf> {
    Vec::new()
}
#[cfg(windows)]
fn registered_paths() -> Vec<PathBuf> {
    use windows_sys::Win32::System::Registry::*;
    struct Key(HKEY);
    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                RegCloseKey(self.0);
            }
        }
    }
    fn value(key: HKEY, name: &str) -> Option<String> {
        let name = name.encode_utf16().chain([0]).collect::<Vec<_>>();
        let mut bytes = 0;
        let mut kind = 0;
        // Registry handles and UTF-16 buffers remain owned for each FFI call.
        if unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                std::ptr::null_mut(),
                &mut bytes,
            )
        } != 0
            || !matches!(kind, REG_SZ | REG_EXPAND_SZ)
            || bytes > 128 * 1024
        {
            return None;
        }
        let mut buffer = vec![0u16; bytes as usize / 2 + 1];
        if unsafe {
            RegQueryValueExW(
                key,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                buffer.as_mut_ptr().cast(),
                &mut bytes,
            )
        } != 0
        {
            return None;
        }
        let end = buffer.iter().position(|v| *v == 0).unwrap_or(buffer.len());
        String::from_utf16(&buffer[..end]).ok()
    }
    let mut paths = Vec::new();
    for hive in [HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE] {
        for prefix in [
            r"Software\Python\PythonCore",
            r"Software\WOW6432Node\Python\PythonCore",
        ] {
            for version in [
                "3.12",
                "3.12-64",
                "3.12-arm64",
                "3.11",
                "3.11-64",
                "3.11-arm64",
            ] {
                let name = format!(r"{prefix}\{version}\InstallPath")
                    .encode_utf16()
                    .chain([0])
                    .collect::<Vec<_>>();
                let mut handle = std::ptr::null_mut();
                if unsafe { RegOpenKeyExW(hive, name.as_ptr(), 0, KEY_READ, &mut handle) } != 0 {
                    continue;
                }
                let key = Key(handle);
                for name in ["", "ExecutablePath"] {
                    if let Some(value) = value(key.0, name) {
                        let path = PathBuf::from(value);
                        let path = if path.is_dir() {
                            path.join("python.exe")
                        } else {
                            path
                        };
                        if path.is_file() && !paths.contains(&path) {
                            paths.push(path);
                        }
                    }
                }
            }
        }
    }
    paths
}
pub async fn find_from(
    runtime: &EngineRuntime,
    candidates: Vec<Python>,
    token: &CancellationToken,
) -> Option<Python> {
    for mut candidate in candidates {
        if token.is_cancelled() {
            return None;
        }
        let Ok(spec) = candidate.command(runtime, ["--version"]) else {
            continue;
        };
        let Ok(Ok(output)) = tokio::time::timeout(
            Duration::from_secs(15),
            ManagedProcess::run(&spec, token, |_, _| {}),
        )
        .await
        else {
            continue;
        };
        if !output.success {
            continue;
        }
        if let Some(version) =
            version(&format!("{}{}", output.stdout, output.stderr)).filter(|v| supported(v))
        {
            candidate.version = version;
            return Some(candidate);
        }
    }
    None
}

#[cfg(test)]
mod checks {
    use super::*;
    #[test]
    fn config_resolution_and_staging_keep_real_interpreters_with_their_dlls() {
        let directory = tempfile::tempdir().unwrap();
        let base = directory.path().join("base Python");
        let venv = directory.path().join(".venv");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(venv.join("Scripts")).unwrap();
        for (name, data) in [
            ("python.exe", b"actual interpreter".as_slice()),
            ("pythonw.exe", b"windowed"),
            ("python312.dll", b"runtime dll"),
        ] {
            std::fs::write(base.join(name), data).unwrap();
        }
        std::fs::write(
            venv.join("pyvenv.cfg"),
            format!("home = {}\n", base.display()),
        )
        .unwrap();
        std::fs::write(venv.join("Scripts/python.exe"), b"shim").unwrap();
        std::fs::write(venv.join("Scripts/pythonw.exe"), b"shim").unwrap();
        assert_eq!(base_from_config(&venv), Some(base.join("python.exe")));
        assert_eq!(
            stage_windows_venv(&venv),
            Some(venv.join("Scripts/python.exe"))
        );
        assert_eq!(
            std::fs::read(venv.join("Scripts/python.exe")).unwrap(),
            b"actual interpreter"
        );
        assert_eq!(
            std::fs::read(venv.join("Scripts/python312.dll")).unwrap(),
            b"runtime dll"
        );
        assert_eq!(
            std::fs::read(venv.join("Scripts/pythonw.exe")).unwrap(),
            b"windowed"
        );
        assert_eq!(version("Python 3.12.9\r\n"), Some("3.12.9".into()));
        assert!(supported("3.11.9"));
        assert!(!supported("3.14.0"));
    }
}
