"""Check Metal adaptations on CPU; --hardware requires a real Mac accelerator."""

import argparse, os, sys
from pathlib import Path
from unittest.mock import patch
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT / "backend/applio"))
from rvc.train.mel_processing import spectrogram_torch, MultiScaleMelSpectrogramLoss
from rvc.lib.tools.device import CPUSpectralTransform
from rvc.realtime.core import phase_vocoder, VoiceChanger
from rvc.lib.predictors.f0 import FCPE, RMVPE

parser = argparse.ArgumentParser()
parser.add_argument("--hardware", action="store_true")
parser.add_argument("--model", default=str(ROOT / "logs/Messi/Messi.pth"))
args = parser.parse_args()


# Exercise the actual CPU spectral branch with a tensor subclass; this checks
# routing and autograd, not Metal kernels or hardware performance.
class MetalFixture(torch.Tensor):
    @property
    def device(self):
        return torch.device("mps")

    def cpu(self):
        return self.as_subclass(torch.Tensor)


original_to = torch.Tensor.to


def simulate_transfer(tensor, *pos, **kwargs):
    if pos and str(pos[0]) == "mps":
        pos = ("cpu", *pos[1:])
    if str(kwargs.get("device")) == "mps":
        kwargs["device"] = "cpu"
    return original_to(tensor, *pos, **kwargs)


base = torch.randn(1, 4096, requires_grad=True)
metal = base.as_subclass(MetalFixture)
with patch.object(torch.Tensor, "to", simulate_transfer):
    spectrum = spectrogram_torch(metal, 512, 128, 512)
    expected = spectrogram_torch(base, 512, 128, 512)
    torch.testing.assert_close(spectrum, expected)
    spectrum.mean().backward()
    assert base.grad is not None and torch.isfinite(base.grad).all()
    loss_fn = MultiScaleMelSpectrogramLoss(n_mels=[20], window_lengths=[512])
    predicted = torch.randn(1, 1, 4096, requires_grad=True)
    loss = loss_fn.mel_spectrogram(predicted.as_subclass(MetalFixture), 20, 512).mean()
    loss.backward()
    assert predicted.grad is not None and torch.isfinite(predicted.grad).all()
    a = torch.randn(128)
    b = torch.randn(128)
    fade = torch.linspace(0, 1, 128)
    torch.testing.assert_close(
        phase_vocoder(a.as_subclass(MetalFixture), b, 1 - fade, fade),
        phase_vocoder(a, b, 1 - fade, fade),
    )

# Verify real predictor frontends numerically; no Metal hardware is impersonated.
for predictor in [FCPE("cpu"), RMVPE("cpu", high_register={"enabled": False})]:
    frontend = (
        predictor.model.wav2mel.mel_extractor
        if isinstance(predictor, FCPE)
        else predictor.model.mel_extractor
    )
    wave = torch.randn(1, 16000) * 0.01
    with torch.no_grad():
        torch.testing.assert_close(CPUSpectralTransform(frontend)(wave), frontend(wave))
print(
    "MPS spectral routing, differentiable training losses, crossfade and predictor parity passed on CPU."
)

if args.hardware:
    if not torch.backends.mps.is_available():
        parser.error("--hardware requires an MPS-capable Mac")
    # Actual accelerators, gradients and a complete realtime block on hardware.
    for predictor in [FCPE("mps"), RMVPE("mps", high_register={"enabled": False})]:
        f0 = predictor.get_f0(
            np.sin(np.arange(16000, dtype=np.float32) * 2 * np.pi * 220 / 16000) * 0.1
        )
        assert np.isfinite(f0).all()
    audio = torch.randn(1, 4096, device="mps", requires_grad=True)
    spectrogram_torch(audio, 512, 128, 512).mean().backward()
    assert torch.isfinite(audio.grad).all()
    voice = VoiceChanger(
        block_frame=4800,
        cross_fade_overlap_size=0.04,
        extra_convert_size=1.0,
        model_path=args.model,
        f0_method="fcpe",
        silent_threshold=-90,
        embedder_model="contentvec",
    )
    assert voice.device == "mps"
    voice.warmup()
    result, _ = voice.process_audio(
        np.sin(np.arange(4800, dtype=np.float32) * 2 * np.pi * 220 / 48000) * 0.1
    )
    assert result.size == 4800 and np.isfinite(result).all()
    print("Actual MPS pitch networks, gradient loss and realtime conversion passed.")
