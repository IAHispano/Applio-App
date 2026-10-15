use crate::gpu_runtime::TorchPolicy;
use anyhow::{bail, Context, Result};
use regex::Regex;
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::OnceLock,
};

pub fn read(path: &Path) -> Result<String> {
    flatten(path, &mut HashSet::new())
}
fn flatten(path: &Path, ancestors: &mut HashSet<PathBuf>) -> Result<String> {
    let path = std::fs::canonicalize(path)
        .with_context(|| format!("Missing requirements file {}", path.display()))?;
    if !ancestors.insert(path.clone()) {
        bail!("Circular requirements include: {}", path.display());
    }
    static INCLUDE: OnceLock<Regex> = OnceLock::new();
    let include =
        INCLUDE.get_or_init(|| Regex::new(r"^(?:-r\s*|--requirement(?:\s+|=))(.+)$").unwrap());
    let mut output = Vec::new();
    for line in std::fs::read_to_string(&path)?.lines() {
        if let Some(found) = include.captures(line.trim()) {
            output.push(flatten(
                &path.parent().unwrap().join(found[1].trim()),
                ancestors,
            )?);
        } else {
            output.push(line.to_owned());
        }
    }
    ancestors.remove(&path);
    Ok(output.join("\n"))
}
pub fn distribution(platform: &str, amd: bool) -> &'static str {
    if platform == "win32" && !amd {
        "onnxruntime-gpu"
    } else {
        "onnxruntime"
    }
}
pub fn resolve(content: &str, platform: &str, policy: &TorchPolicy) -> Result<String> {
    static ONNX: OnceLock<Regex> = OnceLock::new();
    let onnx = ONNX.get_or_init(|| Regex::new(r"(?i)^onnxruntime(?:-gpu)?(?:[<>=;\s]|$)").unwrap());
    let distribution = distribution(platform, policy.amd);
    let lines = content.lines().collect::<Vec<_>>();
    let selected = lines
        .iter()
        .find(|line| {
            let name = line
                .trim()
                .split(['<', '>', '=', ';', ' ', '\t'])
                .next()
                .unwrap_or("");
            name == distribution
        })
        .context(format!("Missing {distribution} requirement"))?
        .split(';')
        .next()
        .unwrap()
        .trim();
    let mut output = lines
        .into_iter()
        .filter(|line| !onnx.is_match(line.trim()))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    output.push(selected.into());
    let content = output.join("\n");
    if policy.amd {
        static AMD: OnceLock<Regex> = OnceLock::new();
        let omitted = AMD.get_or_init(|| {
            Regex::new(r"(?i)^(?:torch==|torchaudio==|torchvision|nvidia-|onnxruntime-gpu)")
                .unwrap()
        });
        return Ok(content
            .lines()
            .filter(|line| !omitted.is_match(line.trim()))
            .collect::<Vec<_>>()
            .join("\n"));
    }
    if policy.legacy {
        let content = Regex::new(r"torch==\d+\.\d+\.\d+")?.replace_all(&content, "torch==2.7.1");
        let content =
            Regex::new(r"torchaudio==\d+\.\d+\.\d+")?.replace_all(&content, "torchaudio==2.7.1");
        return Ok(Regex::new(r"torchvision(?:>=|==)\d+\.\d+\.\d+")?
            .replace_all(&content, "torchvision==0.22.1")
            .into_owned());
    }
    Ok(content)
}

#[cfg(test)]
mod checks {
    use super::*;
    #[test]
    fn requirements_includes_are_relative_and_cycles_fail_before_installation() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path();
        std::fs::create_dir(root.join("nested")).unwrap();
        std::fs::write(
            root.join("requirements.txt"),
            "-r nested/engine.txt\napp==1\n",
        )
        .unwrap();
        std::fs::write(root.join("nested/engine.txt"),"onnxruntime>=1; sys_platform != 'win32'\nonnxruntime-gpu==2; sys_platform == 'win32'\ntorch==2.11.0\ntorchaudio==2.11.0\ntorchvision>=1.2.3\nnvidia-cudnn-cu12==9\n").unwrap();
        let content = read(&root.join("requirements.txt")).unwrap();
        let legacy = resolve(
            &content,
            "win32",
            &TorchPolicy {
                cuda: Some("cu126".into()),
                legacy: true,
                amd: false,
            },
        )
        .unwrap();
        assert!(legacy.contains("torch==2.7.1"));
        assert!(legacy.contains("torchaudio==2.7.1"));
        assert!(legacy.contains("torchvision==0.22.1"));
        assert!(legacy.ends_with("onnxruntime-gpu==2"));
        assert!(!legacy.contains("onnxruntime>=1"));
        let amd = resolve(
            &content,
            "win32",
            &TorchPolicy {
                cuda: None,
                legacy: false,
                amd: true,
            },
        )
        .unwrap();
        assert!(amd.ends_with("onnxruntime>=1"));
        assert!(!amd.contains("torch=="));
        assert!(!amd.contains("nvidia-"));
        std::fs::write(
            root.join("nested/engine.txt"),
            "--requirement=../requirements.txt",
        )
        .unwrap();
        assert!(read(&root.join("requirements.txt"))
            .unwrap_err()
            .to_string()
            .contains("Circular"));
    }
}
