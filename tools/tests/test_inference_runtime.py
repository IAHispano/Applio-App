"""Exercise the production launcher and the engine's existing IPC/CLI."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "applio"))


class InferenceRuntimeTests(unittest.TestCase):
    def launch(self, mode, args=(), stdin=""):
        with tempfile.TemporaryDirectory() as folder:
            env = {
                **os.environ,
                "APPLIO_ROOT": folder,
                "APPLIO_CODE_ROOT": str(ROOT),
                "APPLIO_CONFIG_DIR": folder,
                "APPLIO_BACKEND_ROOT": str(ROOT / "backend" / "applio"),
            }
            return subprocess.run(
                [
                    sys.executable,
                    str(ROOT / "tools" / "inference_runtime.py"),
                    mode,
                    *args,
                ],
                input=stdin,
                capture_output=True,
                text=True,
                env=env,
                # Match a packaged app with a separate writable working dir.
                cwd=folder,
                timeout=90,
            )

    def test_worker_ready_ping_and_invalid_command_keep_existing_protocol(self):
        result = self.launch(
            "worker",
            stdin='{"command":"ping","id":"check"}\n{"command":"unknown","id":"bad"}\n',
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        messages = [
            json.loads(line)
            for line in result.stdout.splitlines()
            if line.startswith('{"_applio_ipc":')
        ]
        self.assertEqual(
            [message["type"] for message in messages], ["ready", "pong", "error"]
        )
        self.assertEqual(messages[1]["id"], "check")
        self.assertEqual(messages[2]["id"], "bad")

    def test_standalone_cli_preserves_inference_flags(self):
        result = self.launch("infer", ["--help"])
        self.assertEqual(result.returncode, 0, result.stderr)
        for flag in (
            "--input-path",
            "--split-audio",
            "--protect",
            "--onnx-precision",
            "--f0-method",
        ):
            self.assertIn(flag, result.stdout)

    def test_late_install_updates_existing_imports_and_is_idempotent(self):
        from rvc.infer import infer, pipeline
        from rvc.lib.tools import split_audio
        from tools.optimized_inference import OptimizedPipeline, install
        from tools.inference_algorithms import merge_audio

        with patch.object(infer, "VC", infer.VC), patch.object(
            infer, "merge_audio", infer.merge_audio
        ), patch.object(pipeline, "Pipeline", pipeline.Pipeline), patch.object(
            split_audio, "merge_audio", split_audio.merge_audio
        ):
            install()
            install()
            config = SimpleNamespace(
                x_pad=1, x_query=1, x_center=2, x_max=3, device="cpu"
            )
            converter = infer.VoiceConverter(config=config)
            converter.cpt = {"config": [1, 2, 40000]}
            converter.tgt_sr = 40000
            converter.setup_vc_instance()
            self.assertIsInstance(converter.vc, OptimizedPipeline)
            self.assertIs(infer.merge_audio, merge_audio)


if __name__ == "__main__":
    unittest.main()
