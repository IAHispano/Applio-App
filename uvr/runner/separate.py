#!/usr/bin/env python3
"""Applio UVR runner — stem separation using the vendored audio-separator engine.

Thin wrapper around ``audio_separator.separator.Separator`` (vendored under
``uvr/audio_separator``). Prints progress to stderr (captured into the job log)
and a single ``APPLIO_JSON:{...}`` line to stdout on success:

    {"outputs": ["/abs/path/to/song_(Vocals)_MODEL.wav", ...]}

With ``--list-models`` it prints the simplified model registry instead:

    {"models": [{"filename": ..., "name": ..., "type": ..., "stems": [...], "target_stem": ...}]}
"""

import argparse
import json
import logging
import os
import sys

# Make the vendored ``audio_separator`` package importable no matter where the
# interpreter was launched from (``uvr/`` itself is intentionally not a package).
UVR_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if UVR_DIR not in sys.path:
    sys.path.insert(0, UVR_DIR)

from audio_separator.separator import Separator  # noqa: E402


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Separate audio stems (vocals / instrumental / more).")
    p.add_argument("--input", required=True, help="Audio file to separate.")
    p.add_argument("--model", required=True, help="Model filename, e.g. UVR-MDX-NET-Voc_FT.onnx")
    p.add_argument("--output-dir", required=True, help="Directory for separated stems.")
    p.add_argument("--model-dir", required=True, help="Directory for downloaded model weights.")
    p.add_argument("--output-format", default="WAV", choices=["WAV", "MP3", "FLAC"])
    p.add_argument("--single-stem", default=None, help="Only output this stem, e.g. Vocals or Instrumental.")
    p.add_argument("--vr-aggression", type=int, default=5, help="VR architecture aggression (higher = stronger separation).")
    p.add_argument("--vr-window", type=int, default=512, help="VR architecture window size.")
    p.add_argument("--vr-batch", type=int, default=1, help="VR architecture batch size.")
    p.add_argument("--mdx-segment", type=int, default=256, help="MDX architecture segment size.")
    p.add_argument("--mdx-overlap", type=float, default=0.25, help="MDX architecture overlap ratio.")
    p.add_argument("--mdx-batch", type=int, default=1, help="MDX architecture batch size.")
    p.add_argument(
        "--list-models",
        action="store_true",
        help="Print the simplified model registry as JSON and exit (no separation).",
    )
    return p


def list_models(args) -> int:
    sep = Separator(
        log_level=logging.ERROR,
        model_file_dir=args.model_dir,
        output_dir=args.output_dir,
        info_only=True,
    )
    simplified = sep.get_simplified_model_list()

    def stem_token(entry: str) -> str:
        # Entries look like "Vocals", "Vocals* (10.6)" ("*" marks the target stem).
        return entry.split(" (")[0]

    models = [
        {
            "filename": filename,
            "name": data.get("Name", filename),
            "type": data.get("Type", "Unknown"),
            "stems": [stem_token(s).rstrip("*") for s in (data.get("Stems") or [])],
            "target_stem": next(
                (stem_token(s).rstrip("*") for s in (data.get("Stems") or []) if "*" in stem_token(s)),
                None,
            ),
        }
        for filename, data in simplified.items()
    ]
    models.sort(key=lambda m: (m["type"], m["name"]))
    print("APPLIO_JSON:" + json.dumps({"models": models}))
    return 0


def separate(args) -> int:
    if not os.path.isfile(args.input):
        print(f"Input file not found: {args.input}", file=sys.stderr)
        return 2

    sep = Separator(
        log_level=logging.INFO,
        model_file_dir=args.model_dir,
        output_dir=args.output_dir,
        output_format=args.output_format,
        output_single_stem=args.single_stem,
        vr_params={
            "batch_size": args.vr_batch,
            "window_size": args.vr_window,
            "aggression": args.vr_aggression,
            "enable_tta": False,
            "enable_post_process": False,
            "post_process_threshold": 0.2,
            "high_end_process": False,
        },
        mdx_params={
            "hop_length": 1024,
            "segment_size": args.mdx_segment,
            "overlap": args.mdx_overlap,
            "batch_size": args.mdx_batch,
            "enable_denoise": False,
        },
    )
    sep.load_model(args.model)
    outputs = sep.separate(args.input)
    # The engine returns paths relative to CWD; anchor them at the output dir.
    abs_outputs = [
        o if os.path.isabs(o) else os.path.join(args.output_dir, o) for o in outputs
    ]
    missing = [o for o in abs_outputs if not os.path.isfile(o)]
    if missing:
        print(f"Expected output files missing: {missing}", file=sys.stderr)
        return 3
    print("APPLIO_JSON:" + json.dumps({"outputs": abs_outputs}))
    return 0


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)
    os.makedirs(args.output_dir, exist_ok=True)
    os.makedirs(args.model_dir, exist_ok=True)
    if args.list_models:
        return list_models(args)
    return separate(args)


if __name__ == "__main__":
    sys.exit(main())
