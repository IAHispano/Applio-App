#!/usr/bin/env python3
"""Applio YouTube audio downloader — fetch a track as a local audio file.

Uses yt_dlp (Python API) with FFmpeg extraction. Progress goes to stderr
(captured into the job log); a single ``APPLIO_JSON:{...}`` line goes to
stdout on success:

    {"file": "/abs/path/to/Title-[id].wav", "title": "...", "duration": 123}

Only single videos are supported (playlists are refused).
"""

import argparse
import json
import os
import re
import sys

YOUTUBE_RE = re.compile(
    r"^(https?://)?(www\.|m\.|music\.)?(youtube\.com/(watch|shorts|live|embed)|youtu\.be/)",
    re.IGNORECASE,
)


def progress_hook(d):
    status = d.get("status")
    if status == "downloading":
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        downloaded = d.get("downloaded_bytes", 0)
        if total:
            pct = downloaded / total * 100
            print(f"Downloading… {pct:.1f}%", file=sys.stderr, flush=True)
        else:
            print(f"Downloading… {downloaded // 1024} KiB", file=sys.stderr, flush=True)
    elif status == "finished":
        print(
            f"Downloaded, extracting {d.get('info_dict', {}).get('ext', 'audio')}…",
            file=sys.stderr,
            flush=True,
        )


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Download YouTube audio for Applio.")
    p.add_argument(
        "--url", required=True, help="YouTube video URL (single video, no playlists)."
    )
    p.add_argument(
        "--output-dir", required=True, help="Directory for the downloaded file."
    )
    p.add_argument("--output-format", default="wav", choices=["wav", "mp3"])
    p.add_argument(
        "--ffmpeg-bin", default=None, help="ffmpeg binary path or directory."
    )
    return p


def main(argv=None) -> int:
    args = build_parser().parse_args(argv)

    if not YOUTUBE_RE.match(args.url.strip()):
        print("Only single YouTube video URLs are supported.", file=sys.stderr)
        return 2

    os.makedirs(args.output_dir, exist_ok=True)

    try:
        from yt_dlp import YoutubeDL
    except ImportError:
        print("yt_dlp is not installed in the Python environment.", file=sys.stderr)
        return 3

    postprocessors = [
        {"key": "FFmpegExtractAudio", "preferredcodec": args.output_format}
    ]
    if args.output_format == "mp3":
        postprocessors[0]["preferredquality"] = "192"

    ydl_opts = {
        "format": "bestaudio/best",
        "noplaylist": True,
        "restrictfilenames": True,
        "outtmpl": os.path.join(args.output_dir, "%(title).80s [%(id)s].%(ext)s"),
        "postprocessors": postprocessors,
        "progress_hooks": [progress_hook],
        # Newlines (not \r redraws) so job logs stay line-oriented and the
        # APPLIO_JSON report below is always on its own line.
        "progress_with_newline": True,
        "quiet": True,
        "no_warnings": True,
    }
    if args.ffmpeg_bin:
        ydl_opts["ffmpeg_location"] = args.ffmpeg_bin

    try:
        with YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(args.url.strip(), download=True)
            prepared = ydl.prepare_filename(info)
    except Exception as e:
        print(f"YouTube download failed: {e}", file=sys.stderr)
        return 4

    base, _ext = os.path.splitext(prepared)
    final_path = f"{base}.{args.output_format}"
    if not os.path.isfile(final_path):
        # Fallback: newest matching file (same video id) in the output dir.
        video_id = (info or {}).get("id", "")
        candidates = [
            os.path.join(args.output_dir, f)
            for f in sorted(
                os.listdir(args.output_dir),
                key=lambda f: os.path.getmtime(os.path.join(args.output_dir, f)),
                reverse=True,
            )
            if video_id and video_id in f
        ]
        if not candidates:
            print(
                "Download finished but the audio file was not found.", file=sys.stderr
            )
            return 5
        final_path = candidates[0]

    print(
        "APPLIO_JSON:"
        + json.dumps(
            {
                "file": os.path.abspath(final_path),
                "title": (info or {}).get("title", ""),
                "duration": (info or {}).get("duration"),
            }
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
