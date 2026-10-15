"""Check lazy worker compatibility; optionally time safe script startup paths."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend/applio"
ENTRY = ROOT / "backend/python/inference/runtime.py"
NO_ML = """
import sys
class NoML:
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'torch','torchaudio','librosa','numpy','soxr','soundfile','transformers','faiss'}:
            raise AssertionError('Unnecessary ML import: '+fullname)
sys.meta_path.insert(0, NoML())
"""


def run(args, env, directory, messages=(), runner=None):
    command = [sys.executable]
    if runner:
        command += ["-c", runner]
    command += [str(arg) for arg in args]
    start = time.perf_counter()
    output = subprocess.run(
        command,
        cwd=directory,
        env=env,
        text=True,
        input="".join(json.dumps(message) + "\n" for message in messages),
        capture_output=True,
        timeout=120,
    )
    assert output.returncode == 0, output.stdout + output.stderr
    return output, time.perf_counter() - start


def events(output):
    return [
        json.loads(line)
        for line in output.stdout.splitlines()
        if line.startswith('{"_applio_ipc"')
    ]


def main():
    with tempfile.TemporaryDirectory(prefix="applio-python-startup-") as temporary:
        directory = Path(temporary)
        env = {
            **os.environ,
            "APPLIO_BACKEND_ROOT": str(BACKEND),
            "APPLIO_ROOT": temporary,
            "APPLIO_LOGS_DIR": str(directory / "logs"),
            "APPLIO_CONFIG_DIR": str(directory / "config"),
            "PYTHONPATH": os.pathsep.join([str(BACKEND), str(ROOT)]),
            "PYTHONUNBUFFERED": "1",
            "PYTHONIOENCODING": "utf-8",
            "CUDA_VISIBLE_DEVICES": "",  # startup checks never allocate GPU memory
        }
        env.pop("PYTHONHOME", None)
        runner = (
            NO_ML
            + "\nimport runpy; script=sys.argv.pop(1); runpy.run_path(script, run_name='__main__')"
        )
        output, elapsed = run(
            [ENTRY, "worker"],
            env,
            directory,
            [{"command": "ping", "id": "ping"}],
            runner,
        )
        assert [event["type"] for event in events(output)] == ["ready", "pong"]
        print(f"Real worker ready + ping without ML imports: {elapsed:.3f}s")

        # Run the actual pinned protocol against tiny utility/converter fixtures.
        # This proves utilities avoid converter construction and subsequent
        # conversion/preload calls share exactly one installed converter.
        fixture = directory / "backend"
        for folder in ["rvc/infer", "rvc/lib/tools"]:
            (fixture / folder).mkdir(parents=True)
        for folder in ["rvc", "rvc/infer", "rvc/lib", "rvc/lib/tools"]:
            (fixture / folder / "__init__.py").write_text("")
        shutil.copyfile(
            BACKEND / "rvc/infer/worker.py", fixture / "rvc/infer/worker.py"
        )
        (fixture / "rvc/lib/tools/inspect_checkpoint.py").write_text(
            "def inspect_checkpoint(path): return {'model_name':'fixture'}\n"
        )
        (fixture / "edge_tts.py").write_text(
            "from pathlib import Path\n"
            "class Communicate:\n"
            " def __init__(self,*args,**kwargs): pass\n"
            " async def save(self,path): Path(path).write_bytes(b'speech')\n"
        )
        (fixture / "rvc/infer/infer.py").write_text(
            """
from pathlib import Path
class VoiceConverter:
    def __init__(self):
        p=Path('converter-count'); p.write_text(p.read_text()+'x' if p.exists() else 'x')
    def convert_audio(self, **kwargs): Path(kwargs['audio_output_path']).write_bytes(b'converted')
    def get_vc(self, path, sid): pass
    def cleanup_model(self): pass
"""
        )
        fixture_env = {**env, "APPLIO_BACKEND_ROOT": str(fixture)}
        voice = directory / "voice.pth"
        voice.write_bytes(b"fixture")
        install_stub = """
import types
from pathlib import Path
stub=types.ModuleType('backend.python.inference.optimized')
def install():
    p=Path('install-count'); p.write_text(p.read_text()+'x' if p.exists() else 'x')
stub.install=install
sys.modules['backend.python.inference.optimized']=stub
"""
        fixture_runner = (
            NO_ML
            + install_stub
            + "\nimport runpy; script=sys.argv.pop(1); runpy.run_path(script, run_name='__main__')"
        )
        output, _ = run(
            [ENTRY, "worker"],
            fixture_env,
            directory,
            [
                {
                    "command": "tts",
                    "id": "tts",
                    "ttsText": "fixture",
                    "outputTtsPath": str(directory / "speech.wav"),
                },
                {"command": "inspect_model", "id": "inspect", "pthPath": str(voice)},
            ],
            fixture_runner,
        )
        assert (
            events(output)[-1].get("metadata", {}).get("model_name") == "fixture"
        ), output.stdout
        assert (directory / "speech.wav").read_bytes() == b"speech"
        assert not (directory / "converter-count").exists()
        assert not (directory / "install-count").exists()
        requests = [
            {
                "command": "infer",
                "id": str(i),
                "params": {},
                "inputPath": str(voice),
                "outputPath": str(directory / f"out-{i}.wav"),
            }
            for i in range(2)
        ] + [
            {"command": "preload_model", "id": "preload", "pthPath": str(voice)},
            {"command": "invalid-command", "id": "invalid"},
            {"command": "ping", "id": "still-alive"},
        ]
        output, _ = run(
            [ENTRY, "worker"], fixture_env, directory, requests, fixture_runner
        )
        assert [e["type"] for e in events(output)] == [
            "ready",
            "done",
            "done",
            "done",
            "error",
            "pong",
        ], output.stdout
        assert (directory / "converter-count").read_text() == "x"
        assert (directory / "install-count").read_text() == "x"
        assert (directory / "out-1.wav").read_bytes() == b"converted"
        print(
            "Metadata avoids conversion imports; conversion/preload reuse one converter"
        )

        if "--benchmark" in sys.argv:
            eager = """
import runpy
import torch
torch.cuda.is_available = lambda: False
from backend.python.inference.optimized import install
install()
runpy.run_module('rvc.infer.worker', run_name='__main__')
"""
            _, elapsed = run(
                [], env, directory, [{"command": "ping", "id": "ping"}], eager
            )
            print(f"Previous eager worker ready + ping (CPU): {elapsed:.3f}s")
            checkpoint = directory / "metadata-fixture.pth"
            run(
                [
                    "-c",
                    "import sys,torch; torch.save({'epoch':7,'model_name':'startup-fixture'},sys.argv[1])",
                    checkpoint,
                ],
                env,
                directory,
            )
            output, elapsed = run(
                [ENTRY, "worker"],
                env,
                directory,
                [
                    {
                        "command": "inspect_model",
                        "id": "metadata",
                        "pthPath": str(checkpoint),
                    }
                ],
            )
            assert (
                events(output)[-1].get("metadata", {}).get("model_name")
                == "startup-fixture"
            ), output.stdout
            print(f"Real checkpoint metadata through lazy worker: {elapsed:.3f}s")
            scripts = [
                ("YouTube CLI", [ROOT / "backend/python/audio/youtube.py", "--help"]),
                (
                    "Model downloader CLI",
                    [ROOT / "backend/python/downloads/model.py", "--help"],
                ),
                (
                    "Dataset review CLI",
                    [ROOT / "backend/python/datasets/quality.py", "--help"],
                ),
                ("UVR catalog", [ROOT / "uvr/separate.py", "--list-models"]),
                (
                    "Prerequisites CLI",
                    [BACKEND / "rvc/lib/tools/prerequisites_download.py", "--help"],
                ),
                ("TTS CLI", [BACKEND / "rvc/lib/tools/tts.py", "--help"]),
            ]
            for label, args in scripts:
                _, elapsed = run(args, env, directory)
                print(f"{label}: {elapsed:.3f}s")


if __name__ == "__main__":
    main()
