"""Run the shared Applio TTS engine from the desktop managed runtime."""

import os
from pathlib import Path
import sys

sys.path.insert(
    0,
    str(
        Path(
            os.environ.get("APPLIO_BACKEND_ROOT")
            or Path(__file__).resolve().parents[3] / "backend" / "applio"
        )
    ),
)
from rvc.lib.tools.text_rvc.__main__ import main

if __name__ == "__main__":
    main()
