"""Applio-App CLI adapter around the pinned Applio engine."""

import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys

current_script_directory = str(Path(__file__).resolve().parent)
backend_root = Path(
    os.environ.get("APPLIO_BACKEND_ROOT")
    or Path(current_script_directory) / "backend" / "applio"
).resolve()
if not (backend_root / "core.py").is_file():
    raise RuntimeError(
        "Applio backend missing. Run: git submodule update --init --recursive"
    )
os.environ.setdefault("APPLIO_ROOT", current_script_directory)
os.environ.setdefault("APPLIO_CODE_ROOT", current_script_directory)
os.environ["APPLIO_BACKEND_ROOT"] = str(backend_root)
sys.path.insert(0, str(backend_root))
os.environ["PYTHONPATH"] = os.pathsep.join(
    [str(backend_root), current_script_directory, os.environ.get("PYTHONPATH", "")]
)
spec = importlib.util.spec_from_file_location(
    "applio_engine_core", backend_root / "core.py"
)
engine = importlib.util.module_from_spec(spec)
spec.loader.exec_module(engine)
for name in dir(engine):
    if name.startswith("run_") or name in (
        "load_voices_data",
        "import_voice_converter",
        "get_config",
        "pretrained_selector",
        "shutdown_after_training",
        "append_data_shutdown_log",
    ):
        globals()[name] = getattr(engine, name)
voices_data = engine.voices_data
locales = engine.locales
logs_path = engine.logs_path
python = sys.executable


def run_uvr_script(
    input_path: str,
    model: str = "auto",
    output_dir: str = "outputs",
    output_format: str = "WAV",
    single_stem: str = None,
    device: str = "auto",
):
    uvr_script = os.path.join(current_script_directory, "uvr", "separate.py")
    if not os.path.exists(uvr_script):
        return "UVR separation script not found in uvr/separate.py."

    cmd = [
        python,
        uvr_script,
        "--input-path",
        input_path,
        "--model",
        model,
        "--output-dir",
        output_dir,
        "--output-format",
        output_format,
        "--device",
        device,
    ]
    if single_stem:
        cmd.extend(["--single-stem", single_stem])

    result = subprocess.run(cmd)
    if result.returncode != 0:
        return f"UVR separation failed with exit code {result.returncode}."
    return f"Audio separation completed successfully. Stems saved in: {output_dir}"


def _get_version():
    candidates = [
        os.path.join(current_script_directory, "package.json"),
        os.path.join(current_script_directory, "assets", "config_template.json"),
    ]
    for p in candidates:
        try:
            if os.path.exists(p):
                with open(p, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if "version" in data and data["version"]:
                        return str(data["version"])
        except Exception:
            pass
    return "0.0.9"


VERSION = _get_version()

# Attempt to load Click
try:
    import click
except ImportError:
    click = None


def print_banner():
    banner = r"""
     _             _ _       
    / \   _ __  _ __| (_) ___  
   / _ \ | '_ \| '_ \ | |/ _ \ 
  / ___ \| |_) | |_) | | | (_) |
 /_/   \_\ .__/| .__/|_|_|\___/ 
         |_|   |_|              
    """
    print(banner)
    print(f"  Applio CLI - Voice Conversion Studio [v{VERSION}]\n")


def prompt_with_default(prompt_text, default):
    try:
        val = input(f"{prompt_text} [{default}]: ").strip()
        return val if val else default
    except (EOFError, KeyboardInterrupt):
        print("\nAborted.")
        sys.exit(0)


def interactive_mode():
    print_banner()
    while True:
        print("Select an option:")
        print("  [1] Voice Conversion (Single File)")
        print("  [2] Batch Voice Conversion (Folder)")
        print("  [3] Text-to-Speech (TTS)")
        print("  [4] Audio Separation (UVR - Stems)")
        print("  [5] Train Model (Preprocess, Extract, Train, Index)")
        print("  [6] Model Tools (Download, Info, Blender)")
        print("  [7] Audio Tools (Analyzer, F0 Curve)")
        print("  [8] Install Prerequisites")
        print("  [9] Launch Web UI & Server")
        print("  [h] Help / Commands Overview")
        print("  [0] Exit\n")

        try:
            choice = input("Option: ").strip().lower()
        except (EOFError, KeyboardInterrupt):
            print("\nExiting Applio CLI. Goodbye!")
            break

        if choice in ["0", "q", "exit", "quit"]:
            print("Exiting Applio CLI. Goodbye!")
            break

        elif choice == "1":
            print("\n--- [1] Voice Conversion ---")
            inp = prompt_with_default("Input audio path", "")
            if not inp or not os.path.exists(inp):
                print(f"Error: input file '{inp}' does not exist.")
                continue
            out = prompt_with_default("Output audio path", "outputs/converted.wav")
            pth = prompt_with_default("Model (.pth) path", "")
            if not pth or not os.path.exists(pth):
                print(f"Error: model file '{pth}' does not exist.")
                continue
            idx = prompt_with_default("Index (.index) path (optional)", "")
            pitch = int(prompt_with_default("Pitch shift (semitones, -24..24)", "0"))
            f0_m = prompt_with_default(
                "F0 pitch method (rmvpe, fcpe, crepe, swift)", "rmvpe"
            )
            rate = float(prompt_with_default("Index rate (0..1)", "0.75"))
            os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
            print("\nStarting voice conversion...")
            try:
                msg, path = run_infer_script(
                    pitch=pitch,
                    index_rate=rate,
                    volume_envelope=1.0,
                    protect=0.33,
                    f0_method=f0_m,
                    input_path=inp,
                    output_path=out,
                    pth_path=pth,
                    index_path=idx,
                    split_audio=False,
                    f0_autotune=False,
                    f0_autotune_strength=1.0,
                    proposed_pitch=False,
                    proposed_pitch_threshold=155.0,
                    clean_audio=False,
                    clean_strength=0.7,
                    export_format="WAV",
                    embedder_model="contentvec",
                )
                print(f"\nSuccess: {msg} -> {path}\n")
            except Exception as e:
                print(f"\nInference error: {e}\n")

        elif choice == "2":
            print("\n--- [2] Batch Voice Conversion ---")
            inp_f = prompt_with_default("Input folder", "")
            if not inp_f or not os.path.isdir(inp_f):
                print(f"Error: input folder '{inp_f}' does not exist.")
                continue
            out_f = prompt_with_default("Output folder", "outputs/batch")
            pth = prompt_with_default("Model (.pth) path", "")
            if not pth or not os.path.exists(pth):
                print(f"Error: model file '{pth}' does not exist.")
                continue
            idx = prompt_with_default("Index (.index) path (optional)", "")
            pitch = int(prompt_with_default("Pitch shift (semitones, -24..24)", "0"))
            f0_m = prompt_with_default(
                "F0 pitch method (rmvpe, fcpe, crepe, swift)", "rmvpe"
            )
            os.makedirs(out_f, exist_ok=True)
            print("\nStarting batch voice conversion...")
            try:
                msg = run_batch_infer_script(
                    pitch=pitch,
                    index_rate=0.75,
                    volume_envelope=1.0,
                    protect=0.33,
                    f0_method=f0_m,
                    input_folder=inp_f,
                    output_folder=out_f,
                    pth_path=pth,
                    index_path=idx,
                    split_audio=False,
                    f0_autotune=False,
                    f0_autotune_strength=1.0,
                    proposed_pitch=False,
                    proposed_pitch_threshold=155.0,
                    clean_audio=False,
                    clean_strength=0.7,
                    export_format="WAV",
                    embedder_model="contentvec",
                )
                print(f"\nSuccess: {msg}\n")
            except Exception as e:
                print(f"\nBatch inference error: {e}\n")

        elif choice == "3":
            print("\n--- [3] Text-to-Speech (TTS) ---")
            text = prompt_with_default("Text to synthesize", "Hello, this is Applio!")
            voice = prompt_with_default("Voice", "en-US-AnaNeural")
            rate = int(prompt_with_default("Rate (-100 to 100)", "0"))
            out_tts = prompt_with_default("Output TTS path", "outputs/tts.wav")
            pth = prompt_with_default(
                "Model (.pth) path (optional, leave empty for TTS only)", ""
            )
            out_rvc = "outputs/tts_rvc.wav" if pth else None
            idx = ""
            pitch = 0
            if pth:
                idx = prompt_with_default("Index (.index) path (optional)", "")
                pitch = int(prompt_with_default("Pitch shift (semitones)", "0"))
            os.makedirs(os.path.dirname(os.path.abspath(out_tts)), exist_ok=True)
            print("\nSynthesizing TTS...")
            try:
                res = run_tts_script(
                    tts_file="",
                    tts_text=text,
                    tts_voice=voice,
                    tts_rate=rate,
                    pitch=pitch,
                    index_rate=0.75,
                    volume_envelope=1.0,
                    protect=0.33,
                    f0_method="rmvpe",
                    output_tts_path=out_tts,
                    output_rvc_path=out_rvc,
                    pth_path=pth,
                    index_path=idx,
                    split_audio=False,
                    f0_autotune=False,
                    f0_autotune_strength=1.0,
                    proposed_pitch=False,
                    proposed_pitch_threshold=155.0,
                    clean_audio=False,
                    clean_strength=0.5,
                    export_format="WAV",
                    embedder_model="contentvec",
                )
                print(f"\nSuccess: {res[0]} -> {res[1]}\n")
            except Exception as e:
                print(f"\nTTS error: {e}\n")

        elif choice == "4":
            print("\n--- [4] Audio Separation (UVR) ---")
            inp = prompt_with_default("Input audio path", "")
            if not inp or not os.path.exists(inp):
                print(f"Error: audio file '{inp}' does not exist.")
                continue
            model = prompt_with_default(
                "UVR model (auto, MDX23C-8KFFT-InstVoc_HQ.ckpt, htdemucs)", "auto"
            )
            out_dir = prompt_with_default("Output directory", "outputs/uvr")
            stem = prompt_with_default(
                "Single stem (vocals, instrumental, or leave empty for all)", ""
            )
            print("\nStarting stem separation...")
            res = run_uvr_script(
                input_path=inp,
                model=model,
                output_dir=out_dir,
                single_stem=stem if stem else None,
            )
            print(f"\n{res}\n")

        elif choice == "5":
            print("\n--- [5] Train Model ---")
            print("  [a] Preprocess Dataset")
            print("  [b] Extract Features")
            print("  [c] Train Model")
            print("  [d] Extract Index")
            sub = prompt_with_default("Select step", "a").lower()
            if sub == "a":
                m_name = prompt_with_default("Model name", "my_voice")
                d_path = prompt_with_default("Dataset folder path", "")
                if not d_path or not os.path.isdir(d_path):
                    print("Error: Invalid dataset directory.")
                    continue
                sr = int(
                    prompt_with_default("Sample rate (40000, 48000, 32000)", "40000")
                )
                print(
                    run_preprocess_script(
                        m_name, d_path, sr, 2, "Automatic", False, False, 0.7, 3.0, 0.3
                    )
                )
            elif sub == "b":
                m_name = prompt_with_default("Model name", "my_voice")
                sr = int(
                    prompt_with_default("Sample rate (40000, 48000, 32000)", "40000")
                )
                f0_m = prompt_with_default(
                    "F0 method (rmvpe, fcpe, crepe, swift)", "rmvpe"
                )
                print(run_extract_script(m_name, f0_m, 2, 0, sr, "contentvec"))
            elif sub == "c":
                m_name = prompt_with_default("Model name", "my_voice")
                epochs = int(prompt_with_default("Total epochs", "200"))
                save_every = int(prompt_with_default("Save every epoch", "10"))
                sr = int(prompt_with_default("Sample rate", "40000"))
                bs = int(prompt_with_default("Batch size", "8"))
                print(
                    run_train_script(
                        m_name, save_every, False, True, epochs, sr, bs, 0, True, False
                    )
                )
            elif sub == "d":
                m_name = prompt_with_default("Model name", "my_voice")
                algo = prompt_with_default("Algorithm (Auto, Faiss, KMeans)", "Auto")
                print(run_index_script(m_name, algo))

        elif choice == "6":
            print("\n--- [6] Model Tools ---")
            print("  [a] Download Model Link (HuggingFace / URL)")
            print("  [b] Inspect Model Information (.pth)")
            print("  [c] Model Blender (fuse two .pth models)")
            sub = prompt_with_default("Select tool", "a").lower()
            if sub == "a":
                link = prompt_with_default("Model direct link or HuggingFace URL", "")
                if link:
                    print(run_download_script(link))
            elif sub == "b":
                pth = prompt_with_default("Path to .pth file", "")
                if pth and os.path.exists(pth):
                    run_model_information_script(pth)
            elif sub == "c":
                name = prompt_with_default("Fused model name", "fused_model")
                p1 = prompt_with_default("Path to Model 1 (.pth)", "")
                p2 = prompt_with_default("Path to Model 2 (.pth)", "")
                r = float(
                    prompt_with_default("Ratio Model 1 weight (0.0 - 1.0)", "0.5")
                )
                if os.path.exists(p1) and os.path.exists(p2):
                    msg, out = run_model_blender_script(name, p1, p2, r)
                    print(f"\n{msg} -> {out}\n")

        elif choice == "7":
            print("\n--- [7] Audio Tools ---")
            print("  [a] Audio Analyzer (Spectrogram & Pitch)")
            print("  [b] Extract F0 Curve")
            sub = prompt_with_default("Select tool", "a").lower()
            if sub == "a":
                inp = prompt_with_default("Audio file path", "")
                if inp and os.path.exists(inp):
                    run_audio_analyzer_script(inp)
            elif sub == "b":
                inp = prompt_with_default("Audio file path", "")
                if inp and os.path.exists(inp):
                    from rvc.lib.tools.f0_curve import extract_f0_curve

                    method = prompt_with_default(
                        "Method (rmvpe, fcpe, crepe, swift)", "rmvpe"
                    )
                    img = prompt_with_default(
                        "Output plot image path",
                        os.path.join(logs_path, "f0_curve.png"),
                    )
                    txt = prompt_with_default(
                        "Output curve txt path", os.path.join(logs_path, "f0_curve.txt")
                    )
                    img_res, txt_res = extract_f0_curve(inp, method, img, txt)
                    print(f"Extracted F0 curve: {img_res}, {txt_res}")

        elif choice == "8":
            print("\n--- [8] Install Prerequisites ---")
            print("Downloading required pretraineds, base models, and tools...")
            res = run_prerequisites_script()
            print(f"\n{res}\n")

        elif choice == "9":
            print("\n--- [9] Launch Web UI & Server ---")
            pnpm_cmd = "pnpm.cmd" if os.name == "nt" else "pnpm"
            npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
            cmd = None
            if shutil.which("pnpm") or shutil.which(pnpm_cmd):
                cmd = [pnpm_cmd, "dev"]
            elif shutil.which("npm") or shutil.which(npm_cmd):
                cmd = [npm_cmd, "run", "dev"]
            if cmd:
                print("Launching Applio Server (press Ctrl+C to stop)...")
                try:
                    subprocess.run(cmd, cwd=current_script_directory)
                except KeyboardInterrupt:
                    print("\nServer stopped.")
            else:
                print("Error: Neither pnpm nor npm was found in PATH.")

        elif choice in ["h", "help", "?"]:
            print("\nApplio CLI Subcommands:")
            print(
                "  applio infer [options]            Run voice conversion on a single audio file"
            )
            print(
                "  applio batch-infer [options]      Run voice conversion on a folder"
            )
            print(
                "  applio tts [options]              Synthesize speech with Edge-TTS and apply RVC"
            )
            print(
                "  applio uvr [options]              Separate audio into stems (vocals, instruments)"
            )
            print("  applio train [options]            Train an RVC voice model")
            print(
                "  applio preprocess [options]       Preprocess a dataset for training"
            )
            print("  applio extract [options]          Extract features from dataset")
            print(
                "  applio index [options]            Generate FAISS/KMeans index file"
            )
            print("  applio model-information [opts]   Inspect model metadata")
            print("  applio model-blender [options]    Fuse two voice models")
            print(
                "  applio download [options]         Download model from direct link or HuggingFace"
            )
            print(
                "  applio prerequisites [options]    Download prerequisites and models"
            )
            print(
                "  applio audio-analyzer [options]   Analyze audio and export spectrogram"
            )
            print("  applio f0-curve [options]         Extract F0 curve from audio")
            print("  applio tensorboard                Launch TensorBoard monitor")
            print("  applio web                        Start Web UI and API server")
            print("  applio desktop                    Launch Desktop Electron app")
            print("  applio menu                       Open this interactive menu\n")


# Build Click CLI if click is available
if click is not None:

    def _infer_opts(func):
        opts = [
            click.option(
                "--pitch",
                type=click.IntRange(-24, 24),
                default=0,
                help="Pitch shift in semitones.",
            ),
            click.option(
                "--index-rate",
                type=click.FloatRange(0, 1),
                default=0.75,
                help="Search feature ratio.",
            ),
            click.option(
                "--volume-envelope",
                type=click.FloatRange(0, 1),
                default=1.0,
                help="Volume envelope adjustment.",
            ),
            click.option(
                "--protect",
                type=click.FloatRange(0, 0.5),
                default=0.33,
                help="Protect voiceless consonants and breath sounds.",
            ),
            click.option(
                "--f0-method",
                type=click.Choice(["crepe", "crepe-tiny", "rmvpe", "fcpe", "swift"]),
                default="rmvpe",
                help="Pitch extraction method.",
            ),
            click.option(
                "--split-audio",
                is_flag=True,
                default=False,
                help="Split audio into chunks before inference.",
            ),
            click.option(
                "--f0-autotune",
                is_flag=True,
                default=False,
                help="Apply pitch autotune.",
            ),
            click.option(
                "--f0-autotune-strength",
                type=click.FloatRange(0, 1),
                default=1.0,
                help="Pitch autotune strength.",
            ),
            click.option(
                "--proposed-pitch",
                is_flag=True,
                default=False,
                help="Propose pitch automatically.",
            ),
            click.option(
                "--proposed-pitch-threshold",
                type=click.FloatRange(50.0, 1100.0),
                default=155.0,
                help="Proposed pitch threshold.",
            ),
            click.option(
                "--clean-audio",
                is_flag=True,
                default=False,
                help="Clean audio with noise reduction.",
            ),
            click.option(
                "--clean-strength",
                type=click.FloatRange(0, 1),
                default=0.7,
                help="Cleaning strength.",
            ),
            click.option(
                "--export-format",
                type=click.Choice(["WAV", "MP3", "FLAC", "OGG", "M4A"]),
                default="WAV",
                help="Export audio format.",
            ),
            click.option(
                "--embedder-model",
                type=click.Choice(
                    [
                        "contentvec",
                        "spin",
                        "spin-v2",
                        "chinese-hubert-base",
                        "japanese-hubert-base",
                        "korean-hubert-base",
                        "custom",
                    ]
                ),
                default="contentvec",
                help="Speaker embedding model.",
            ),
            click.option(
                "--embedder-model-custom",
                type=str,
                default=None,
                help="Custom embedding model path.",
            ),
            click.option("--sid", type=int, default=0, help="Speaker ID."),
        ]
        for opt in reversed(opts):
            func = opt(func)
        return func

    def _post_process_opts(func):
        opts = [
            click.option(
                "--formant-shifting",
                is_flag=True,
                default=False,
                help="Enable formant shifting.",
            ),
            click.option(
                "--formant-qfrency",
                type=click.FloatRange(0.0, 16.0),
                default=1.0,
                help="Formant frequency factor.",
            ),
            click.option(
                "--formant-timbre",
                type=click.FloatRange(0.0, 16.0),
                default=1.0,
                help="Formant timbre factor.",
            ),
            click.option(
                "--post-process",
                is_flag=True,
                default=False,
                help="Enable post-processing effects.",
            ),
            click.option(
                "--reverb", is_flag=True, default=False, help="Enable reverb effect."
            ),
            click.option(
                "--pitch-shift",
                is_flag=True,
                default=False,
                help="Enable pitch shift effect.",
            ),
            click.option(
                "--limiter", is_flag=True, default=False, help="Enable limiter effect."
            ),
            click.option(
                "--gain", is_flag=True, default=False, help="Enable gain adjustment."
            ),
            click.option(
                "--distortion",
                is_flag=True,
                default=False,
                help="Enable distortion effect.",
            ),
            click.option(
                "--chorus", is_flag=True, default=False, help="Enable chorus effect."
            ),
            click.option(
                "--bitcrush",
                is_flag=True,
                default=False,
                help="Enable bitcrush effect.",
            ),
            click.option(
                "--clipping",
                is_flag=True,
                default=False,
                help="Enable clipping effect.",
            ),
            click.option(
                "--compressor",
                is_flag=True,
                default=False,
                help="Enable compressor effect.",
            ),
            click.option(
                "--delay", is_flag=True, default=False, help="Enable delay effect."
            ),
            click.option(
                "--reverb-room-size",
                type=click.FloatRange(0, 1),
                default=0.5,
                help="Reverb room size.",
            ),
            click.option(
                "--reverb-damping",
                type=click.FloatRange(0, 1),
                default=0.5,
                help="Reverb damping.",
            ),
            click.option(
                "--reverb-wet-gain",
                type=click.FloatRange(0, 1),
                default=0.5,
                help="Reverb wet gain.",
            ),
            click.option(
                "--reverb-dry-gain",
                type=click.FloatRange(0, 1),
                default=0.5,
                help="Reverb dry gain.",
            ),
            click.option(
                "--reverb-width",
                type=click.FloatRange(0, 1),
                default=0.5,
                help="Reverb width.",
            ),
            click.option(
                "--reverb-freeze-mode",
                type=click.FloatRange(0, 1),
                default=0.5,
                help="Reverb freeze mode.",
            ),
            click.option(
                "--pitch-shift-semitones",
                type=click.FloatRange(-24, 24),
                default=0.0,
                help="Pitch shift semitones.",
            ),
            click.option(
                "--limiter-threshold",
                type=click.FloatRange(-60, 0),
                default=-6,
                help="Limiter threshold.",
            ),
            click.option(
                "--limiter-release-time",
                type=click.FloatRange(0.001, 1),
                default=0.01,
                help="Limiter release time.",
            ),
            click.option(
                "--gain-db",
                type=click.FloatRange(-60, 60),
                default=0.0,
                help="Gain in dB.",
            ),
            click.option(
                "--distortion-gain",
                type=click.FloatRange(-60, 60),
                default=25,
                help="Distortion gain.",
            ),
            click.option(
                "--chorus-rate",
                type=click.FloatRange(0, 100),
                default=1.0,
                help="Chorus rate.",
            ),
            click.option(
                "--chorus-depth",
                type=click.FloatRange(0, 1),
                default=0.25,
                help="Chorus depth.",
            ),
            click.option(
                "--chorus-center-delay",
                type=click.FloatRange(0, 100),
                default=7,
                help="Chorus center delay.",
            ),
            click.option(
                "--chorus-feedback",
                type=click.FloatRange(0, 1),
                default=0.0,
                help="Chorus feedback.",
            ),
            click.option(
                "--chorus-mix",
                type=click.FloatRange(0, 1),
                default=0.5,
                help="Chorus mix.",
            ),
            click.option(
                "--bitcrush-bit-depth",
                type=click.IntRange(1, 32),
                default=8,
                help="Bitcrush bit depth.",
            ),
            click.option(
                "--clipping-threshold",
                type=click.FloatRange(-60, 0),
                default=-6,
                help="Clipping threshold.",
            ),
            click.option(
                "--compressor-threshold",
                type=click.FloatRange(-60, 0),
                default=0,
                help="Compressor threshold.",
            ),
            click.option(
                "--compressor-ratio",
                type=click.FloatRange(1, 20),
                default=1,
                help="Compressor ratio.",
            ),
            click.option(
                "--compressor-attack",
                type=click.FloatRange(0.1, 100),
                default=1.0,
                help="Compressor attack.",
            ),
            click.option(
                "--compressor-release",
                type=click.FloatRange(1, 1000),
                default=100,
                help="Compressor release.",
            ),
            click.option(
                "--delay-seconds",
                type=click.FloatRange(0.01, 5.0),
                default=0.5,
                help="Delay in seconds.",
            ),
            click.option(
                "--delay-feedback",
                type=click.FloatRange(0.0, 1.0),
                default=0.0,
                help="Delay feedback.",
            ),
            click.option(
                "--delay-mix",
                type=click.FloatRange(0.0, 1.0),
                default=0.5,
                help="Delay mix.",
            ),
        ]
        for opt in reversed(opts):
            func = opt(func)
        return func

    @click.group(invoke_without_command=True)
    @click.version_option(
        version=VERSION, prog_name="Applio", message="%(prog)s v%(version)s"
    )
    @click.pass_context
    def cli(ctx):
        """Applio CLI - Voice Conversion Studio."""
        if ctx.invoked_subcommand is None:
            if sys.stdin.isatty():
                interactive_mode()
            else:
                click.echo(ctx.get_help())
                ctx.exit()

    @cli.command()
    def menu():
        """Launch the interactive terminal menu."""
        interactive_mode()

    @cli.command()
    @click.option("--input-path", required=True, help="Full path to input audio file.")
    @click.option(
        "--output-path", required=True, help="Full path to output audio file."
    )
    @click.option(
        "--pth-path", required=True, help="Full path to RVC model file (.pth)."
    )
    @click.option("--index-path", default="", help="Full path to index file (.index).")
    @_infer_opts
    @_post_process_opts
    def infer(**kwargs):
        """Run voice conversion on a single audio file."""
        try:
            result = run_infer_script(**kwargs)
            click.echo(result[0])
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command(name="batch-infer")
    @click.option(
        "--input-folder", required=True, help="Folder containing input audio files."
    )
    @click.option(
        "--output-folder", required=True, help="Folder for saving output audio files."
    )
    @click.option(
        "--pth-path", required=True, help="Full path to RVC model file (.pth)."
    )
    @click.option("--index-path", default="", help="Full path to index file (.index).")
    @_infer_opts
    @_post_process_opts
    def batch_infer(**kwargs):
        """Run voice conversion on multiple audio files in a folder."""
        try:
            result = run_batch_infer_script(**kwargs)
            click.echo(result)
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command()
    @click.option("--tts-file", default="", help="File with text to be synthesized.")
    @click.option("--tts-text", default="", help="Text to be synthesized.")
    @click.option(
        "--tts-voice", default="en-US-AnaNeural", help="Voice to use for TTS synthesis."
    )
    @click.option(
        "--tts-rate",
        type=click.IntRange(-100, 100),
        default=0,
        help="Speaking rate (-100 to 100).",
    )
    @click.option(
        "--output-tts-path",
        required=True,
        help="Path to save the synthesized TTS audio.",
    )
    @click.option(
        "--output-rvc-path", default="", help="Path to save the voice-converted audio."
    )
    @click.option("--pth-path", default="", help="Full path to RVC model file (.pth).")
    @click.option("--index-path", default="", help="Full path to index file (.index).")
    @_infer_opts
    def tts(**kwargs):
        """Synthesize speech with TTS and optionally apply voice conversion."""
        try:
            result = run_tts_script(**kwargs)
            click.echo(result[0])
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command()
    @click.option("--input-path", required=True, help="Path to input audio file.")
    @click.option(
        "--model",
        default="auto",
        help="UVR model key (e.g. auto, MDX23C-8KFFT-InstVoc_HQ.ckpt, htdemucs).",
    )
    @click.option("--output-dir", default="outputs", help="Output directory for stems.")
    @click.option(
        "--output-format", default="WAV", help="Output format (WAV, FLAC, MP3)."
    )
    @click.option(
        "--single-stem",
        default=None,
        help="Extract only a single stem (vocals, instrumental).",
    )
    @click.option(
        "--device", default="auto", help="Device to use (auto, cpu, or CUDA index)."
    )
    def uvr(**kwargs):
        """Separate audio into stems (vocals, instruments) using UVR."""
        try:
            result = run_uvr_script(**kwargs)
            click.echo(result)
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command()
    @click.option("--model-name", required=True, help="Name of the model to train.")
    @click.option(
        "--dataset-path", required=True, help="Path to the dataset directory."
    )
    @click.option(
        "--sample-rate",
        required=True,
        type=click.Choice(["32000", "40000", "48000"]),
        help="Target sampling rate.",
    )
    @click.option(
        "--cpu-cores",
        type=click.IntRange(1, 64),
        default=2,
        help="Number of CPU cores.",
    )
    @click.option(
        "--cut-preprocess",
        type=click.Choice(["Skip", "Simple", "Automatic"]),
        default="Automatic",
        help="Dataset cutting method.",
    )
    @click.option(
        "--process-effects",
        is_flag=True,
        default=False,
        help="Disable filters during preprocessing.",
    )
    @click.option(
        "--noise-reduction", is_flag=True, default=False, help="Enable noise reduction."
    )
    @click.option(
        "--noise-reduction-strength",
        type=click.FloatRange(0, 1),
        default=0.7,
        help="Noise reduction filter strength.",
    )
    @click.option("--chunk-len", default="3.0", help="Chunk length in seconds.")
    @click.option("--overlap-len", default="0.3", help="Overlap length.")
    @click.option(
        "--normalization-mode",
        type=click.Choice(["none", "pre", "post"]),
        default="none",
        help="Normalization mode.",
    )
    def preprocess(**kwargs):
        """Preprocess a dataset for training."""
        kwargs["sample_rate"] = int(kwargs["sample_rate"])
        kwargs["noise_reduction_strength"] = float(kwargs["noise_reduction_strength"])
        kwargs["chunk_len"] = float(kwargs["chunk_len"])
        kwargs["overlap_len"] = float(kwargs["overlap_len"])
        kwargs["cpu_cores"] = kwargs.get("cpu_cores") or 1
        result = run_preprocess_script(
            model_name=kwargs["model_name"],
            dataset_path=kwargs["dataset_path"],
            sample_rate=kwargs["sample_rate"],
            cpu_cores=kwargs["cpu_cores"],
            cut_preprocess=kwargs["cut_preprocess"],
            process_effects=kwargs["process_effects"],
            noise_reduction=kwargs["noise_reduction"],
            clean_strength=kwargs["noise_reduction_strength"],
            chunk_len=kwargs["chunk_len"],
            overlap_len=kwargs["overlap_len"],
            normalization_mode=kwargs["normalization_mode"],
        )
        click.echo(result)

    @cli.command()
    @click.option("--model-name", required=True, help="Name of the model.")
    @click.option(
        "--f0-method",
        type=click.Choice(["crepe", "crepe-tiny", "rmvpe", "fcpe", "swift"]),
        default="rmvpe",
        help="Pitch extraction method.",
    )
    @click.option(
        "--cpu-cores",
        type=click.IntRange(1, 64),
        default=2,
        help="Number of CPU cores.",
    )
    @click.option("--gpu", type=str, default="-", help="GPU device index (e.g. '0').")
    @click.option(
        "--sample-rate",
        required=True,
        type=click.Choice(["32000", "40000", "44100", "48000"]),
        help="Target sampling rate.",
    )
    @click.option(
        "--embedder-model", default="contentvec", help="Speaker embedding model."
    )
    @click.option(
        "--embedder-model-custom", default=None, help="Custom embedding model path."
    )
    @click.option(
        "--include-mutes",
        type=click.IntRange(0, 10),
        default=2,
        help="Silent files to include.",
    )
    def extract(**kwargs):
        """Extract features from a preprocessed dataset."""
        kwargs["sample_rate"] = int(kwargs["sample_rate"])
        kwargs["cpu_cores"] = kwargs.get("cpu_cores") or 1
        result = run_extract_script(
            model_name=kwargs["model_name"],
            f0_method=kwargs["f0_method"],
            cpu_cores=kwargs["cpu_cores"],
            gpu=kwargs["gpu"],
            sample_rate=kwargs["sample_rate"],
            embedder_model=kwargs["embedder_model"],
            embedder_model_custom=kwargs["embedder_model_custom"],
            include_mutes=kwargs["include_mutes"],
        )
        click.echo(result)

    @cli.command()
    @click.option("--model-name", required=True, help="Name of the model to train.")
    @click.option(
        "--vocoder",
        type=click.Choice(["HiFi-GAN", "MRF HiFi-GAN", "RefineGAN"]),
        default="HiFi-GAN",
        help="Vocoder to use.",
    )
    @click.option(
        "--checkpointing",
        is_flag=True,
        default=False,
        help="Enable memory-efficient checkpointing.",
    )
    @click.option(
        "--save-every-epoch",
        required=True,
        type=click.IntRange(1, 100),
        default=10,
        help="Save checkpoint every N epochs.",
    )
    @click.option(
        "--save-only-latest",
        is_flag=True,
        default=False,
        help="Keep only latest checkpoint.",
    )
    @click.option(
        "--save-every-weights",
        is_flag=True,
        default=True,
        help="Save weights every epoch.",
    )
    @click.option(
        "--total-epoch",
        type=click.IntRange(1, 10000),
        default=1000,
        help="Total epochs.",
    )
    @click.option(
        "--sample-rate",
        required=True,
        type=click.Choice(["32000", "40000", "48000"]),
        help="Sampling rate.",
    )
    @click.option(
        "--batch-size", type=click.IntRange(1, 50), default=8, help="Batch size."
    )
    @click.option("--gpu", type=str, default="0", help="GPU device.")
    @click.option(
        "--pretrained/--no-pretrained", default=True, help="Use pretrained model."
    )
    @click.option(
        "--custom-pretrained",
        is_flag=True,
        default=False,
        help="Custom pretrained paths.",
    )
    @click.option(
        "--g-pretrained-path", default=None, help="Pretrained generator path."
    )
    @click.option(
        "--d-pretrained-path", default=None, help="Pretrained discriminator path."
    )
    @click.option(
        "--cleanup", is_flag=True, default=False, help="Clean up previous attempt."
    )
    @click.option(
        "--cache-data-in-gpu",
        is_flag=True,
        default=False,
        help="Cache training data in GPU.",
    )
    @click.option(
        "--index-algorithm",
        type=click.Choice(["Auto", "Faiss", "KMeans"]),
        default="Auto",
        help="Index algorithm.",
    )
    def train(**kwargs):
        """Train an RVC voice model."""
        result = run_train_script(
            model_name=kwargs["model_name"],
            save_every_epoch=kwargs["save_every_epoch"],
            save_only_latest=kwargs["save_only_latest"],
            save_every_weights=kwargs["save_every_weights"],
            total_epoch=kwargs["total_epoch"],
            sample_rate=int(kwargs["sample_rate"]),
            batch_size=kwargs["batch_size"],
            gpu=kwargs["gpu"],
            pretrained=kwargs["pretrained"],
            cleanup=kwargs["cleanup"],
            index_algorithm=kwargs["index_algorithm"],
            cache_data_in_gpu=kwargs["cache_data_in_gpu"],
            custom_pretrained=kwargs["custom_pretrained"],
            g_pretrained_path=kwargs.get("g_pretrained_path"),
            d_pretrained_path=kwargs.get("d_pretrained_path"),
            vocoder=kwargs["vocoder"],
            checkpointing=kwargs["checkpointing"],
        )
        click.echo(result)

    @cli.command()
    @click.option("--model-name", required=True, help="Name of the model.")
    @click.option(
        "--index-algorithm",
        type=click.Choice(["Auto", "Faiss", "KMeans"]),
        default="Auto",
        help="Index algorithm.",
    )
    def index(**kwargs):
        """Generate an index file for an RVC model."""
        try:
            result = run_index_script(kwargs["model_name"], kwargs["index_algorithm"])
            click.echo(result)
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command(name="model-information")
    @click.option("--pth-path", required=True, help="Path to .pth model file.")
    def model_information(**kwargs):
        """Display information about a trained model."""
        try:
            run_model_information_script(kwargs["pth_path"])
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command(name="model-info")
    @click.option("--pth-path", required=True, help="Path to .pth model file.")
    def model_info_alias(**kwargs):
        """Alias for model-information."""
        try:
            run_model_information_script(kwargs["pth_path"])
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command(name="model-blender")
    @click.option("--model-name", required=True, help="Name of the fused model.")
    @click.option("--pth-path-1", required=True, help="Path to first .pth model.")
    @click.option("--pth-path-2", required=True, help="Path to second .pth model.")
    @click.option(
        "--ratio",
        type=click.Choice([str(i / 10) for i in range(11)]),
        default="0.5",
        help="Blending ratio (0.0 - 1.0).",
    )
    def model_blender(**kwargs):
        """Fuse two RVC models together."""
        try:
            msg, path = run_model_blender_script(
                kwargs["model_name"],
                kwargs["pth_path_1"],
                kwargs["pth_path_2"],
                float(kwargs["ratio"]),
            )
            click.echo(f"{msg} {path}")
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command()
    def tensorboard():
        """Launch TensorBoard for monitoring training progress."""
        try:
            run_tensorboard_script()
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command()
    @click.option(
        "--model-link",
        required=True,
        help="Direct link to model file or HuggingFace repo.",
    )
    def download(**kwargs):
        """Download a model from a provided link."""
        try:
            result = run_download_script(kwargs["model_link"])
            click.echo(result)
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command()
    @click.option(
        "--pretraineds-hifigan/--no-pretraineds-hifigan",
        default=True,
        help="Download pretrained HiFi-GAN models.",
    )
    @click.option(
        "--models/--no-models", default=True, help="Download additional models."
    )
    @click.option("--exe/--no-exe", default=True, help="Download required executables.")
    def prerequisites(**kwargs):
        """Install prerequisites for RVC."""
        try:
            result = run_prerequisites_script(
                kwargs["pretraineds_hifigan"], kwargs["models"], kwargs["exe"]
            )
            click.echo(result)
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command(name="audio-analyzer")
    @click.option("--input-path", required=True, help="Path to input audio file.")
    @click.option(
        "--save-plot-path",
        default=os.path.join(logs_path, "audio_analysis.png"),
        help="Path to save analysis spectrogram.",
    )
    def audio_analyzer(**kwargs):
        """Analyze an audio file and display information."""
        try:
            run_audio_analyzer_script(
                kwargs["input_path"],
                kwargs.get(
                    "save_plot_path", os.path.join(logs_path, "audio_analysis.png")
                ),
            )
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command(name="analyze")
    @click.option("--input-path", required=True, help="Path to input audio file.")
    @click.option(
        "--save-plot-path",
        default=os.path.join(logs_path, "audio_analysis.png"),
        help="Path to save analysis spectrogram.",
    )
    def analyze_alias(**kwargs):
        """Alias for audio-analyzer."""
        try:
            run_audio_analyzer_script(
                kwargs["input_path"],
                kwargs.get(
                    "save_plot_path", os.path.join(logs_path, "audio_analysis.png")
                ),
            )
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command(name="f0-curve")
    @click.option("--input-path", required=True, help="Path to input audio file.")
    @click.option(
        "--method",
        type=click.Choice(["crepe", "fcpe", "rmvpe", "swift"]),
        default="rmvpe",
        help="Pitch extraction method.",
    )
    @click.option(
        "--output-image",
        default=os.path.join(logs_path, "f0_curve.png"),
        help="Path to save F0 plot PNG.",
    )
    @click.option(
        "--output-txt",
        default=os.path.join(logs_path, "f0_curve.txt"),
        help="Path to save F0 curve text file.",
    )
    def f0_curve(**kwargs):
        """Extract the F0 curve of an audio file."""
        try:
            from rvc.lib.tools.f0_curve import extract_f0_curve

            image_path, txt_path = extract_f0_curve(
                kwargs["input_path"],
                kwargs["method"],
                kwargs["output_image"],
                kwargs["output_txt"],
            )
            click.echo(f"{image_path} {txt_path}")
        except Exception as e:
            click.echo(f"Error: {e}", err=True)
            sys.exit(1)

    @cli.command(name="web")
    @click.option("--port", default=3000, help="Web UI port.")
    def web_command(port):
        """Launch Applio Web UI and API server."""
        pnpm_cmd = "pnpm.cmd" if os.name == "nt" else "pnpm"
        npm_cmd = "npm.cmd" if os.name == "nt" else "npm"
        cmd = (
            [pnpm_cmd, "dev"]
            if shutil.which("pnpm") or shutil.which(pnpm_cmd)
            else [npm_cmd, "run", "dev"]
        )
        subprocess.run(cmd, cwd=current_script_directory)

    @cli.command(name="server")
    def server_command():
        """Alias for web."""
        web_command(3000)

    @cli.command(name="desktop")
    def desktop_command():
        """Launch Applio Desktop application."""
        pnpm_cmd = "pnpm.cmd" if os.name == "nt" else "pnpm"
        subprocess.run([pnpm_cmd, "desktop:dev"], cwd=current_script_directory)

    @cli.command(name="clean")
    def clean_command():
        """Clean Applio traces, caches, and temporary files."""
        js_path = os.path.join(current_script_directory, "bin", "applio.js")
        subprocess.run(["node", js_path, "clean"], cwd=current_script_directory)

    @cli.command(name="downgrade-torch")
    @click.option(
        "--cuda",
        default="cu126",
        help="CUDA wheel tag for PyTorch download (default: cu126).",
    )
    @click.option(
        "--force",
        is_flag=True,
        help="Force downgrade to PyTorch 2.7.1 regardless of detected GPU.",
    )
    def downgrade_torch_command(cuda, force):
        """Downgrade PyTorch to 2.7.1 for older NVIDIA GPUs (GTX, P104-100, Pascal/Maxwell/Volta)."""
        from rvc.lib.tools.gpu_checker import (
            check_torch_compatibility,
            downgrade_torch,
            is_legacy_nvidia_gpu,
        )

        legacy = is_legacy_nvidia_gpu()
        compat, msg, _ = check_torch_compatibility()
        if not force and compat and not legacy:
            click.echo(
                f"Your GPU is modern and current PyTorch is already compatible ({msg}). Use --force to override."
            )
            return

        click.echo("Starting PyTorch downgrade for legacy GPU compatibility...")
        success = downgrade_torch(cuda_tag=cuda)
        if success:
            click.echo("PyTorch downgrade completed successfully.")
        else:
            click.echo("PyTorch downgrade failed.", err=True)
            sys.exit(1)


def main():
    if click is not None:
        cli()
    else:
        # Fallback to interactive mode if click is missing
        if len(sys.argv) > 1 and sys.argv[1] in ["--version", "-v"]:
            print(f"Applio v{VERSION}")
        elif len(sys.argv) > 1 and sys.argv[1] in ["--help", "-h"]:
            print("Applio CLI - Voice Conversion Studio")
            print("Run 'applio' without arguments for interactive mode.")
            print("To use subcommands, install click: pip install click")
        else:
            interactive_mode()


if __name__ == "__main__":
    main()
