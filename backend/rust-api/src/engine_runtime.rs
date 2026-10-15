//! Native runtime paths, settings snapshots and Python command construction.
//! Writable user content is separate from the read-only installed engine code.
use crate::{process::CommandSpec, ApiConfig};
use anyhow::{bail, Context, Result};
use serde_json::{json, Value};
use std::{
    ffi::{OsStr, OsString},
    path::{Component, Path, PathBuf},
    sync::{Arc, Mutex},
};
use uuid::Uuid;

#[derive(Clone)]
pub struct ConfigStore(Arc<ConfigInner>);
struct ConfigInner {
    code: PathBuf,
    data: PathBuf,
    path: PathBuf,
    gate: Mutex<()>,
}
impl ConfigStore {
    pub fn open(config: &ApiConfig) -> Result<Self> {
        std::fs::create_dir_all(&config.config_dir)?;
        let store = Self(Arc::new(ConfigInner {
            code: config.code_root.clone(),
            data: config.data_root.clone(),
            path: config.config_dir.join("config.json"),
            gate: Mutex::new(()),
        }));
        if !store.0.path.exists() {
            let old = store.0.data.join("assets/config.json");
            let initial = if old.is_file() {
                read_object(&old)?
            } else {
                json!({"lang": {"override": false, "selected_lang": store.system_language()}})
            };
            store.write(&initial, true)?;
        }
        store.load()?;
        Ok(store)
    }
    pub fn load(&self) -> Result<Value> {
        let mut defaults = read_object(&self.0.code.join("assets/config_template.json"))?;
        let mut user = read_object(&self.0.path)?;
        user.as_object_mut().unwrap().remove("version");
        merge(&mut defaults, user);
        if defaults["lang"]["override"] != true {
            if !defaults["lang"].is_object() {
                defaults["lang"] = json!({});
            }
            defaults["lang"]["selected_lang"] = json!(self.system_language());
        }
        Ok(defaults)
    }
    pub fn update(&self, patch: Value) -> Result<Value> {
        if !patch.is_object() {
            bail!("Settings must be an object");
        }
        self.modify(|value| {
            merge(value, patch);
            Ok(())
        })
    }
    pub fn modify(&self, change: impl FnOnce(&mut Value) -> Result<()>) -> Result<Value> {
        let _gate = self.0.gate.lock().unwrap();
        let mut value = self.load()?;
        change(&mut value)?;
        self.write(&value, false)?;
        Ok(value)
    }
    fn write(&self, value: &Value, create_only: bool) -> Result<()> {
        let mut value = value.clone();
        value
            .as_object_mut()
            .context("Settings must be an object")?
            .remove("version");
        if create_only {
            let mut bytes = serde_json::to_vec_pretty(&value)?;
            bytes.push(b'\n');
            return crate::app_runtime::publish(&self.0.path, &bytes, false);
        }
        let parent = self
            .0
            .path
            .parent()
            .context("Settings have no parent directory")?;
        let temporary = parent.join(format!(".config-{}.tmp", Uuid::new_v4()));
        let result = (|| -> Result<()> {
            use std::io::Write;
            let mut options = std::fs::OpenOptions::new();
            options.write(true).create_new(true);
            #[cfg(unix)]
            {
                use std::os::unix::fs::OpenOptionsExt;
                options.mode(0o600);
            }
            let mut file = options
                .open(&temporary)
                .context("Create settings staging file")?;
            file.write_all(&serde_json::to_vec_pretty(&value)?)
                .context("Write settings staging file")?;
            file.write_all(b"\n")
                .context("Finish settings staging file")?;
            file.sync_all().context("Sync settings staging file")?;
            drop(file);
            crate::storage::replace_file(&temporary, &self.0.path)
                .context("Replace settings file")?;
            Ok(())
        })();
        let _ = std::fs::remove_file(temporary);
        result.map_err(|error| {
            anyhow::anyhow!(
                "Could not save settings at {}: {error:#}",
                self.0.path.display()
            )
        })
    }
    fn system_language(&self) -> String {
        crate::locale::resolve(
            [crate::locale::system().as_str()],
            &crate::locale::available(&self.0.code, &self.0.data),
        )
    }
}

pub fn read_object(path: &Path) -> Result<Value> {
    let value: Value = serde_json::from_slice(
        &std::fs::read(path).with_context(|| format!("Could not read {}", path.display()))?,
    )?;
    if !value.is_object() {
        bail!("Expected a settings object in {}", path.display());
    }
    Ok(value)
}
pub fn merge(base: &mut Value, patch: Value) {
    if let (Some(base), Some(patch)) = (base.as_object_mut(), patch.as_object()) {
        for (key, value) in patch {
            if ["__proto__", "constructor", "prototype"].contains(&key.as_str()) {
                continue;
            }
            merge(
                base.entry(key.clone()).or_insert(Value::Null),
                value.clone(),
            );
        }
    } else {
        *base = patch;
    }
}

#[derive(Clone)]
pub struct EngineRuntime {
    pub code: PathBuf,
    pub data: PathBuf,
    pub config_dir: PathBuf,
    pub backend: PathBuf,
    pub logs: PathBuf,
    pub logs_move_error: Option<String>,
    pub outputs: PathBuf,
    pub uploads: PathBuf,
    pub config: ConfigStore,
    pub environment: std::collections::BTreeMap<OsString, OsString>,
    python: PathBuf,
    pub(crate) package_probe: Arc<crate::engine::PackageProbe>,
}
impl EngineRuntime {
    pub fn open(config: &ApiConfig) -> Result<Self> {
        Self::with_environment(config, None, Default::default())
    }
    pub fn with_python(config: &ApiConfig, python: Option<PathBuf>) -> Result<Self> {
        Self::with_environment(config, python, Default::default())
    }
    pub fn with_environment(
        config: &ApiConfig,
        python: Option<PathBuf>,
        environment: crate::app_runtime::Environment,
    ) -> Result<Self> {
        let env = |key: &str| {
            environment
                .get(OsStr::new(key))
                .cloned()
                .or_else(|| std::env::var_os(key))
        };
        let code = absolute(&config.code_root)?;
        let data = absolute(&config.data_root)?;
        let config_dir = absolute(&config.config_dir)?;
        std::fs::create_dir_all(&data)?;
        let configuration = ConfigStore::open(config)?;
        let (logs, logs_move_error) =
            crate::storage::initialize(&configuration, &data, &config_dir)?;
        let outputs = env("OUTPUTS_DIR")
            .map(|path| data.join(path))
            .unwrap_or_else(|| data.join("assets/audios"));
        let uploads = env("UPLOADS_DIR")
            .map(|path| data.join(path))
            .unwrap_or_else(|| data.join("assets/audios/_uploads"));
        for directory in [&logs, &outputs, &uploads] {
            std::fs::create_dir_all(directory)?;
        }
        let backend = env("APPLIO_BACKEND_ROOT")
            .map(PathBuf::from)
            .unwrap_or_else(|| code.join("backend/applio"));
        if !backend.join("rvc/configs/config.py").is_file() {
            bail!("Applio backend missing. Run: git submodule update --init --recursive");
        }
        let python = python
            .or_else(|| env("PYTHON_BIN").map(PathBuf::from))
            .unwrap_or_else(|| detect_python(&data));
        Ok(Self {
            code,
            data,
            config_dir,
            backend,
            logs,
            logs_move_error,
            outputs,
            uploads,
            config: configuration,
            environment,
            python,
            package_probe: Arc::default(),
        })
    }

    pub fn python_bin(&self) -> &Path {
        &self.python
    }
    pub fn env(&self, key: &str) -> Option<OsString> {
        self.environment
            .get(OsStr::new(key))
            .cloned()
            .or_else(|| std::env::var_os(key))
    }
    pub fn python_command(
        &self,
        args: impl IntoIterator<Item = impl Into<OsString>>,
    ) -> Result<CommandSpec> {
        let mut args: Vec<OsString> = args.into_iter().map(Into::into).collect();
        if let Some(script) = args.first().and_then(|arg| arg.to_str()) {
            let script = script.replace('\\', "/");
            if script == "rvc/infer/infer.py" {
                args[0] = self
                    .code
                    .join("tools/inference_runtime.py")
                    .into_os_string();
                args.insert(1, "infer".into());
            } else if script.starts_with("rvc/") && script.ends_with(".py") {
                args[0] = self.backend.join(script).into_os_string();
            } else if (script.starts_with("tools/") || script.starts_with("uvr/"))
                && script.ends_with(".py")
            {
                args[0] = self.code.join(script).into_os_string();
            }
        }
        let mut spec = CommandSpec::new(&self.python, &self.data).args(args);
        // The AppImage type-2 runtime always exports PYTHONHOME=$APPDIR/usr
        // (plus an AppDir PYTHONPATH), even though the bundle ships no
        // Python. Any inherited PYTHONHOME hijacks sys.prefix of the spawned
        // .venv interpreter and it dies before running anything with
        // "No module named 'encodings'". Remove it outright: an empty value
        // is not reliably ignored, and -E/-I would also drop the PYTHONPATH
        // and unbuffered-IO settings this spec sets on purpose.
        spec.env_remove.push("PYTHONHOME".into());
        for (key, value) in [
            ("APPLIO_ROOT", self.data.as_os_str()),
            ("APPLIO_CODE_ROOT", self.code.as_os_str()),
            ("APPLIO_CONFIG_DIR", self.config_dir.as_os_str()),
            ("APPLIO_BACKEND_ROOT", self.backend.as_os_str()),
            ("APPLIO_LOGS_DIR", self.logs.as_os_str()),
            ("PYTHONUNBUFFERED", OsStr::new("1")),
            ("PYTHONIOENCODING", OsStr::new("utf-8")),
        ] {
            spec.env.insert(key.into(), value.to_owned());
        }
        let mut python_path = vec![self.backend.clone(), self.code.clone()];
        if let Some(existing) = std::env::var_os("PYTHONPATH") {
            python_path.extend(std::env::split_paths(&existing));
        }
        spec.env
            .insert("PYTHONPATH".into(), std::env::join_paths(python_path)?);
        let mut path = Vec::new();
        if let Some(bin) = self
            .python
            .parent()
            .filter(|bin| !bin.as_os_str().is_empty())
        {
            path.push(bin.to_path_buf());
        }
        if cfg!(windows) {
            path.push(self.data.join(".venv/Lib/site-packages/torch/lib"));
            if let Some(venv) = self
                .python
                .parent()
                .and_then(|p| p.parent())
                .filter(|p| p.join("pyvenv.cfg").is_file())
            {
                if let Some(base) = crate::python_runtime::base_from_config(venv)
                    .and_then(|p| p.parent().map(Path::to_path_buf))
                {
                    path.extend([base.clone(), base.join("Scripts")]);
                }
            }
        } else if cfg!(target_os = "macos") {
            for directory in [
                "/opt/homebrew/bin",
                "/opt/homebrew/sbin",
                "/usr/local/bin",
                "/usr/local/sbin",
                "/opt/local/bin",
                "/opt/local/sbin",
            ] {
                if Path::new(directory).is_dir() {
                    path.push(directory.into());
                }
            }
        }
        path.extend([self.data.clone(), self.code.clone()]);
        if let Some(existing) = self.env("PATH") {
            path.extend(std::env::split_paths(&existing));
        }
        spec.env.insert("PATH".into(), std::env::join_paths(path)?);
        if cfg!(target_os = "macos") {
            for (name, default) in [
                ("PYTORCH_ENABLE_MPS_FALLBACK", "1"),
                ("OMP_NUM_THREADS", "1"),
            ] {
                spec.env.insert(
                    name.into(),
                    std::env::var_os(name).unwrap_or_else(|| default.into()),
                );
            }
        }
        spec.env.extend(
            self.environment
                .iter()
                .filter(|(key, _)| *key != "PATH")
                .map(|(key, value)| (key.clone(), value.clone())),
        );
        crate::gpu_runtime::apply_to_command(self, &mut spec)?;
        Ok(spec)
    }
    pub fn worker_command(&self) -> Result<CommandSpec> {
        self.python_command([
            self.code
                .join("tools/inference_runtime.py")
                .into_os_string(),
            "worker".into(),
        ])
    }

    pub fn resolve_user_path(&self, value: &str) -> Result<PathBuf> {
        let value = value.trim();
        let value = value.strip_prefix(['\'', '"']).unwrap_or(value);
        let value = value.strip_suffix(['\'', '"']).unwrap_or(value);
        if value.is_empty() {
            bail!("Path is required");
        }
        let path = PathBuf::from(value);
        if path.is_absolute() {
            if !path.exists() {
                bail!("File not found: {}", path.display());
            }
            return Ok(path);
        }
        let value = value.replace('\\', "/");
        let (root, relative) = if value == "logs" {
            (&self.logs, "")
        } else if let Some(relative) = value.strip_prefix("logs/") {
            (&self.logs, relative)
        } else {
            (&self.data, value.as_str())
        };
        Ok(root.join(confined_relative(relative)?))
    }
    pub fn require_file(&self, value: &str) -> Result<PathBuf> {
        let path = self.resolve_user_path(value)?;
        if !path.is_file() {
            bail!("File not found: {}", path.display());
        }
        Ok(path)
    }
    pub fn repo_relative(&self, target: &Path) -> String {
        let target = if target.is_absolute() {
            target.to_path_buf()
        } else {
            self.data.join(target)
        };
        let base: Vec<_> = self.data.components().collect();
        let to: Vec<_> = target.components().collect();
        let shared = base
            .iter()
            .zip(&to)
            .take_while(|(left, right)| left == right)
            .count();
        if shared == 0 {
            return target.to_string_lossy().replace('\\', "/");
        }
        let mut relative = PathBuf::new();
        for _ in shared..base.len() {
            relative.push("..");
        }
        for component in &to[shared..] {
            relative.push(component.as_os_str());
        }
        relative.to_string_lossy().replace('\\', "/")
    }

    /// Model paths retain the public logs/ alias when models live on another
    /// drive, keeping library selections and presets portable across restarts.
    pub fn model_relative(&self, target: &Path) -> String {
        match target.strip_prefix(&self.logs) {
            Ok(relative) => Path::new("logs")
                .join(relative)
                .to_string_lossy()
                .replace('\\', "/"),
            Err(_) => self.repo_relative(target),
        }
    }
}

fn absolute(path: &Path) -> Result<PathBuf> {
    Ok(if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir()?.join(path)
    })
}
fn confined_relative(path: &str) -> Result<PathBuf> {
    let mut output = PathBuf::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(part) => output.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !output.pop() {
                    bail!("Path escapes the selected storage folder");
                }
            }
            _ => bail!("Path must stay inside the selected storage folder"),
        }
    }
    Ok(output)
}
fn detect_python(data: &Path) -> PathBuf {
    for folder in [".venv", "venv", "env"] {
        let candidate = data.join(folder).join(if cfg!(windows) {
            "Scripts/python.exe"
        } else {
            "bin/python"
        });
        if candidate.is_file() {
            if cfg!(windows) {
                return crate::python_runtime::stage_windows_venv(&data.join(folder))
                    .unwrap_or(candidate);
            }
            return candidate;
        }
    }
    PathBuf::from(if cfg!(windows) { "python" } else { "python3" })
}
