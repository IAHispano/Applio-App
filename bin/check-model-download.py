"""Check the download adapter with engine Python, local HTTP and no ML imports."""

import ast
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import time
import zipfile


ROOT = Path(__file__).resolve().parents[1]
ADAPTER = ROOT / "backend/python/downloads/model.py"
BACKEND = ROOT / "backend/applio"


def main():
    spec = importlib.util.spec_from_file_location("download_adapter", ADAPTER)
    adapter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(adapter)
    # Compare against the actual pinned helper without importing its ML stack.
    tree = ast.parse((BACKEND / "rvc/lib/utils.py").read_text(encoding="utf-8"))
    function = next(
        n
        for n in tree.body
        if isinstance(n, ast.FunctionDef) and n.name == "format_title"
    )
    namespace = {"re": adapter.re, "unicodedata": adapter.unicodedata}
    exec(
        compile(ast.Module(body=[function], type_ignores=[]), "upstream", "exec"),
        namespace,
    )
    for title in [
        "─Cafe\u0301 音声.zip",
        "a\t b — c",
        "emoji😀.zip",
        "",
        "...",
        "a/b\\c",
    ]:
        assert adapter.format_title(title) == namespace["format_title"](title)

    with tempfile.TemporaryDirectory(prefix="applio-download-check-") as temporary:
        directory = Path(temporary)
        archive = directory / "Test Voice.zip"
        with zipfile.ZipFile(archive, "w") as zipped:
            zipped.writestr("nested/original.pth", b"fixture-model")
            zipped.writestr("nested/original.index", b"fixture-index")
        with zipfile.ZipFile(directory / "unsafe.zip", "w") as zipped:
            zipped.writestr("../../escape.pth", b"unsafe")
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=temporary)
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        env = {
            **os.environ,
            "APPLIO_LOGS_DIR": str(directory / "logs"),
            "APPLIO_BACKEND_ROOT": str(BACKEND),
        }
        env.pop("PYTHONHOME", None)
        # Fail immediately if the downloader imports any ML/audio packages.
        runner = """
import sys, runpy
class NoML:
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'torch','torchaudio','librosa','soxr','soundfile','numpy'}:
            raise AssertionError('Unexpected ML import: '+fullname)
sys.meta_path.insert(0, NoML())
script=sys.argv.pop(1)
runpy.run_path(script, run_name='__main__')
"""
        try:
            start = time.perf_counter()
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    runner,
                    str(ADAPTER),
                    f"http://127.0.0.1:{server.server_port}/Test%20Voice.zip",
                ],
                cwd=temporary,
                env=env,
                capture_output=True,
                text=True,
                timeout=60,
            )
            assert result.returncode == 0, result.stdout + result.stderr
            assert "Model downloaded successfully." in result.stdout
            assert (
                directory / "logs/Test_Voice/Test_Voice.pth"
            ).read_bytes() == b"fixture-model"
            assert (
                directory / "logs/Test_Voice/Test_Voice.index"
            ).read_bytes() == b"fixture-index"
            print(
                f"Local model download and extraction: {time.perf_counter() - start:.3f}s (no ML imports)"
            )
            result = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    runner,
                    str(ADAPTER),
                    f"http://127.0.0.1:{server.server_port}/unsafe.zip",
                ],
                cwd=temporary,
                env=env,
                capture_output=True,
                text=True,
                timeout=60,
            )
            assert result.returncode != 0, result.stdout
            assert not (directory / "escape.pth").exists()
            print("Filename compatibility and unsafe archive rejection passed")
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        if "--benchmark" in sys.argv:
            env["PYTHONPATH"] = os.pathsep.join([str(BACKEND), str(ROOT)])
            for script in [BACKEND / "rvc/lib/tools/model_download.py", ADAPTER]:
                samples = []
                for _ in range(2):
                    start = time.perf_counter()
                    result = subprocess.run(
                        [sys.executable, str(script), "--help"],
                        cwd=temporary,
                        env=env,
                        capture_output=True,
                        text=True,
                        timeout=120,
                    )
                    assert result.returncode == 0, result.stdout + result.stderr
                    samples.append(round(time.perf_counter() - start, 3))
                print(f"{script.name} CLI startup seconds: {samples}")


if __name__ == "__main__":
    main()
