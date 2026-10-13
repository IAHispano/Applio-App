"""Compare the pinned and optimized pipelines with local model weights.

Uses synthetic harmonics, the real embedder/F0/voice model, matching RNG seeds
and synchronized GPU timings. No user recordings or model files are modified.
"""

import argparse
import json
from pathlib import Path
import statistics
import sys
import time

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT / "backend" / "applio"), str(ROOT)]
from rvc.infer.infer import VoiceConverter
from rvc.infer.pipeline import Pipeline
from tools.optimized_inference import OptimizedPipeline


def harmonics(seconds):
    t = np.arange(round(seconds * 16000), dtype=np.float64) / 16000
    phase = 2 * np.pi * (190 * t + 5 * np.sin(2 * np.pi * t))
    envelope = 0.6 + 0.4 * np.sin(2 * np.pi * 1.5 * t) ** 2
    return (
        envelope
        * (0.12 * np.sin(phase) + 0.04 * np.sin(2 * phase) + 0.02 * np.sin(3 * phase))
    ).astype(np.float32)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--index", default="")
    parser.add_argument("--seconds", type=float, default=4)
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--f0-method", default="rmvpe")
    parser.add_argument("--device", default="auto")
    parser.add_argument("--report")
    args = parser.parse_args()
    if args.runs < 2 or args.seconds < 1:
        parser.error("Use at least two runs and one second of input")

    converter = VoiceConverter()
    if args.device != "auto":
        converter.config.device = args.device
    converter.get_vc(str(Path(args.model).resolve()), 0, "torch")
    converter.load_hubert("contentvec")
    optimized_converter = VoiceConverter(config=converter.config)
    optimized_converter.get_vc(str(Path(args.model).resolve()), 0, "torch")
    original = Pipeline(converter.tgt_sr, converter.config)
    optimized = OptimizedPipeline(converter.tgt_sr, converter.config)
    # Share predictor instances after the first warmup, avoiding duplicate VRAM.
    optimized.f0_models = original.f0_models
    device = converter.config.device

    def synchronize():
        if str(device).startswith("cuda"):
            torch.cuda.synchronize(device)
        elif device == "mps":
            torch.mps.synchronize()

    def convert(pipeline, chunks, autotune):
        torch.manual_seed(12345)
        synchronize()
        start = time.perf_counter()
        output = [
            pipeline.pipeline(
                model=converter.hubert_model,
                net_g=(
                    optimized_converter.net_g
                    if pipeline is optimized
                    else converter.net_g
                ),
                sid=0,
                audio=chunk,
                pitch=0,
                f0_method=args.f0_method,
                file_index=str(Path(args.index).resolve()) if args.index else "",
                index_rate=0.75 if args.index else 0,
                pitch_guidance=converter.use_f0,
                volume_envelope=1,
                version=converter.version,
                protect=0.5,
                f0_autotune=autotune,
                f0_autotune_strength=1,
                proposed_pitch=False,
                proposed_pitch_threshold=155,
            )
            for chunk in chunks
        ]
        synchronize()
        return (time.perf_counter() - start) * 1000, np.concatenate(output)

    cases = [
        ("recording", [harmonics(args.seconds)], False),
        ("split recording (6 chunks)", [harmonics(1.2)] * 6, False),
        ("autotuned recording", [harmonics(args.seconds)], True),
    ]
    results = []
    for name, chunks, autotune in cases:
        # CUDA convolution can vary even between identically seeded baseline
        # runs. Check parity deterministically, then time with ordinary flags.
        deterministic = torch.backends.cudnn.deterministic
        benchmark = torch.backends.cudnn.benchmark
        try:
            torch.backends.cudnn.deterministic = True
            torch.backends.cudnn.benchmark = False
            _, reference = convert(original, chunks, autotune)
            _, actual = convert(optimized, chunks, autotune)
            np.testing.assert_allclose(actual, reference, rtol=1e-5, atol=1e-6)
            parity_difference = float(np.max(np.abs(actual - reference)))
        finally:
            torch.backends.cudnn.deterministic = deterministic
            torch.backends.cudnn.benchmark = benchmark
        for pipeline in (original, optimized):
            for _ in range(2):
                convert(pipeline, chunks, autotune)
        times = {"original": [], "optimized": []}
        # Alternate order to reduce clock/temperature bias.
        for run in range(args.runs):
            pairs = [("original", original), ("optimized", optimized)]
            if run % 2:
                pairs.reverse()
            for label, pipeline in pairs:
                elapsed, _ = convert(pipeline, chunks, autotune)
                times[label].append(elapsed)
        before, after = statistics.median(times["original"]), statistics.median(
            times["optimized"]
        )
        result = {
            "case": name,
            "original_ms": round(before, 2),
            "optimized_ms": round(after, 2),
            "faster_percent": round(100 * (before - after) / before, 1),
            "max_abs_output_difference": parity_difference,
            "runs_ms": times,
        }
        results.append(result)
        print(json.dumps(result), flush=True)
    report = {
        "device": str(device),
        "hardware": (
            torch.cuda.get_device_name(device)
            if str(device).startswith("cuda")
            else str(device)
        ),
        "torch": torch.__version__,
        "seconds": args.seconds,
        "runs": args.runs,
        "f0_method": args.f0_method,
        "synthetic_input": True,
        "startup_excluded": True,
        "parity_uses_deterministic_cudnn": True,
        "results": results,
    }
    if args.report:
        Path(args.report).write_text(json.dumps(report, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
