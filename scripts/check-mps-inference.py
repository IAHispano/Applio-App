"""Check device isolation/fallback here; optionally run a real conversion on a Mac."""
import argparse
import os
from pathlib import Path
import runpy
import sys
from types import SimpleNamespace
from unittest.mock import patch

if sys.platform == "darwin":
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
    os.environ.setdefault("OMP_NUM_THREADS", "1")

import numpy as np
import torch

ROOT = Path(__file__).resolve().parent.parent
ENGINE = ROOT / "backend/applio"
sys.path.insert(0, str(ENGINE))
os.chdir(ROOT)

# Fresh config modules avoid the singleton retaining a previous test device.
for cuda, mps, expected in ((False, True, "mps"), (False, False, "cpu"), (True, True, "cuda:0")):
    with (
        patch.object(torch.cuda, "is_available", return_value=cuda),
        patch.object(torch.backends.mps, "is_available", return_value=mps),
        patch.object(torch.cuda, "get_device_name", return_value="Test NVIDIA GPU"),
        patch.object(torch.cuda, "get_device_properties", return_value=SimpleNamespace(total_memory=8 * 1024**3)),
    ):
        module = runpy.run_path(str(ENGINE / "rvc/configs/config.py"))
        shared = module["Config"]()
        inference = module["inference_config"]()
        assert inference.device == expected
        assert shared.device == expected, "All pipelines must select the available accelerator"
        inference.device = "cpu"
        assert module["Config"]() is shared

from rvc.infer.infer import VoiceConverter, _retry_mps_on_cpu
from rvc.infer.pipeline import Pipeline

for failure in (
    NotImplementedError("Operator is not implemented for the MPS backend"),
    RuntimeError("MPS backend out of memory"),
    TypeError("MPS does not support float64"),
):
    calls = []
    converter = SimpleNamespace(
        config=SimpleNamespace(device="mps", gpu_name="MPS"),
        hubert_model=torch.nn.Linear(2, 2),
        net_g=torch.nn.Linear(2, 2),
        setup_vc_instance=lambda: calls.append("reset"),
    )

    @_retry_mps_on_cpu
    def convert(self, value):
        calls.append(self.config.device)
        if self.config.device == "mps":
            raise failure
        return value

    assert convert(converter, "output") == "output"
    assert calls == ["mps", "reset", "cpu"]
    assert converter.net_g.weight.device.type == "cpu"
    assert converter.hubert_model.weight.device.type == "cpu"

# Unrelated failures and CPU retry failures must surface, never loop.
for device, error in (("mps", RuntimeError("Invalid checkpoint")), ("cpu", RuntimeError("MPS failure"))):
    converter.config.device = device
    @_retry_mps_on_cpu
    def fail(self):
        raise error
    try:
        fail(converter)
        raise AssertionError("Error was swallowed")
    except RuntimeError as caught:
        assert caught is error
converter.config.device = "mps"
calls = []
@_retry_mps_on_cpu
def fail_both(self):
    calls.append(self.config.device)
    raise RuntimeError("MPS failure")
try:
    fail_both(converter)
    raise AssertionError("Retry failure was swallowed")
except RuntimeError:
    assert calls == ["mps", "reset", "cpu"]

# Simulate Metal's double-transfer rejection against the actual index path.
pipeline = Pipeline.__new__(Pipeline)
pipeline.device = "mps"
index = SimpleNamespace(search=lambda values, k: (np.ones((2, k), dtype=np.float64), np.zeros((2, k), dtype=np.int64)))
original_to = torch.Tensor.to
transfers = []
def metal_transfer(tensor, device, *args, **kwargs):
    if device == "mps":
        assert tensor.dtype != torch.float64
        transfers.append(tensor.dtype)
        device = "cpu"
    return original_to(tensor, device, *args, **kwargs)
with patch.object(torch.Tensor, "to", metal_transfer):
    features = pipeline._retrieve_speaker_embeddings(torch.ones(1, 2, 3), index, np.ones((1, 3), dtype=np.float64), 0.5)
assert transfers == [torch.float32] and torch.isfinite(features).all()

# Run actual predictor dispatch and postprocessing using a deterministic F0 fixture.
pitch_devices = []
class PitchFixture:
    def __init__(self, device, **kwargs):
        pitch_devices.append(device)
    def get_f0(self, audio, **kwargs):
        return np.full(100, 220.0, dtype=np.float32)
pipeline.sample_rate, pipeline.window, pipeline.time_step = 16000, 160, 10
pipeline.f0_min, pipeline.f0_max, pipeline.f0_models = 50, 1100, {}
pipeline.f0_mel_min = 1127 * np.log(1 + pipeline.f0_min / 700)
pipeline.f0_mel_max = 1127 * np.log(1 + pipeline.f0_max / 700)
with patch("rvc.infer.pipeline.RMVPE", PitchFixture):
    coarse, fine = pipeline.get_f0(np.ones(16000), 100, "rmvpe")
assert pitch_devices == ["mps"] and np.isfinite(fine).all()
print("MPS selection, session isolation, FP32 retrieval, MPS pitch dispatch and bounded CPU retry passed.")

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--model", help="Optional real RVC checkpoint for a hardware smoke test")
parser.add_argument("--audio", help="Input recording for the hardware smoke test")
parser.add_argument("--index", default="")
parser.add_argument("--output", default=str(ROOT / ".cache/mps-inference-smoke.wav"))
args = parser.parse_args()
if args.model:
    if not args.audio:
        parser.error("--audio is required with --model")
    if not torch.backends.mps.is_available():
        parser.error("The hardware smoke test requires an MPS-capable Mac")
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    vc = VoiceConverter()
    assert vc.config.device == "mps"
    vc.convert_audio(args.audio, args.output, args.model, args.index, index_rate=0.75 if args.index else 0)
    import soundfile as sf
    audio, rate = sf.read(args.output)
    assert audio.size and np.isfinite(audio).all() and np.max(np.abs(audio)) > 0
    assert vc.config.device == "mps", "Conversion succeeded only after falling back to CPU"
    print(f"Real MPS conversion passed: {rate} Hz, {audio.size} samples, {args.output}")
