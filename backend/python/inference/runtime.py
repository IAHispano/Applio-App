"""Launch the pinned worker/CLI with Applio-App's inference adapter."""

import os
from pathlib import Path
import runpy
import sys


def main():
    code_root = Path(__file__).resolve().parents[3]
    backend = Path(
        os.environ.get("APPLIO_BACKEND_ROOT") or code_root / "backend" / "applio"
    )
    sys.path[:0] = [str(backend), str(code_root)]
    if sys.platform == "darwin":
        os.environ.setdefault("OMP_NUM_THREADS", "1")
        os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    if len(sys.argv) < 2 or sys.argv[1] not in ("worker", "infer"):
        raise SystemExit("Usage: runtime.py {worker|infer} [inference options]")
    mode = sys.argv.pop(1)
    if mode == "worker":
        from backend.python.inference.worker import run

        run(backend)
        return
    from backend.python.inference.optimized import install

    install()
    runpy.run_module(f"rvc.infer.{mode}", run_name="__main__")


if __name__ == "__main__":
    main()
