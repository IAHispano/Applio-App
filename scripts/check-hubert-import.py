"""Reproduce an unusable optional torchvision without modifying site-packages."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
for error in ("RuntimeError", "OSError", "ImportError"):
    code = f'''
import sys, builtins
sys.path.insert(0, {str(root / "backend/applio")!r})
from transformers.utils import import_utils
import_utils.is_torchvision_available = lambda: True
original_import = builtins.__import__
def broken_vision(name, *args, **kwargs):
    if name == "torchvision":
        raise {error}("operator torchvision::nms does not exist")
    return original_import(name, *args, **kwargs)
builtins.__import__ = broken_vision
from rvc.lib.utils import get_hubert_model_class
assert get_hubert_model_class().__name__ == "_RealHubertModelWithFinalProj"
'''
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert "Ignoring unavailable optional torchvision" in result.stderr
    print(f"HuBERT loaded with broken torchvision ({error}).", flush=True)
