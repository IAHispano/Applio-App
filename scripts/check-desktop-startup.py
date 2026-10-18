"""Launch a packaged Unix desktop app and verify UI readiness and API restart.

This checks first-launch packaging without downloading a Python environment or
models. Microphone, GPU inference, tray interaction and signed updates still
require platform acceptance testing.
"""

import json
import os
import signal
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


def main():
    for port in (3000, 8000):
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", port))
    executable = Path(sys.argv[1]).resolve(strict=True)
    with tempfile.TemporaryDirectory(prefix="applio-startup-") as directory:
        root = Path(directory)
        environment = dict(os.environ, HOME=str(root), XDG_CONFIG_HOME=str(root / "config"),
                           XDG_DATA_HOME=str(root / "data"), XDG_CACHE_HOME=str(root / "cache"))
        # Ignore proxy settings for the loopback application services.
        http = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def request(path, method="GET"):
            with http.open(urllib.request.Request("http://127.0.0.1:3000" + path, method=method), timeout=3) as response:
                return response.read()

        def wait_for(predicate, message):
            deadline = time.monotonic() + 90
            while time.monotonic() < deadline:
                if process.poll() is not None:
                    raise RuntimeError(f"Desktop exited early: {process.returncode}")
                try:
                    value = predicate()
                    if value:
                        return value
                except (OSError, ValueError):
                    pass
                time.sleep(0.25)
            raise RuntimeError(message)

        with (root / "process.log").open("w+") as log:
            process = subprocess.Popen([str(executable), *sys.argv[2:]], env=environment,
                                       stdout=log, stderr=log, start_new_session=True)
            try:
                health = wait_for(lambda: json.loads(request("/api/health")), "API did not start")
                assert health["ok"] and health["instanceId"]
                assert b"<html" in request("/")
                wait_for(lambda: any("Interface ready" in path.read_text(errors="replace")
                                     for path in root.rglob("launcher.log")),
                         "Native WebView did not finish loading the interface")
                response = json.loads(request("/api/settings/restart", "POST"))
                assert response["instanceId"] == health["instanceId"]
                wait_for(lambda: json.loads(request("/api/health"))["instanceId"] != health["instanceId"],
                         "API restart did not create a new generation")
                print("Packaged desktop: native WebView ready, exported UI served, API restart verified.")
            except Exception:
                log.flush()
                log.seek(0)
                print(log.read(), file=sys.stderr)
                for path in root.rglob("launcher.log"):
                    print(path.read_text(errors="replace"), file=sys.stderr)
                raise
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=10)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait()


if __name__ == "__main__":
    main()
