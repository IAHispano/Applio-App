//! Native GPU selection and child-process ROCm environment construction.
use anyhow::Result;
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    ffi::OsString,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hardware {
    pub names: Vec<String>,
    pub pnp_ids: Vec<String>,
}
impl Hardware {
    pub fn nvidia(&self) -> bool {
        self.names
            .iter()
            .any(|name| name.to_ascii_lowercase().contains("nvidia"))
            || self
                .pnp_ids
                .iter()
                .any(|id| id.to_ascii_uppercase().contains("VEN_10DE"))
    }
    pub fn use_rocm(&self, explicit: Option<&str>) -> bool {
        explicit.is_some_and(|value| !value.trim().is_empty()) || self.amd() && !self.nvidia()
    }
    pub fn amd(&self) -> bool {
        self.names.iter().any(|name| {
            let name = name.to_ascii_lowercase();
            name.contains("amd") || name.contains("radeon")
        })
    }
}
pub fn amd_target(hardware: &Hardware, explicit: Option<&str>, hsa: Option<&str>) -> String {
    if let Some(value) = explicit.filter(|v| !v.is_empty()) {
        return normalize_target(value, false);
    }
    if let Some(value) = hsa.filter(|v| !v.is_empty()) {
        return normalize_target(value, true);
    }
    let names = hardware.names.join(" ").to_lowercase();
    static DIRECT: OnceLock<Regex> = OnceLock::new();
    if let Some(found) = DIRECT
        .get_or_init(|| Regex::new(r"\b(?:device-)?(gfx\d{3,4}[a-z]?)\b").unwrap())
        .captures(&names)
    {
        return found[1].into();
    }
    static RULES: OnceLock<Vec<(Regex, String)>> = OnceLock::new();
    let rules = RULES.get_or_init(|| {
        let data: Value = serde_json::from_str(include_str!("gpu-devices.json")).unwrap();
        data["rules"]
            .as_array()
            .unwrap()
            .iter()
            .map(|rule| {
                (
                    Regex::new(&format!("(?i){}", rule["pattern"].as_str().unwrap())).unwrap(),
                    rule["gfx"].as_str().unwrap().into(),
                )
            })
            .collect()
    });
    for (pattern, target) in rules {
        if pattern.is_match(&names) {
            return target.clone();
        }
    }
    static PCI: OnceLock<Regex> = OnceLock::new();
    let pci = PCI.get_or_init(|| Regex::new(r"(?i)DEV_([a-f0-9]{4})").unwrap());
    for id in &hardware.pnp_ids {
        if let Some(id) = pci.captures(id) {
            let gfx = match id[1].to_ascii_lowercase().as_str() {
                "150e" => "gfx1150",
                "1114" => "gfx1152",
                "15bf" | "1900" => "gfx1103",
                "1681" => "gfx1035",
                "1506" | "164e" | "13c0" => "gfx1036",
                _ => continue,
            };
            return gfx.into();
        }
    }
    "gfx1100".into()
}
fn normalize_target(value: &str, dots: bool) -> String {
    let value = value.trim().to_ascii_lowercase();
    let value = value.strip_prefix("device-").unwrap_or(&value);
    let value = if dots {
        value.replace('.', "")
    } else {
        value.into()
    };
    if value.starts_with("gfx") {
        value
    } else {
        format!("gfx{value}")
    }
}
pub fn hsa_version(target: &str) -> Option<String> {
    let digits = target.strip_prefix("gfx")?;
    if !digits.bytes().all(|v| v.is_ascii_digit()) || !matches!(digits.len(), 3 | 4) {
        return None;
    }
    let (major, tail) = digits.split_at(digits.len() - 2);
    Some(format!(
        "{}.{}.{}",
        major.parse::<u32>().ok()?,
        &tail[..1],
        &tail[1..]
    ))
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Nvidia {
    pub name: String,
    pub compute_cap: f64,
}
pub fn legacy_nvidia(devices: &[Nvidia]) -> bool {
    static LEGACY: OnceLock<Regex> = OnceLock::new();
    static GTX: OnceLock<Regex> = OnceLock::new();
    let legacy=LEGACY.get_or_init(||Regex::new(r"(?i)\b(?:gt\s*\d+|p10[0-9]|p40|p4\b|cmp\s*(?:30|40|50)hx|titan\s*[xv]|tesla\s*[pmk]\d+)\b").unwrap());
    let gtx = GTX.get_or_init(|| Regex::new(r"(?i)\bgtx\s*(\d+)\b").unwrap());
    devices.iter().any(|gpu| {
        (gpu.compute_cap > 0. && gpu.compute_cap < 7.5)
            || legacy.is_match(&gpu.name)
            || gtx
                .captures(&gpu.name)
                .is_some_and(|m| !m[1].starts_with("16") || m[1].len() != 4)
    })
}
#[derive(Clone, Debug, PartialEq)]
pub struct TorchPolicy {
    pub cuda: Option<String>,
    pub legacy: bool,
    pub amd: bool,
}
pub fn torch_policy(
    platform: &str,
    amd: bool,
    explicit: Option<&str>,
    devices: &[Nvidia],
    driver: Option<(u32, u32)>,
) -> TorchPolicy {
    if platform == "win32" && amd {
        return TorchPolicy {
            cuda: None,
            legacy: false,
            amd: true,
        };
    }
    let explicit = explicit.unwrap_or("").trim().to_ascii_lowercase();
    let override_tag = explicit
        .strip_prefix("cu")
        .is_some_and(|s| !s.is_empty() && s.bytes().all(|v| v.is_ascii_digit()));
    let oldest = devices
        .iter()
        .map(|gpu| gpu.compute_cap)
        .filter(|v| *v > 0.)
        .reduce(f64::min)
        .unwrap_or(0.);
    let legacy = legacy_nvidia(devices);
    let cuda = if override_tag {
        Some(explicit)
    } else if explicit == "cpu" || platform == "darwin" || oldest > 0. && oldest < 5. {
        None
    } else if legacy || oldest > 0. && oldest < 7.5 {
        Some("cu126".into())
    } else if oldest >= 10. {
        Some("cu128".into())
    } else if driver.is_some_and(|version| version < (12, 8)) {
        Some("cu126".into())
    } else {
        Some("cu128".into())
    };
    TorchPolicy {
        legacy: legacy || cuda.as_deref() == Some("cu126"),
        cuda,
        amd: false,
    }
}
pub fn rocm_installed(venv: &Path) -> bool {
    let library = venv.join("Lib/site-packages/torch/lib");
    if [
        venv.join(".rocm-installed"),
        library.join(".rocm-installed"),
    ]
    .iter()
    .any(|p| p.is_file())
    {
        return true;
    }
    if [
        "amdhip64.dll",
        "torch_hip.dll",
        "c10_hip.dll",
        "rocblas.dll",
    ]
    .iter()
    .any(|name| library.join(name).is_file())
    {
        return true;
    }
    if std::fs::read_to_string(venv.join("Lib/site-packages/torch/version.py"))
        .is_ok_and(|v| v.contains("hip =") && !v.contains("hip = None"))
    {
        return true;
    }
    std::fs::read_dir(venv.join("Lib/site-packages")).is_ok_and(|entries| {
        entries.flatten().any(|e| {
            let n = e.file_name();
            let n = n.to_string_lossy();
            n.starts_with("amd_torch") || n.starts_with("rocm_sdk") || n == "rocm"
        })
    })
}
#[derive(Clone, Debug)]
pub struct Msvc {
    pub bin: PathBuf,
    pub includes: Vec<PathBuf>,
}

// vswhere can take seconds. Share discovery across every script and cloned
// runtime, while retrying missing tools promptly after a user installs them.
#[derive(Default)]
pub(crate) struct ToolchainCache(Mutex<Option<ToolchainEntry>>);
struct ToolchainEntry {
    root: Option<PathBuf>,
    at: Instant,
    msvc: Option<Msvc>,
}
impl ToolchainCache {
    pub(crate) fn invalidate(&self) {
        *self.0.lock().unwrap() = None;
    }
    fn msvc(&self, root: Option<&Path>, discover: impl FnOnce() -> Option<Msvc>) -> Option<Msvc> {
        let mut cache = self.0.lock().unwrap();
        if let Some(entry) = &*cache {
            let ttl = if entry.msvc.is_some() { 600 } else { 5 };
            if entry.root.as_deref() == root && entry.at.elapsed() < Duration::from_secs(ttl) {
                return entry.msvc.clone();
            }
        }
        let msvc = discover();
        *cache = Some(ToolchainEntry {
            root: root.map(Path::to_path_buf),
            at: Instant::now(),
            msvc: msvc.clone(),
        });
        msvc
    }
}
fn newest(directory: &Path) -> Option<PathBuf> {
    let mut paths = std::fs::read_dir(directory)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|p| p.is_dir())
        .collect::<Vec<_>>();
    paths.sort_by_cached_key(|p| {
        p.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .split('.')
            .map(|part| part.parse::<u32>().unwrap_or(0))
            .collect::<Vec<_>>()
    });
    paths.pop()
}
pub fn msvc_at(installation: &Path, pf86: &Path) -> Option<Msvc> {
    let tools = newest(&installation.join("VC/Tools/MSVC"))?;
    let bin = tools.join("bin/Hostx64/x64");
    if !bin.join("cl.exe").is_file() {
        return None;
    }
    let mut includes = vec![tools.join("include")];
    if let Some(sdk) = newest(&pf86.join("Windows Kits/10/Include")) {
        includes.extend(["ucrt", "shared", "um"].map(|sub| sdk.join(sub)));
    }
    includes.retain(|p| p.is_dir());
    Some(Msvc { bin, includes })
}
/// Merge into one child command. Never mutate the Rust process environment.
pub fn rocm_environment(
    venv: &Path,
    target: &str,
    hip: Option<&Path>,
    msvc: Option<&Msvc>,
    inherited: &BTreeMap<OsString, OsString>,
) -> Result<BTreeMap<OsString, OsString>> {
    let mut env = inherited.clone();
    let mut paths = vec![
        venv.join("Lib/site-packages/torch/lib"),
        venv.join("Scripts"),
    ];
    if let Some(hip) = hip {
        paths.insert(0, hip.join("bin"));
        env.entry("HIP_PATH".into())
            .or_insert_with(|| hip.as_os_str().to_owned());
    }
    if let Some(existing) = env.get(std::ffi::OsStr::new("PATH")) {
        paths.extend(std::env::split_paths(existing));
    }
    if let Some(msvc) = msvc {
        paths.push(msvc.bin.clone());
        let mut includes = env
            .get(std::ffi::OsStr::new("INCLUDE"))
            .map(|v| std::env::split_paths(v).collect::<Vec<_>>())
            .unwrap_or_default();
        includes.extend(msvc.includes.clone());
        env.insert("INCLUDE".into(), std::env::join_paths(includes)?);
    }
    env.insert("PATH".into(), std::env::join_paths(paths)?);
    for (key, value) in [
        ("HIP_VISIBLE_DEVICES", "0"),
        ("DISABLE_ADDMM_CUDA_LT", "1"),
        ("MIOPEN_FIND_MODE", "2"),
        ("MIOPEN_DEBUG_DISABLE_FIND_DB", "1"),
        ("MIOPEN_LOG_LEVEL", "0"),
        ("MIOPEN_ENABLE_LOGGING", "0"),
        ("AMD_COMGR_CACHE", "0"),
        ("TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL", "0"),
    ] {
        env.entry(key.into()).or_insert_with(|| value.into());
    }
    if let Some(version) = hsa_version(target) {
        env.entry("HSA_OVERRIDE_GFX_VERSION".into())
            .or_insert_with(|| version.into());
    }
    env.remove(std::ffi::OsStr::new("ZLUDA_COMGR_LOG_LEVEL"));
    Ok(env)
}

pub fn apply_to_command(
    runtime: &crate::engine_runtime::EngineRuntime,
    spec: &mut crate::process::CommandSpec,
) -> Result<()> {
    if !cfg!(windows) {
        return Ok(());
    }
    let venv = runtime
        .python_bin()
        .parent()
        .and_then(|bin| bin.parent())
        .filter(|path| path.join("pyvenv.cfg").is_file())
        .map(Path::to_path_buf)
        .unwrap_or_else(|| runtime.data.join(".venv"));
    let explicit = runtime
        .env("APPLIO_ROCM_GFX")
        .map(|v| v.to_string_lossy().into_owned());
    let hsa = runtime
        .env("HSA_OVERRIDE_GFX_VERSION")
        .map(|v| v.to_string_lossy().into_owned());
    if !rocm_installed(&venv) && explicit.is_none() {
        return Ok(());
    }
    // A stale ROCm installation must not override an NVIDIA discrete GPU.
    // Keep the explicit override available for users who choose their AMD GPU.
    if explicit
        .as_ref()
        .is_none_or(|value| value.trim().is_empty())
        && cached_hardware().nvidia()
    {
        return Ok(());
    }
    let marker = [
        venv.join(".rocm-installed"),
        venv.join("Lib/site-packages/torch/lib/.rocm-installed"),
    ]
    .iter()
    .find_map(|path| {
        std::fs::read(path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .and_then(|value| value["gfxTarget"].as_str().map(str::to_owned))
    });
    let hardware = if explicit.is_none() && hsa.is_none() && marker.is_none() {
        cached_hardware()
    } else {
        &Hardware::default()
    };
    let target = amd_target(
        hardware,
        explicit.as_deref().or(marker.as_deref()),
        hsa.as_deref(),
    );
    let mut inherited = BTreeMap::new();
    for key in [
        "PATH",
        "INCLUDE",
        "HIP_PATH",
        "HSA_OVERRIDE_GFX_VERSION",
        "HIP_VISIBLE_DEVICES",
        "DISABLE_ADDMM_CUDA_LT",
        "MIOPEN_FIND_MODE",
        "MIOPEN_DEBUG_DISABLE_FIND_DB",
        "MIOPEN_LOG_LEVEL",
        "MIOPEN_ENABLE_LOGGING",
        "AMD_COMGR_CACHE",
        "TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL",
    ] {
        if let Some(value) = runtime.env(key) {
            inherited.insert(key.into(), value);
        }
    }
    inherited.extend(spec.env.clone());
    let hip = find_hip();
    let pf86 = runtime.env("ProgramFiles(x86)").map(PathBuf::from);
    let msvc = runtime
        .toolchain
        .msvc(pf86.as_deref(), || find_msvc_in(pf86.as_deref()));
    spec.env = rocm_environment(&venv, &target, hip.as_deref(), msvc.as_ref(), &inherited)?;
    spec.env_remove.push("ZLUDA_COMGR_LOG_LEVEL".into());
    Ok(())
}
fn hardware_from_json(value: Value) -> Hardware {
    let entries = match value {
        Value::Array(entries) => entries,
        Value::Object(_) => vec![value],
        _ => Vec::new(),
    };
    let mut hardware = Hardware::default();
    for entry in entries {
        if let Some(name) = entry["Name"].as_str() {
            hardware.names.push(name.into());
        }
        if let Some(id) = entry["PNPDeviceID"].as_str() {
            hardware.pnp_ids.push(id.into());
        }
    }
    hardware
}
const HARDWARE_QUERY:&str="@(Get-CimInstance Win32_VideoController | Select-Object Name,PNPDeviceID) | ConvertTo-Json -Compress";
fn cached_hardware() -> &'static Hardware {
    static HARDWARE: OnceLock<Hardware> = OnceLock::new();
    HARDWARE.get_or_init(|| {
        blocking_output(
            Path::new("powershell.exe"),
            &["-NoProfile", "-NonInteractive", "-Command", HARDWARE_QUERY],
        )
        .and_then(|out| serde_json::from_str(&out).ok())
        .map(hardware_from_json)
        .unwrap_or_default()
    })
}
pub async fn hardware(cwd: &Path, token: &tokio_util::sync::CancellationToken) -> Result<Hardware> {
    hardware_with_env(cwd, &BTreeMap::new(), token).await
}
pub async fn hardware_with_env(
    cwd: &Path,
    env: &BTreeMap<OsString, OsString>,
    token: &tokio_util::sync::CancellationToken,
) -> Result<Hardware> {
    if !cfg!(windows) {
        return Ok(Hardware::default());
    }
    let mut spec = crate::process::CommandSpec::new("powershell.exe", cwd).args([
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        HARDWARE_QUERY,
    ]);
    spec.env.extend(env.clone());
    let output = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        crate::process::ManagedProcess::run(&spec, token, |_, _| {}),
    )
    .await??;
    output.ensure_success()?;
    Ok(hardware_from_json(serde_json::from_str(&output.stdout)?))
}
fn blocking_output(program: &Path, args: &[&str]) -> Option<String> {
    use std::process::{Command, Stdio};
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut child = command.spawn().ok()?;
    let start = std::time::Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                return status
                    .success()
                    .then(|| child.wait_with_output().ok())
                    .flatten()
                    .map(|output| String::from_utf8_lossy(&output.stdout).trim().to_owned())
            }
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
            Ok(None) => {}
        }
        if start.elapsed() > std::time::Duration::from_secs(8) {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
}
pub fn find_msvc() -> Option<Msvc> {
    find_msvc_in(
        std::env::var_os("ProgramFiles(x86)")
            .map(PathBuf::from)
            .as_deref(),
    )
}
pub fn find_msvc_in(pf86: Option<&Path>) -> Option<Msvc> {
    if !cfg!(windows) {
        return None;
    }
    let pf86 = pf86
        .map(Path::to_path_buf)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files (x86)"));
    let locator = pf86.join("Microsoft Visual Studio/Installer/vswhere.exe");
    if !locator.is_file() {
        return None;
    }
    let installation = blocking_output(
        &locator,
        &[
            "-latest",
            "-products",
            "*",
            "-requires",
            "Microsoft.VisualStudio.Component.VC.Tools.x86.x64",
            "-property",
            "installationPath",
        ],
    )?;
    msvc_at(Path::new(&installation), &pf86)
}
pub fn find_hip() -> Option<PathBuf> {
    for variable in ["HIP_PATH", "ROCM_PATH"] {
        if let Some(path) = std::env::var_os(variable)
            .map(PathBuf::from)
            .filter(|p| p.is_dir())
        {
            return Some(path);
        }
    }
    let pf = std::env::var_os("ProgramFiles")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    newest(&pf.join("AMD/ROCm"))
}
