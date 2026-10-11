"""Exercise live settings on the real audio socket: --model logs/voice/voice.pth."""
import argparse
import asyncio
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

import numpy as np
import websockets

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--model", required=True, type=Path)
parser.add_argument("--graphs", action="store_true")
args = parser.parse_args()
model = args.model.resolve()
if not model.is_file():
    parser.error("Model file not found")
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]


async def exercise(process, alternate_model):
    for _ in range(300):
        if process.poll() is not None:
            raise RuntimeError("Realtime server exited")
        try:
            ws = await websockets.connect(f"ws://127.0.0.1:{port}/ws-audio", max_size=None)
            break
        except OSError:
            await asyncio.sleep(.2)
    else:
        raise TimeoutError("Realtime server startup timed out")
    async with ws:
        await ws.send(json.dumps(dict(
            model_path=str(model), index_path="", f0_method="rmvpe",
            embedder_model="contentvec", embedder_model_custom=None,
            block_frame=4800, automatic_block_size=False,
            cross_fade_overlap_size=.05, extra_convert_size=.5,
            silent_threshold=-90, vad_enabled=True, sid=0, clean_audio=False,
            clean_strength=.5, post_process=False, kwargs={}, input_audio_gain=100,
            f0_up_key=0, index_rate=0, protect=.5, volume_envelope=1,
            autotune=False, autotune_strength=1, proposed_pitch=False,
            proposed_pitch_threshold=155, decoder_fp16=False,
        )))
        ready = json.loads(await asyncio.wait_for(ws.recv(), 90))
        assert ready == {"type": "ready", "block_frame": 4800}, ready

        async def audio(frames):
            tone = (.05 * np.sin(np.arange(frames) * 2 * np.pi * 220 / 48000)).astype(np.float32)
            await ws.send(tone.tobytes())
            latency = json.loads(await asyncio.wait_for(ws.recv(), 30))
            assert latency["type"] == "latency", latency
            result = np.frombuffer(await asyncio.wait_for(ws.recv(), 30), dtype=np.float32)
            assert result.shape == (frames,) and np.isfinite(result).all()
            assert np.max(np.abs(result)) > 1e-6, "Sustained voice was cut"

        await audio(4800)
        await ws.send(json.dumps({"type": "configure", "id": 1, "changes": {
            "block_frame": 9600, "autotune": True, "input_audio_gain": 80,
        }}))
        reply = json.loads(await asyncio.wait_for(ws.recv(), 30))
        assert reply == {"type": "config_applied", "id": 1, "block_frame": 9600}, reply
        await audio(9600)
        await ws.send(json.dumps({"type": "configure", "id": 4, "changes": {
            "model_path": str(alternate_model), "post_process": True,
        }, "kwargs": {"gain": True, "gain_db": 3}}))
        reply = json.loads(await asyncio.wait_for(ws.recv(), 60))
        assert reply == {"type": "config_applied", "id": 4, "block_frame": 9600}, reply
        await audio(9600)
        await ws.send(json.dumps({"type": "configure", "id": 2, "changes": {"model_path": "missing.pth"}}))
        reply = json.loads(await asyncio.wait_for(ws.recv(), 30))
        assert reply["type"] == "config_error" and reply["id"] == 2, reply
        await audio(9600)
        await ws.send("{invalid json")
        assert json.loads(await ws.recv())["type"] == "config_error"
        await audio(9600)
        # Legacy clients use a separate socket: resizing must also affect audio.
        async with websockets.connect(f"ws://127.0.0.1:{port}/change-config") as config:
            await config.send(json.dumps({"key": "block_frame", "value": 4800, "id": 3}))
            reply = json.loads(await asyncio.wait_for(config.recv(), 30))
            assert reply == {"type": "config_applied", "id": 3, "block_frame": 4800}, reply
        await audio(4800)
        print("Real audio socket: live model/effects/resize/autotune/gain, rejected settings, malformed JSON and legacy configuration passed.")


environment = {**os.environ, "PYTHONPATH": str(ROOT / "backend" / "applio"),
               "APPLIO_ENABLE_CUDA_GRAPHS": "1" if args.graphs else "0"}
scratch = ROOT / ".cache"
scratch.mkdir(exist_ok=True)
with tempfile.TemporaryDirectory(prefix="realtime-socket-", dir=scratch) as temporary, tempfile.TemporaryFile(mode="w+b") as log:
    alternate_model = Path(temporary) / "alternate.pth"
    os.link(model, alternate_model)
    process = subprocess.Popen([
        sys.executable, "-m", "uvicorn", "rvc.realtime.client:app",
        "--host", "127.0.0.1", "--port", str(port),
    ], cwd=ROOT, env=environment, stdout=log, stderr=log)
    try:
        asyncio.run(exercise(process, alternate_model))
    except Exception:
        log.seek(0)
        print(log.read().decode("utf-8", errors="replace"), file=sys.stderr)
        raise
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait()
