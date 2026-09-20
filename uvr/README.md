# Applio UVR — vendored stem-separation engine

Local copy of [python-audio-separator](https://github.com/nomadkaraoke/python-audio-separator)
(MIT, (c) 2023 karaokenerds — see `THIRD_PARTY_NOTICES.md`), stripped down so Applio
owns the code outright instead of depending on the PyPI package.

## Layout

```
uvr/
  audio_separator/   Vendored engine (VR / MDX / Demucs / MDXC architectures,
                     model registry JSONs). No remote/cloud code, no CLI.
  runner/
    separate.py      Applio-owned CLI wrapper (argparse). The backend spawns it
                     per separation job; it prints one APPLIO_JSON line.
```

## What was removed vs upstream

- `remote/` (SaaS/cloud-runner service), `utils/cli.py` (their CLI — replaced by `runner/`),
  `tests/` incl. ~130 MB of audio fixtures, `docs/`, Dockerfiles, CI, poetry lockfiles.
- Kept: the full `separator/` engine (2 MB), `models.json`, `model-data.json`,
  `models-scores.json`, `ensemble_presets.json`.

## Local patches vs upstream

- `audio_separator/separator/separator.py`: version lookup tolerates a missing
  pip-installed distribution (`"vendored"` fallback) since we import from source.

## Runtime notes

- Python deps: root `requirements.txt` (torch, librosa, … **plus** the `# UVR stem
  separation` and `yt-dlp` entries — installed automatically by first-run setup).
  If you install by hand and pip tries to replace your CUDA torch build with a CPU
  wheel, reinstall the pinned CUDA builds afterwards (versions from the root
  requirements.txt):
  `python -m pip install "torch==2.11.0" "torchaudio==2.11.0" "torchvision==0.26.0" --index-url https://download.pytorch.org/whl/cu128`
- Compute device: on Windows the pinned `onnxruntime-gpu` + CUDA 12 wheels make the
  engine pick CUDA automatically when an NVIDIA GPU is present (other platforms
  use CPU `onnxruntime`). Pass `--device cpu` (or pick **CPU** in the UI) to force
  CPU mode and save VRAM, or `--device <index>` to pin a specific GPU.
- `ffmpeg` must be on PATH (or next to the app — Applio ships `ffmpeg.exe` at the repo root).
- Model weights are **not** vendored (hundreds of MB). The engine downloads them on first
  use into `assets/uvr-models/` (override with `AUDIO_SEPARATOR_MODEL_DIR`), from the
  community UVR model repos. A network connection is required for the first run of each model.
- The model *list* is also fetched upstream (`download_checks.json`, cached under
  `assets/uvr-models/`); the bundled `models.json` only supplements it.
