"""Run the pinned downloader without loading the audio/ML stack for a filename."""

import ast
import os
from pathlib import Path
import re
import sys
import unicodedata


def format_title(title):
    title = unicodedata.normalize("NFC", title)
    title = re.sub(r"[\u2500-\u257F]+", "", title)
    title = re.sub(r"[^\w\s.-]", "", title, flags=re.UNICODE)
    return re.sub(r"\s+", "_", title)


def main():
    root = Path(__file__).resolve().parents[1]
    backend = Path(os.environ.get("APPLIO_BACKEND_ROOT") or root / "backend/applio")
    script = backend / "rvc/lib/tools/model_download.py"
    sys.path.insert(0, str(backend))
    tree = ast.parse(script.read_text(encoding="utf-8"), filename=str(script))
    # Keep all provider, archive and HTTP handling upstream. Replace only its
    # filename helper import; importing rvc.lib.utils also imports Torch/audio.
    for node in list(tree.body):
        if isinstance(node, ast.ImportFrom) and node.module == "rvc.lib.utils":
            if [(alias.name, alias.asname) for alias in node.names] != [
                ("format_title", None)
            ]:
                raise RuntimeError("Downloader utility imports changed; update adapter")
            tree.body.remove(node)
    sys.argv[0] = str(script)
    exec(
        compile(tree, str(script), "exec"),
        {"__name__": "__main__", "__file__": str(script), "format_title": format_title},
    )


if __name__ == "__main__":
    main()
