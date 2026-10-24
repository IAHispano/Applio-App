"""Run prerequisite downloads with bounded concurrency and connection retries."""

import argparse
from concurrent.futures import ThreadPoolExecutor
from functools import partial
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description="Applio Prerequisites Downloader")
    parser.add_argument("--pretraineds-hifigan", action="store_true")
    parser.add_argument("--models", action="store_true")
    parser.add_argument("--exe", action="store_true")
    parser.add_argument("--vocoder", choices=["HiFi-GAN", "RefineGAN"])
    parser.add_argument("--sample-rate", type=int)
    args = parser.parse_args()
    if args.vocoder and not args.sample_rate:
        parser.error("--sample-rate is required with --vocoder")

    root = Path(__file__).resolve().parents[3]
    backend = Path(os.environ.get("APPLIO_BACKEND_ROOT") or root / "backend/applio")
    sys.path.insert(0, str(backend))
    from rvc.lib.tools import prerequisites_download as downloader

    # Avoid starting every large transfer at once on limited connections.
    # Keep upstream's validators, partial files and atomic publication intact.
    downloader.ThreadPoolExecutor = partial(ThreadPoolExecutor, max_workers=4)
    downloader.download_http = partial(downloader.download_http, retries=5)
    if args.vocoder:
        downloader.ensure_pretrained(args.vocoder, args.sample_rate)
    else:
        downloader.prequisites_download_pipeline(
            args.pretraineds_hifigan, args.models, args.exe
        )
    print("Prerequisites installed successfully.", flush=True)


if __name__ == "__main__":
    main()
