"""Exercise an exported decoder inside the complete CPU realtime path."""

import argparse, json, os, sys, tempfile
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
sys.path.insert(0, str(ROOT / "backend/applio"))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--provider", choices=("cpu", "cuda"), default="cpu")
parser.add_argument("--model", type=Path, default=ROOT / "logs/Messi/Messi.pth")
parser.add_argument(
    "--decoder", type=Path, default=ROOT / ".cache/onnx-decoder/Messi.decoder.onnx"
)
args = parser.parse_args()
path = args.decoder.resolve()
os.environ["APPLIO_EXPERIMENTAL_ONNX_DECODER"] = str(path)
if args.provider == "cuda":
    os.environ["APPLIO_ENABLE_CUDA_GRAPHS"] = "1"
from rvc.realtime.core import VoiceChanger
from rvc.realtime.onnx_decoder import OnnxDecoder

voice = VoiceChanger(
    block_frame=4800,
    cross_fade_overlap_size=0.04,
    extra_convert_size=1.0,
    model_path=str(args.model.resolve()),
    f0_method="fcpe",
    embedder_model="contentvec",
    silent_threshold=-90,
    device="cuda:0" if args.provider == "cuda" else "cpu",
)
assert (
    voice.vc_model.pipeline.vc.onnx_decoder
    and voice.vc_model.pipeline._graph_supported == (args.provider == "cuda")
)
voice.warmup()
for i in range(3):
    audio = (
        np.sin((np.arange(4800, dtype=np.float32) + i * 4800) * 2 * np.pi * 220 / 48000)
        * 0.1
    )
    output, volume = voice.process_audio(audio, index_rate=0)
    assert output.shape == (4800,) and np.isfinite(output).all()
assert np.max(np.abs(output)) > 0

if args.provider == "cuda":
    import torch
    from rvc.realtime.pipeline import RealtimeVoiceConverter
    from rvc.realtime.onnx_decoder import DecoderGraph

    os.environ.pop("APPLIO_EXPERIMENTAL_ONNX_DECODER", None)
    original = RealtimeVoiceConverter(
        str(args.model.resolve()), device="cuda:0"
    )
    decoder = voice.vc_model.pipeline.vc.net_g.dec
    graph = DecoderGraph(original.net_g.dec)
    torch.backends.cudnn.allow_tf32 = False
    saved = None
    with torch.inference_mode(), torch.cuda.stream(torch.cuda.Stream()):
        for frames in (6, 10, 20, 12, 14, 6):
            latent = torch.randn(
                1, original.net_g.dec.conv_pre.in_channels, frames, device="cuda:0"
            )
            source = torch.randn(1, 1, frames * decoder.upp, device="cuda:0") * 0.01
            speaker = torch.randn(
                1, original.net_g.dec.cond.in_channels, 1, device="cuda:0"
            )
            with torch.autocast(
                "cuda", dtype=torch.float16, enabled=decoder.precision == "float16"
            ):
                values = (latent, source, speaker)
                if decoder.precision == "float16":
                    values = tuple(value.half() for value in values)
                expected = graph(*values).float()
            actual = decoder.run_decoder(latent, source, speaker)
            torch.testing.assert_close(
                actual,
                expected,
                atol=2e-3 if decoder.precision == "float16" else 2e-5,
                rtol=2e-3 if decoder.precision == "float16" else 2e-4,
            )
            if saved is not None:
                assert torch.equal(
                    saved[0], saved[1]
                ), "later replay mutated returned audio"
            saved = actual, actual.clone()
            assert len(decoder._cuda_buffers) <= 4
    print(
        "CUDA dynamic shapes, capture-cache bound, independent output, alternate stream and decoder parity passed."
    )

with tempfile.TemporaryDirectory(prefix="onnx-manifest-") as folder:
    invalid = Path(folder) / "invalid.onnx"
    invalid.write_bytes(b"invalid cache")
    invalid.with_suffix(".onnx.json").write_text(
        json.dumps({"schema": 1, "checkpoint_sha256": "incorrect"})
    )
    try:
        OnnxDecoder(None, str(args.model.resolve()), invalid, "cpu")
    except ValueError as error:
        assert "does not match" in str(error)
    else:
        raise AssertionError("Mismatched model cache was accepted")
print(
    "Full realtime ONNX warmup, three finite/nonzero audio blocks, capture policy and stale-cache rejection passed."
)
