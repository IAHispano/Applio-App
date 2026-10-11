"""Export and compare matched HiFi-GAN NSF decoder inputs. No user settings changed."""

import argparse, json, os, sys, time
from pathlib import Path
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT / "backend/applio")
sys.path.insert(0, str(Path.cwd()))
from rvc.realtime.pipeline import RealtimeVoiceConverter
from rvc.realtime.onnx_decoder import export_decoder, OnnxDecoder

parser = argparse.ArgumentParser()
parser.add_argument("--model", default=str(ROOT / "logs/Messi/Messi.pth"))
parser.add_argument(
    "--output", type=Path, default=ROOT / ".cache/onnx-decoder/Messi.decoder.onnx"
)
parser.add_argument("--iterations", type=int, default=40)
parser.add_argument("--provider", choices=("cpu", "cuda"), default="cpu")
parser.add_argument("--precision", choices=("float32", "float16"), default="float32")
args = parser.parse_args()
os.environ.pop("APPLIO_EXPERIMENTAL_ONNX_DECODER", None)
torch.set_num_threads(2)
converter = RealtimeVoiceConverter(args.model, device="cpu")
if args.precision == "float16" and args.provider != "cuda":
    parser.error("float16 export requires --provider cuda for validation")
graph, manifest = export_decoder(
    converter.net_g.dec, args.model, args.output, args.precision
)
import onnxruntime as ort

providers = ["CPUExecutionProvider"]
if args.provider == "cuda":
    if "CUDAExecutionProvider" not in ort.get_available_providers():
        raise SystemExit("Install an isolated ONNX Runtime GPU environment first")
    if hasattr(ort, "preload_dlls"):
        ort.preload_dlls(directory=str(Path(torch.__file__).parent / "lib"))
    providers.insert(0, ("CUDAExecutionProvider", {"use_tf32": "0"}))

options = ort.SessionOptions()
options.intra_op_num_threads = 2
options.add_session_config_entry("session.intra_op.allow_spinning", "0")
session = ort.InferenceSession(
    str(args.output), sess_options=options, providers=providers
)
assert session.get_providers()[0] == (
    "CUDAExecutionProvider" if args.provider == "cuda" else "CPUExecutionProvider"
), "Requested provider did not load"
results = []
for frames in [6, 10, 20]:
    torch.manual_seed(42)
    inputs = (
        torch.randn(1, manifest["latent_channels"], frames),
        torch.randn(1, 1, frames * manifest["upsample_factor"]) * 0.01,
        torch.randn(1, manifest["speaker_channels"], 1),
    )
    feed = dict(
        zip(
            ["latent", "source", "speaker"],
            [
                x.numpy().astype(
                    np.float16 if args.precision == "float16" else np.float32
                )
                for x in inputs
            ],
        )
    )
    with torch.inference_mode():
        if args.precision == "float16":
            graph.cuda()
            with torch.autocast("cuda", dtype=torch.float16):
                expected = graph(*(x.cuda() for x in inputs)).cpu().numpy()
            graph.cpu()
        else:
            expected = graph(*inputs).numpy()
        actual = session.run(["audio"], feed)[0]
        assert actual.shape == expected.shape and np.isfinite(actual).all()
        np.testing.assert_allclose(
            actual,
            expected,
            atol=2e-3 if args.precision == "float16" else 2e-5,
            rtol=2e-3 if args.precision == "float16" else 2e-4,
        )
        row = {
            "frames": frames,
            "max_absolute_error": float(np.max(np.abs(actual - expected))),
        }
        for name, call in [
            ("torch_cpu", lambda: graph(*inputs)),
            ("onnx_" + args.provider, lambda: session.run(["audio"], feed)),
        ]:
            for _ in range(5):
                call()
            times = []
            for _ in range(args.iterations):
                begin = time.perf_counter()
                call()
                times.append((time.perf_counter() - begin) * 1000)
            row[name + "_median_ms"] = float(np.median(times))
        if torch.cuda.is_available():
            graph.cuda()
            gpu_inputs = tuple(x.cuda() for x in inputs)
            for half in [False, True]:

                def gpu_call():
                    with torch.autocast("cuda", dtype=torch.float16, enabled=half):
                        return graph(*gpu_inputs)

                for _ in range(5):
                    gpu_call()
                times = []
                for _ in range(args.iterations):
                    torch.cuda.synchronize()
                    begin = time.perf_counter()
                    gpu_call()
                    torch.cuda.synchronize()
                    times.append((time.perf_counter() - begin) * 1000)
                row["torch_cuda_" + ("fp16" if half else "fp32") + "_median_ms"] = (
                    float(np.median(times))
                )
            graph.cpu()
        results.append(row)
        print(json.dumps(row), flush=True)

# Exercise the actual adapter, including Torch excitation, manifest validation and transfer.
adapter_device = "cuda:0" if args.provider == "cuda" else "cpu"
converter.net_g.dec.to(adapter_device)
adapter = OnnxDecoder(converter.net_g.dec, args.model, args.output, adapter_device)
torch.manual_seed(7)
latent = torch.randn(1, manifest["latent_channels"], 10, device=adapter_device)
f0 = torch.full((1, 10), 220.0, device=adapter_device)
speaker = torch.randn(1, manifest["speaker_channels"], 1, device=adapter_device)
with torch.inference_mode():
    previous_conv_tf32 = torch.backends.cudnn.allow_tf32
    # Strict parity compares the same convolution precision; Torch and ORT
    # otherwise have different default TF32 policies on this host.
    torch.backends.cudnn.allow_tf32 = False
    torch.manual_seed(9)
    with torch.autocast(
        adapter_device.split(":")[0],
        dtype=torch.float16,
        enabled=args.precision == "float16",
    ):
        expected = converter.net_g.dec(latent, f0, g=speaker)
    torch.manual_seed(9)
    actual = adapter(latent, f0, g=speaker)
    torch.backends.cudnn.allow_tf32 = previous_conv_tf32
np.testing.assert_allclose(
    actual.cpu().numpy(),
    expected.cpu().numpy(),
    atol=2e-3 if args.precision == "float16" else 2e-5,
    rtol=2e-3 if args.precision == "float16" else 2e-4,
)
report = {
    "model": args.model,
    "torch": torch.__version__,
    "onnxruntime": ort.__version__,
    "providers": session.get_providers(),
    "iterations": args.iterations,
    "results": results,
    "scope": "decoder only; source/pitch/embedder/flow excluded; ORT session.run includes host input/output copies",
}
args.output.with_suffix(".benchmark.json").write_text(json.dumps(report, indent=2))
print("Dynamic-shape parity and actual decoder adapter passed.")
