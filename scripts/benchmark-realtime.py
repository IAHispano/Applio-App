"""Benchmark decoder FP16 using saved realtime settings and synthetic voiced input."""
import argparse
import json
import os
from pathlib import Path
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "applio"))
os.chdir(ROOT)
os.environ.setdefault("APPLIO_ROOT", str(ROOT))
os.environ.setdefault("APPLIO_CODE_ROOT", str(ROOT))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--blocks", type=int, default=100, help="Measured blocks per round (four rounds)")
parser.add_argument("--eager", action="store_true", help="Disable the service's CUDA graph optimization")
parser.add_argument("--output", type=Path, default=ROOT / ".cache" / "fp16-benchmark")
args = parser.parse_args()
if args.blocks < 10:
    parser.error("Use at least 10 blocks")
os.environ["APPLIO_ENABLE_CUDA_GRAPHS"] = "0" if args.eager else "1"

import numpy as np
import soundfile as sf
import torch
from rvc.lib.user_config import load_config, resolve_logs_path
from rvc.realtime.core import VoiceChanger
from rvc.realtime.utils.chunks import automatic_block_frame

settings = load_config().get("realtime", {})
model = resolve_logs_path(settings.get("model_file", ""))
index = resolve_logs_path(settings.get("index_file", "")) or ""
if not model or not Path(model).is_file():
    parser.error("Select an existing realtime model first")
if not torch.cuda.is_available():
    parser.error("Decoder FP16 requires CUDA")
block = 4800 if settings.get("auto_chunk", True) else round(settings.get("chunk_ms", 100) * 48)
vc = VoiceChanger(
    block_frame=block,
    cross_fade_overlap_size=settings.get("cross_fade_overlap_size", .05),
    extra_convert_size=settings.get("extra_convert_size", 2.5),
    model_path=model, index_path=index,
    f0_method=settings.get("f0_method", "fcpe"),
    embedder_model=settings.get("embedder_model", "contentvec"),
    embedder_model_custom=settings.get("embedder_model_custom", ""),
    silent_threshold=settings.get("silent_threshold", -60),
    vad_enabled=settings.get("vad_enabled", True), sid=settings.get("sid", 0),
    clean_audio=settings.get("clean_audio", False), clean_strength=settings.get("clean_strength", .5),
    post_process=settings.get("post_process", False), **{
        k: v for k, v in settings.items() if k.startswith(("reverb", "chorus", "limiter", "gain", "distortion", "delay", "compressor", "clipping", "bitcrush", "pitch_shift"))
    },
)
voice = vc.vc_model.pipeline.vc
if voice.vocoder not in ("HiFi-GAN", "MRF HiFi-GAN"):
    parser.error(f"FP16 switch does not target {voice.vocoder}")
options = dict(
    f0_up_key=settings.get("pitch", 0), index_rate=settings.get("index_rate", 0),
    protect=settings.get("protect", .5), volume_envelope=settings.get("volume_envelope", 1),
    f0_autotune=settings.get("autotune", False), f0_autotune_strength=settings.get("autotune_strength", 1),
    proposed_pitch=settings.get("proposed_pitch", False),
    proposed_pitch_threshold=settings.get("proposed_pitch_threshold", 155),
)
warmup = {}
for half in (False, True):
    voice.decoder_fp16 = half
    warmup[str(half)] = vc.warmup(**options)
# Hold the chunk size equal across precisions for a fair comparison.
if settings.get("auto_chunk", True):
    block = max(block, automatic_block_frame(max(warmup.values())))
    if block != vc.block_frame:
        vc.block_frame = block
        vc.vc_model.realloc(block, vc.extra_frame, vc.crossfade_frame, vc.sola_search_frame)
        vc.generate_strength()


def summarize(values):
    return {"mean_ms": float(np.mean(values)), "median_ms": float(np.median(values)),
            "p95_ms": float(np.percentile(values, 95)), "min_ms": float(np.min(values)),
            "max_ms": float(np.max(values)), "samples": len(values)}


# Continuous, varying harmonic input prevents silence bypasses and exercises pitch.
t = np.arange(block * (args.blocks + 40), dtype=np.float64) / 48000
phase = 2 * np.pi * (180 * t + 20 / (2 * np.pi * .7) * (1 - np.cos(2 * np.pi * .7 * t)))
signal = ((.07 + .01 * np.sin(2 * np.pi * 1.3 * t)) *
          (np.sin(phase) + .4 * np.sin(2 * phase) + .15 * np.sin(3 * phase))).astype(np.float32)
signal *= settings.get("input_audio_gain", 100) / 100
blocks = signal.reshape(-1, block)
timings = {False: [], True: []}
rounds = []
with torch.inference_mode():
    for round_number, half in enumerate((False, True, True, False)):
        voice.decoder_fp16 = half
        vc.warmup(**options)
        for audio in blocks[:40]:
            vc.on_request(audio, **options)
        measured = []
        for audio in blocks[40:]:
            torch.cuda.synchronize()
            start = time.perf_counter()
            output, _, _ = vc.on_request(audio, **options)
            torch.cuda.synchronize()
            measured.append((time.perf_counter() - start) * 1000)
            assert output.shape == (block,) and np.isfinite(output).all()
            assert np.max(np.abs(output)) > 1e-6, "Input was gated; timing would be invalid"
        timings[half].extend(measured)
        rounds.append({"fp16": half,
                       "graph_active": vc.vc_model.pipeline._graph_cache is not None,
                       **summarize(measured)})
        print(f"Round {round_number + 1}: FP16={half}, median={np.median(measured):.2f} ms, p95={np.percentile(measured, 95):.2f} ms", flush=True)

    # Capture real decoder tensors via one eager conversion, without changing the
    # graph implementation or the model. Standalone decoder timing uses events.
    pipeline = vc.vc_model.pipeline
    pipeline._graph_supported = False
    captured = {}
    def capture(module, inputs, kwargs):
        captured["inputs"] = tuple(x.detach().clone() if torch.is_tensor(x) else x for x in inputs)
        captured["kwargs"] = {k: v.detach().clone() if torch.is_tensor(v) else v for k, v in kwargs.items()}
    hook = voice.net_g.dec.register_forward_pre_hook(capture, with_kwargs=True)
    vc.on_request(blocks[-1], **options)
    hook.remove()
    assert captured, "Decoder was bypassed"
    decoder_timings = {False: [], True: []}
    outputs = {}
    for half in (False, True, True, False):
        with torch.autocast("cuda", dtype=torch.float16, enabled=half):
            for _ in range(20):
                voice.net_g.dec(*captured["inputs"], **captured["kwargs"])
            torch.cuda.synchronize()
            for _ in range(args.blocks):
                start, end = torch.cuda.Event(enable_timing=True), torch.cuda.Event(enable_timing=True)
                start.record()
                decoded = voice.net_g.dec(*captured["inputs"], **captured["kwargs"])
                end.record()
                end.synchronize()
                decoder_timings[half].append(start.elapsed_time(end))
            torch.manual_seed(12345)
            decoded = voice.net_g.dec(*captured["inputs"], **captured["kwargs"])
            outputs[half] = decoded.float().cpu().numpy().ravel()
            assert np.isfinite(outputs[half]).all()

baseline, mixed = outputs[False], outputs[True]
difference = baseline - mixed
snr = 10 * np.log10(np.mean(baseline ** 2) / max(float(np.mean(difference ** 2)), 1e-30))
result = {
    "gpu": torch.cuda.get_device_name(), "torch": torch.__version__, "cuda": torch.version.cuda,
    "cuda_graphs": not args.eager, "input": "Synthetic continuous varying voiced harmonics; no microphone capture",
    "settings": settings, "effective_chunk_ms": block / 48, "model": model, "index": index,
    "vocoder": voice.vocoder, "sample_rate": voice.tgt_sr,
    "full_block": {"fp32": summarize(timings[False]), "fp16": summarize(timings[True])},
    "decoder_eager": {"fp32": summarize(decoder_timings[False]), "fp16": summarize(decoder_timings[True])},
    "rounds": rounds,
    "same_input_decoder_difference": {"snr_db": float(snr), "rms_error": float(np.sqrt(np.mean(difference ** 2))),
                                      "max_error": float(np.max(np.abs(difference))),
                                      "correlation": float(np.corrcoef(baseline, mixed)[0, 1])},
    "limitations": "GPU processing only; device/browser/cable latency excluded. Numerical comparison cannot establish perceptual quality.",
}
args.output.mkdir(parents=True, exist_ok=True)
(args.output / "results.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
for half in (False, True):
    sf.write(args.output / ("decoder-fp16.wav" if half else "decoder-fp32.wav"), outputs[half], voice.tgt_sr, subtype="FLOAT")
print(json.dumps({key: result[key] for key in ("gpu", "effective_chunk_ms", "full_block", "decoder_eager", "same_input_decoder_difference")}, indent=2), flush=True)
print(f"Results: {args.output / 'results.json'}", flush=True)
