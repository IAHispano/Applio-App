"""Render a captioned product walkthrough from current 1600x900 UI captures.

Requires Pillow and ffmpeg. Example:
python scripts/render-demo.py --source .cache/demo-source --ffmpeg ./ffmpeg.exe
Captures are disposable presentation assets; this script never changes settings.
"""

from pathlib import Path
import argparse
import math
import subprocess

from PIL import Image, ImageDraw, ImageFont

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--source", type=Path, required=True)
parser.add_argument("--output", type=Path, default=Path("assets"))
parser.add_argument("--ffmpeg", default="ffmpeg")
parser.add_argument("--font", type=Path, default=Path("C:/Windows/Fonts/segoeui.ttf"))
parser.add_argument(
    "--bold-font", type=Path, default=Path("C:/Windows/Fonts/segoeuib.ttf")
)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
W, H, FPS = 1920, 1080, 30
GREEN = "#61e9bd"
scenes = [
    ("intro", 2.5, "Applio", "Convert. Stream. Create."),
    (
        "home",
        5,
        "Your voice workspace",
        "Models, recent activity, and your next session in one place.",
    ),
    (
        "inference",
        5,
        "Turn recordings into a new voice",
        "Choose a model, add your audio, and fine-tune the conversion.",
    ),
    (
        "batch-modes",
        5.5,
        "One workflow. Three batch modes.",
        "One model / many files  ·  Many models / one file  ·  Many models / many files",
    ),
    (
        "realtime",
        5,
        "Take your voice live",
        "Choose your voice and audio devices, then start streaming.",
    ),
    (
        "realtime-tuning",
        6,
        "Shape the sound as you speak",
        "Live settings  ·  Automatic chunks  ·  FP16 decoder  ·  Voice Focus",
    ),
    (
        "models",
        4,
        "Keep your voices close",
        "Browse, inspect, and manage your model library.",
    ),
    (
        "training",
        4,
        "Build your next voice",
        "Prepare a dataset, extract features, and train from one studio.",
    ),
    ("outro", 3, "Your voice. Your studio.", "Applio  ·  applio.org"),
]
duration = sum(s[1] for s in scenes)


def font(size, bold=False):
    return ImageFont.truetype(str(args.bold_font if bold else args.font), size)


logo = Image.open("assets/icon.png").convert("RGBA")


def draw_center(draw, text, y, size, color="white", bold=False):
    f = font(size, bold)
    box = draw.textbbox((0, 0), text, font=f)
    draw.text(((W - box[2]) / 2, y), text, font=f, fill=color)


def base(scene, index):
    name, seconds, title, subtitle = scene
    canvas = Image.new("RGB", (W, H), "#080b0c")
    draw = ImageDraw.Draw(canvas)
    if name in ("intro", "outro"):
        badge = logo.resize((86, 86), Image.Resampling.LANCZOS)
        canvas.paste(badge, (W // 2 - 43, 272), badge)
        draw_center(draw, "APPLIO / VOICE STUDIO", 396, 19, GREEN, True)
        draw_center(draw, title, 450, 86, bold=True)
        draw_center(draw, subtitle, 574, 29, "#b0bab6")
        draw_center(
            draw,
            "VOICE CONVERSION   /   REALTIME   /   MODEL TRAINING",
            930,
            17,
            "#77867e",
        )
    else:
        draw.text((160, 19), f"{index:02d} / WORKFLOW", font=font(15, True), fill=GREEN)
        draw.text((160, 43), title, font=font(32, True), fill="white")
        badge = logo.resize((30, 30), Image.Resampling.LANCZOS)
        canvas.paste(badge, (1602, 34), badge)
        draw.text((1642, 33), "Applio", font=font(24, True), fill="white")
        shot = Image.open(args.source / f"{name}.png").convert("RGB")
        if shot.size != (1600, 900):
            raise ValueError(f"{name}: capture must be 1600x900, got {shot.size}")
        draw.rounded_rectangle(
            (151, 100, 1769, 1018), 19, fill="#13191a", outline="#293330", width=1
        )
        mask = Image.new("L", shot.size)
        ImageDraw.Draw(mask).rounded_rectangle((0, 0, 1599, 899), 12, fill=255)
        canvas.paste(shot, (160, 109), mask)
        draw.text((160, 1027), subtitle, font=font(22), fill="#c5cfca")
    return canvas


frames = [base(s, i) for i, s in enumerate(scenes)]
mp4 = args.output / "demo.mp4"
command = [
    args.ffmpeg,
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    f"{W}x{H}",
    "-r",
    str(FPS),
    "-i",
    "-",
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "medium",
    "-crf",
    "21",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    str(mp4),
]
with subprocess.Popen(command, stdin=subprocess.PIPE) as process:
    elapsed = 0
    for index, (name, seconds, title, subtitle) in enumerate(scenes):
        total = round(seconds * FPS)
        print(f"Rendering {name} ({seconds}s)", flush=True)
        for n in range(total):
            t = n / FPS
            frame = frames[index].copy()
            draw = ImageDraw.Draw(frame)
            if name in ("intro", "outro"):
                for bar in range(47):
                    amplitude = (18 + 32 * math.sin(bar * 0.57 + t * 2.6) ** 2) * (
                        1 - abs(bar - 23) / 30
                    )
                    x = 608 + bar * 15
                    draw.rounded_rectangle(
                        (x, 757 - amplitude, x + 5, 757 + amplitude), 3, fill=GREEN
                    )
            else:
                progress = (elapsed + t) / duration
                draw.rectangle((160, 1074, 1760, 1077), fill="#24312b")
                draw.rectangle((160, 1074, 160 + 1600 * progress, 1077), fill=GREEN)
            if n < 10:
                prior = (
                    frames[index - 1] if index else Image.new("RGB", (W, H), "#080b0c")
                )
                frame = Image.blend(prior, frame, n / 10)
            if index == len(scenes) - 1 and n >= total - 12:
                frame = Image.blend(
                    frame, Image.new("RGB", (W, H), "#080b0c"), (n - total + 12) / 12
                )
            process.stdin.write(frame.tobytes())
        elapsed += seconds
    process.stdin.close()
    if process.wait() != 0:
        raise RuntimeError("MP4 encoding failed")

subprocess.run(
    [
        args.ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(mp4),
        "-vf",
        "scale=1280:720",
        "-an",
        "-c:v",
        "libvpx-vp9",
        "-crf",
        "34",
        "-b:v",
        "0",
        "-row-mt",
        "1",
        "-threads",
        "4",
        str(args.output / "demo.webm"),
    ],
    check=True,
)
# A complete, readable loop; no flashing, simulated microphone output or fake metrics.
subprocess.run(
    [
        args.ffmpeg,
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        str(mp4),
        "-filter_complex",
        "fps=8,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle",
        "-loop",
        "0",
        str(args.output / "demo.gif"),
    ],
    check=True,
)
frames[1].save(args.output / "demo-poster.png", optimize=True)
print(
    f"Done: {duration:g}s walkthrough, 1080p MP4, 720p WebM, GIF and poster.",
    flush=True,
)
