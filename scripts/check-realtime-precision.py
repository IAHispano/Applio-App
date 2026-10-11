"""Exercise the optional HuBERT precision path with real CUDA graphs."""

import os
from pathlib import Path
import sys
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend/applio"))
os.chdir(ROOT)
os.environ.setdefault("APPLIO_ROOT", str(ROOT))
os.environ["APPLIO_ENABLE_CUDA_GRAPHS"] = "1"
import numpy as np
import torch
from rvc.lib.user_config import load_config, resolve_logs_path
from rvc.realtime.core import VoiceChanger
from rvc.realtime.pipeline import Realtime_Pipeline
from rvc.realtime.precision import enable_experimental_tf32

if (
    not torch.cuda.is_available()
    or "NVIDIA" not in torch.cuda.get_device_name().upper()
):
    raise SystemExit("This hardware regression requires NVIDIA CUDA.")

original_tf32 = torch.backends.cuda.matmul.allow_tf32
os.environ["APPLIO_EXPERIMENTAL_TF32"] = "1"
with patch.object(
    torch.cuda,
    "get_device_capability",
    side_effect=AssertionError("Unexpected CUDA query"),
):
    for device, name in (
        ("cpu", None),
        ("mps", "Apple Silicon"),
        ("cuda:0", "AMD Radeon"),
        ("cuda:0", "NVIDIA ZLUDA"),
    ):
        assert not enable_experimental_tf32(device, name)
with patch.object(torch.cuda, "get_device_capability", return_value=(7, 5)):
    assert not enable_experimental_tf32("cuda:0", "NVIDIA")
assert torch.backends.cuda.matmul.allow_tf32 == original_tf32
assert enable_experimental_tf32("cuda:0", torch.cuda.get_device_name())
os.environ.pop("APPLIO_EXPERIMENTAL_TF32")
torch.backends.cuda.matmul.allow_tf32 = False
assert not enable_experimental_tf32("cuda:0", torch.cuda.get_device_name())
assert not torch.backends.cuda.matmul.allow_tf32

# An enabled environment flag must not select this experimental path on CPU/AMD.
os.environ["APPLIO_EXPERIMENTAL_HUBERT_FP16"] = "1"
for device, name in (("cpu", None), ("cuda:0", "AMD Radeon")):
    stub = SimpleNamespace(
        use_f0=False,
        version="v2",
        tgt_sr=40000,
        dtype=torch.float32,
        config=SimpleNamespace(device=device, gpu_name=name),
    )
    pipeline = Realtime_Pipeline(stub, None, None, None, "fcpe", 0)
    assert not pipeline.embedder_fp16

settings = load_config()["realtime"]
path = resolve_logs_path(settings["model_file"])
index = resolve_logs_path(settings["index_file"])
options = dict(index_rate=0.5, protect=0.33, volume_envelope=1)
t = np.arange(4800) / 48000
signal = (0.1 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)


def exercise(model):
    vc = VoiceChanger(
        block_frame=4800,
        cross_fade_overlap_size=0.05,
        extra_convert_size=2.5,
        model_path=model,
        index_path=index if model == path else "",
        f0_method="fcpe",
        embedder_model="contentvec",
        vad_enabled=False,
        silent_threshold=-80,
    )
    pipeline = vc.vc_model.pipeline
    assert pipeline.embedder_fp16
    for half, tf32 in ((False, False), (True, False), (False, True), (False, False)):
        previous = pipeline._graph_cache
        pipeline.embedder_fp16 = half
        torch.backends.cuda.matmul.allow_tf32 = tf32
        vc.warmup(**options)
        assert pipeline._graph_cache is not None
        assert (
            pipeline._graph_cache is not previous
        ), "Precision change must invalidate the inference graph"
        for _ in range(4):
            output, _, _ = vc.on_request(signal, **options)
            assert (
                output.shape == (4800,)
                and np.isfinite(output).all()
                and np.max(np.abs(output)) > 1e-6
            )
    print(
        f"v{pipeline.version[-1]} FP32/FP16/TF32/FP32 graph switching and finite audio passed.",
        flush=True,
    )


exercise(path)
# A derived v1 fixture validates final_proj's FP32 input and 256-channel synthesis.
# It is not used for audio quality claims and never overwrites the real model.
checkpoint = torch.load(path, map_location="cpu", weights_only=True)
if checkpoint.get("version") == "v2":
    checkpoint["version"] = "v1"
    checkpoint["weight"]["enc_p.emb_phone.weight"] = checkpoint["weight"][
        "enc_p.emb_phone.weight"
    ][:, :256].clone()
    fixture = ROOT / ".cache/realtime-v1-precision-fixture.pth"
    torch.save(checkpoint, fixture)
    exercise(str(fixture))
torch.backends.cuda.matmul.allow_tf32 = original_tf32
