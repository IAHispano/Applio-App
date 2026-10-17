"""Review training audio and prepare a separate, curated copy. Never edit sources."""

import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone

import numpy as np
import soundfile as sf

AUDIO_EXTENSIONS = {
    ".wav",
    ".mp3",
    ".flac",
    ".ogg",
    ".opus",
    ".m4a",
    ".mp4",
    ".aac",
    ".alac",
    ".wma",
    ".aiff",
    ".aif",
    ".webm",
    ".ac3",
}
MAX_FILES = 5000


def file_hash(filename):
    digest = hashlib.sha256()
    with open(filename, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def db(value):
    return round(20 * math.log10(max(float(value), 1e-12)), 2)


def sections(mask, window_seconds, duration, minimum=0.0):
    result = []
    start = None
    for index, active in enumerate([*mask, False]):
        if active and start is None:
            start = index * window_seconds
        elif not active and start is not None:
            end = min(duration, index * window_seconds)
            if end - start >= minimum:
                result.append({"start": round(start, 3), "end": round(end, 3)})
            start = None
    return result


def decode(filename, workspace):
    """Use native decoding first; FFmpeg covers the remaining training formats."""
    try:
        return sf.SoundFile(filename), None
    except (RuntimeError, sf.LibsndfileError):
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            shipped = Path(
                os.environ.get("APPLIO_CODE_ROOT", Path(__file__).resolve().parents[3])
            ) / ("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
            if shipped.is_file():
                ffmpeg = str(shipped)
        if not ffmpeg:
            raise ValueError(
                "This format requires FFmpeg. Install/repair Applio's audio dependencies."
            )
        temporary = Path(workspace) / "decoded.wav"
        subprocess.run(
            [
                ffmpeg,
                "-hide_banner",
                "-loglevel",
                "error",
                "-nostdin",
                "-y",
                "-i",
                str(filename),
                "-vn",
                "-acodec",
                "pcm_f32le",
                str(temporary),
            ],
            check=True,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            timeout=600,
            **(
                {"creationflags": subprocess.CREATE_NO_WINDOW}
                if os.name == "nt"
                else {}
            ),
        )
        return sf.SoundFile(temporary), temporary


def analyze_audio(filename, workspace, silence_db=-50):
    audio, decoded = decode(filename, workspace)
    try:
        rate, channels, total_frames = audio.samplerate, audio.channels, audio.frames
        if rate <= 0 or rate > 384000 or channels > 32 or total_frames <= 0:
            raise ValueError("Empty audio or unsupported sample rate/channel count")
        duration = total_frames / rate
        if duration > 4 * 3600:
            raise ValueError(
                "Recordings longer than four hours must be split before review"
            )
        window = max(1, round(rate * 0.02))
        silent_windows, clipping_windows = [], []
        clipping_samples, count, energy, active_energy, active_count, peak = (
            0,
            0,
            0.0,
            0.0,
            0,
            0.0,
        )
        pcm_hash = hashlib.sha256(f"{rate}:{channels}:".encode())
        silence_amplitude = 10 ** (silence_db / 20)
        # Bound memory while retaining sample-accurate decoded content hashes.
        for data in audio.blocks(
            blocksize=window * 64, dtype="float32", always_2d=True
        ):
            if not np.isfinite(data).all():
                raise ValueError("Audio contains non-finite sample values")
            pcm_hash.update(np.asarray(data, dtype="<f4").tobytes())
            peak = max(peak, float(np.max(np.abs(data))))
            energy += float(np.sum(data.astype(np.float64) ** 2))
            count += data.size
            clipping_samples += int(np.count_nonzero(np.abs(data) >= 0.999))
            for begin in range(0, len(data), window):
                frame = data[begin : begin + window]
                squared = float(np.sum(frame.astype(np.float64) ** 2))
                rms = math.sqrt(squared / frame.size)
                is_silent = rms < silence_amplitude
                silent_windows.append(is_silent)
                clipping_windows.append(bool(np.any(np.abs(frame) >= 0.999)))
                if not is_silent:
                    active_energy += squared
                    active_count += frame.size
        silence_sections = sections(silent_windows, window / rate, duration, 0.3)
        clipping_sections = sections(clipping_windows, window / rate, duration)
        first_voice = next(
            (i for i, silent in enumerate(silent_windows) if not silent),
            len(silent_windows),
        )
        last_voice = next(
            (
                i
                for i in range(len(silent_windows) - 1, -1, -1)
                if not silent_windows[i]
            ),
            -1,
        )
        silent_duration = (
            sum(
                min(window, total_frames - i * window)
                for i, silent in enumerate(silent_windows)
                if silent
            )
            / rate
        )
        return {
            "duration": round(duration, 3),
            "sampleRate": rate,
            "channels": channels,
            "peakDb": db(peak),
            "rmsDb": db(math.sqrt(energy / count)),
            "activeRmsDb": (
                db(math.sqrt(active_energy / active_count)) if active_count else None
            ),
            "clippingSamples": clipping_samples,
            "clippingFraction": round(clipping_samples / count, 6),
            "silenceFraction": round(silent_duration / duration, 4),
            "leadingSilence": round(min(duration, first_voice * window / rate), 3),
            "trailingSilence": round(
                max(0.0, duration - (last_voice + 1) * window / rate), 3
            ),
            "clippingSections": clipping_sections[:50],
            "clippingSectionCount": len(clipping_sections),
            "silenceSections": silence_sections[:50],
            "silenceSectionCount": len(silence_sections),
            "longestSilence": round(
                max((s["end"] - s["start"] for s in silence_sections), default=0), 3
            ),
            "pcmHash": pcm_hash.hexdigest(),
        }
    finally:
        audio.close()
        if decoded:
            decoded.unlink(missing_ok=True)


def safe_source(root, relative):
    candidate = root / relative
    if candidate.is_symlink():
        raise ValueError("Symbolic links are excluded from dataset review")
    resolved = candidate.resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError("Recording is outside the reviewed folder")
    return resolved


def linked_directory(directory):
    return directory.is_symlink() or getattr(directory, "is_junction", lambda: False)()


def walk_error(error):
    raise ValueError(f"Cannot read training folder: {error}")


def scan(root, report_path, silence_db=-50):
    root = Path(root).resolve(strict=True)
    files, skipped = [], []
    for directory, dirs, names in os.walk(root, followlinks=False, onerror=walk_error):
        for name in list(dirs):
            if linked_directory(Path(directory) / name):
                skipped.append(str((Path(directory) / name).relative_to(root)))
        dirs[:] = sorted(
            name
            for name in dirs
            if not linked_directory(Path(directory) / name)
            and not name.startswith(".applio-review-")
        )
        for name in sorted(names):
            candidate = Path(directory) / name
            if candidate.suffix.lower() in AUDIO_EXTENSIONS:
                if candidate.is_symlink():
                    skipped.append(str(candidate.relative_to(root)))
                else:
                    files.append(candidate.relative_to(root).as_posix())
        if len(files) > MAX_FILES:
            raise ValueError(
                f"Review supports up to {MAX_FILES} recordings per folder; split this dataset into smaller folders"
            )
    if not files:
        raise ValueError("No supported audio recordings found in this folder")
    clips, hashes = [], {}
    with tempfile.TemporaryDirectory(prefix="applio-audio-review-") as workspace:
        for index, relative in enumerate(files):
            clip = {
                "id": hashlib.sha256(relative.encode()).hexdigest()[:24],
                "path": relative,
                "issues": [],
            }
            try:
                source = safe_source(root, relative)
                before = source.stat()
                source_hash = file_hash(source)
                clip.update(analyze_audio(source, workspace, silence_db))
                clip["sourceHash"] = source_hash
                after = source.stat()
                if (before.st_size, before.st_mtime_ns) != (
                    after.st_size,
                    after.st_mtime_ns,
                ) or file_hash(source) != source_hash:
                    raise ValueError("Recording changed during review; scan again")
                duplicate = hashes.get(clip["pcmHash"])
                if duplicate:
                    clip["duplicateOf"] = duplicate
                    clip["issues"].append("duplicate")
                else:
                    hashes[clip["pcmHash"]] = relative
                if clip["clippingSamples"]:
                    clip["issues"].append("clipping")
                if (
                    clip["silenceFraction"] >= 0.35
                    or clip["longestSilence"] >= 2
                    or max(clip["leadingSilence"], clip["trailingSilence"]) >= 1
                ):
                    clip["issues"].append("silence")
                if clip["activeRmsDb"] is None:
                    clip["issues"].append("no-signal")
            except Exception as error:
                clip.update(error=str(error), issues=["unreadable"])
            clips.append(clip)
            print(f"REVIEW_PROGRESS:{index + 1}/{len(files)}", flush=True)
    levels = [
        c["activeRmsDb"]
        for c in clips
        if not c.get("error")
        and not c.get("duplicateOf")
        and c.get("activeRmsDb") is not None
    ]
    median = round(float(np.median(levels)), 2) if levels else None
    for clip in clips:
        if (
            median is not None
            and clip.get("activeRmsDb") is not None
            and abs(clip["activeRmsDb"] - median) >= 6
        ):
            clip["issues"].append("level")
            clip["levelDifferenceDb"] = round(clip["activeRmsDb"] - median, 2)
    report = {
        "version": 1,
        "root": str(root),
        "createdAt": datetime.now(timezone.utc).isoformat(),
        "silenceDb": silence_db,
        "medianLevelDb": median,
        "clips": clips,
        "skippedLinks": skipped,
        "summary": {
            "files": len(clips),
            "duration": round(sum(c.get("duration", 0) for c in clips), 2),
            "flagged": sum(bool(c["issues"]) for c in clips),
            **{
                issue: sum(issue in c["issues"] for c in clips)
                for issue in (
                    "duplicate",
                    "clipping",
                    "silence",
                    "level",
                    "unreadable",
                    "no-signal",
                )
            },
        },
    }
    Path(report_path).write_text(json.dumps(report, allow_nan=False), encoding="utf-8")
    return report


def prepare(report_path, plan_path, destination):
    report = json.loads(Path(report_path).read_text(encoding="utf-8"))
    plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    root = Path(report["root"]).resolve(strict=True)
    destination = Path(destination).absolute()
    if destination.exists() or destination.resolve().is_relative_to(root):
        raise ValueError(
            "The curated dataset must be a new folder outside the source dataset"
        )
    known = {c["id"]: c for c in report["clips"]}
    selected = plan["include"]
    if (
        not selected
        or len(selected) != len(set(selected))
        or any(i not in known for i in selected)
    ):
        raise ValueError("Select one or more valid recordings from this review")
    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix=f".applio-review-{destination.name}-", dir=destination.parent
    ) as workspace:
        stage = Path(workspace) / "dataset"
        stage.mkdir()
        for index, identifier in enumerate(selected):
            clip = known[identifier]
            source = safe_source(root, clip["path"])
            if clip.get("error") or file_hash(source) != clip["sourceHash"]:
                raise ValueError(
                    f"Recording changed or is unreadable: {clip['path']}. Scan again before preparing a copy."
                )
            target = stage / clip["path"]
            target.parent.mkdir(parents=True, exist_ok=True)
            if (
                plan.get("trimSilence")
                or plan.get("normalize")
                or plan.get("lowerPeaks")
            ):
                audio, decoded = decode(source, workspace)
                try:
                    rate = audio.samplerate
                    start = (
                        round(clip.get("leadingSilence", 0) * rate)
                        if plan.get("trimSilence")
                        else 0
                    )
                    end = (
                        audio.frames - round(clip.get("trailingSilence", 0) * rate)
                        if plan.get("trimSilence")
                        else audio.frames
                    )
                    # Retain a short natural margin at either edge.
                    if plan.get("trimSilence"):
                        start = max(0, start - round(rate * 0.1))
                        end = min(audio.frames, end + round(rate * 0.1))
                    if end <= start or clip.get("activeRmsDb") is None:
                        raise ValueError(
                            f"No usable signal in {clip['path']}; exclude this recording"
                        )
                    gain = 1.0
                    if plan.get("normalize"):
                        gain = 10 ** (min(18.0, -20.0 - clip["activeRmsDb"]) / 20)
                    ceiling = 10 ** (-1.0 / 20)
                    if plan.get("normalize") or plan.get("lowerPeaks"):
                        gain = min(
                            gain, ceiling / max(10 ** (clip["peakDb"] / 20), 1e-12)
                        )
                    target = target.with_name(target.name + ".wav")
                    with sf.SoundFile(
                        target,
                        mode="w",
                        samplerate=rate,
                        channels=audio.channels,
                        subtype="PCM_24",
                    ) as output:
                        audio.seek(start)
                        remaining = end - start
                        while remaining:
                            data = audio.read(
                                min(remaining, 65536), dtype="float32", always_2d=True
                            )
                            if not len(data):
                                raise ValueError("Recording ended unexpectedly")
                            output.write(data * gain)
                            remaining -= len(data)
                finally:
                    audio.close()
                    if decoded:
                        decoded.unlink(missing_ok=True)
            else:
                shutil.copy2(source, target)
            if file_hash(source) != clip["sourceHash"]:
                raise ValueError(
                    f"Recording changed while copying: {clip['path']}; scan again"
                )
            print(f"REVIEW_PROGRESS:{index + 1}/{len(selected)}", flush=True)
        (stage / "dataset-review.json").write_text(
            json.dumps(
                {
                    "source": str(root),
                    "plan": plan,
                    "createdAt": datetime.now(timezone.utc).isoformat(),
                }
            ),
            encoding="utf-8",
        )
        stage.rename(destination)
    return {"datasetPath": str(destination), "files": len(selected)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["scan", "prepare"])
    parser.add_argument("--root")
    parser.add_argument("--report", required=True)
    parser.add_argument("--silence-db", type=float, default=-50)
    parser.add_argument("--plan")
    parser.add_argument("--destination")
    args = parser.parse_args()
    if args.mode == "scan":
        result = scan(args.root, args.report, args.silence_db)
        result = {"summary": result["summary"]}
    else:
        result = prepare(args.report, args.plan, args.destination)
    print("REVIEW_RESULT:" + json.dumps(result, allow_nan=False), flush=True)
