"""Run the pinned downloader without loading unrelated audio/ML dependencies."""

import os
from pathlib import Path
import runpy
import sys


def main():
    root = Path(__file__).resolve().parents[3]
    backend = Path(os.environ.get("APPLIO_BACKEND_ROOT") or root / "backend/applio")
    sys.path.insert(0, str(backend))
    runpy.run_module("rvc.lib.tools.model_download", run_name="__main__", alter_sys=True)


if __name__ == "__main__":
    main()
