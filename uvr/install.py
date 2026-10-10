"""Install optional separation dependencies without replacing the RVC runtime."""

import importlib.metadata as metadata
import importlib.util
from pathlib import Path
import subprocess
import sys
import tempfile

MODULES = (
    "onnx",
    "onnx2torch",
    "torchvision",
    "julius",
    "rotary_embedding_torch",
    "beartype",
    "ml_collections",
)


def ensure_dependencies():
    if all(importlib.util.find_spec(name) is not None for name in MODULES):
        return
    torch_version = metadata.version("torch")
    base_version = torch_version.split("+")[0]
    vision_version = {"2.11.0": "0.26.0", "2.7.1": "0.22.1"}.get(base_version)
    if vision_version is None:
        raise RuntimeError(
            f"Unsupported torch {torch_version}; run Install / Repair first."
        )
    root = Path(__file__).resolve().parent.parent
    requirements = (root / "requirements-uvr.txt").read_text(encoding="utf-8")
    if "+cu" in torch_version or "+cpu" in torch_version or "+rocm" in torch_version:
        vision_version += "+" + torch_version.split("+")[1]
    requirements = requirements.replace(
        "torchvision>=0.26.0", f"torchvision=={vision_version}"
    )
    constraints = []
    for package in ("torch", "torchaudio", "numpy", "scipy", "librosa", "transformers"):
        try:
            constraints.append(f"{package}=={metadata.version(package)}")
        except metadata.PackageNotFoundError:
            pass
    with tempfile.TemporaryDirectory(prefix="applio-uvr-") as directory:
        requirements_file = Path(directory) / "requirements.txt"
        constraints_file = Path(directory) / "constraints.txt"
        requirements_file.write_text(requirements, encoding="utf-8")
        constraints_file.write_text("\n".join(constraints), encoding="utf-8")
        command = [
            sys.executable,
            "-m",
            "pip",
            "install",
            "-r",
            str(requirements_file),
            "-c",
            str(constraints_file),
        ]
        if "+cu" in torch_version or "+cpu" in torch_version or "+rocm" in torch_version:
            cuda = torch_version.split("+")[1]
            command.extend(
                ["--extra-index-url", f"https://download.pytorch.org/whl/{cuda}"]
            )
        print("Installing optional audio separation dependencies…", flush=True)
        subprocess.run(command, check=True)
    if not all(importlib.util.find_spec(name) is not None for name in MODULES):
        raise RuntimeError("Audio separation dependencies are incomplete.")


if __name__ == "__main__":
    ensure_dependencies()
    print("UVR dependencies ready.", flush=True)
