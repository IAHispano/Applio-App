import os
import sys
import json
import traceback

now_dir = os.getcwd()
if now_dir not in sys.path:
    sys.path.append(now_dir)

# Keep a reference to real standard streams before redirection
real_stdout = sys.stdout
real_stderr = sys.stderr

active_job_id = None


def get_active_job_id():
    return active_job_id


class IPCStdoutRedirector:
    def __init__(self, target, job_id_fn):
        self.target = target
        self.job_id_fn = job_id_fn
        self.buffer = ""

    def write(self, s):
        if not s:
            return
        self.buffer += s
        while "\n" in self.buffer:
            line, self.buffer = self.buffer.split("\n", 1)
            line = line.strip()
            if line:
                send_ipc(
                    {
                        "type": "log",
                        "id": self.job_id_fn(),
                        "message": line,
                    }
                )

    def flush(self):
        if self.buffer.strip():
            send_ipc(
                {
                    "type": "log",
                    "id": self.job_id_fn(),
                    "message": self.buffer.strip(),
                }
            )
        self.buffer = ""


def send_ipc(data: dict):
    payload = {"_applio_ipc": True, **data}
    real_stdout.write(json.dumps(payload, ensure_ascii=False) + "\n")
    real_stdout.flush()


def map_params(params: dict, input_path: str, output_path: str) -> dict:
    return {
        "pitch": int(params.get("pitch", 0)),
        "index_rate": float(params.get("indexRate", 0.75)),
        "volume_envelope": float(params.get("volumeEnvelope", 1.0)),
        "protect": float(params.get("protect", 0.5)),
        "f0_method": str(params.get("f0Method", "rmvpe")),
        "input_path": input_path,
        "output_path": output_path,
        "pth_path": params.get("pthPath", ""),
        "index_path": params.get("indexPath", "") or "",
        "split_audio": bool(params.get("splitAudio", False)),
        "f0_autotune": bool(params.get("f0Autotune", False)),
        "f0_autotune_strength": float(params.get("f0AutotuneStrength", 1.0)),
        "proposed_pitch": bool(params.get("proposedPitch", False)),
        "proposed_pitch_threshold": float(params.get("proposedPitchThreshold", 155.0)),
        "clean_audio": bool(params.get("cleanAudio", False)),
        "clean_strength": float(params.get("cleanStrength", 0.5)),
        "export_format": str(params.get("exportFormat", "WAV")),
        "embedder_model": str(params.get("embedderModel", "contentvec")),
        "embedder_model_custom": params.get("embedderModelCustom") or None,
        "formant_shifting": bool(params.get("formantShifting", False)),
        "formant_qfrency": float(params.get("formantQfrency", 1.0)),
        "formant_timbre": float(params.get("formantTimbre", 1.0)),
        "post_process": bool(params.get("postProcess", False)),
        "reverb": bool(params.get("reverb", False)),
        "pitch_shift": bool(params.get("pitchShift", False)),
        "limiter": bool(params.get("limiter", False)),
        "gain": bool(params.get("gain", False)),
        "distortion": bool(params.get("distortion", False)),
        "chorus": bool(params.get("chorus", False)),
        "bitcrush": bool(params.get("bitcrush", False)),
        "clipping": bool(params.get("clipping", False)),
        "compressor": bool(params.get("compressor", False)),
        "delay": bool(params.get("delay", False)),
        "reverb_room_size": float(params.get("reverbRoomSize", 0.5)),
        "reverb_damping": float(params.get("reverbDamping", 0.5)),
        "reverb_wet_gain": float(params.get("reverbWetGain", 0.33)),
        "reverb_dry_gain": float(params.get("reverbDryGain", 0.4)),
        "reverb_width": float(params.get("reverbWidth", 1.0)),
        "reverb_freeze_mode": float(params.get("reverbFreezeMode", 0.0)),
        "pitch_shift_semitones": float(params.get("pitchShiftSemitones", 0.0)),
        "limiter_threshold": float(params.get("limiterThreshold", -6.0)),
        "limiter_release_time": float(params.get("limiterReleaseTime", 0.05)),
        "gain_db": float(params.get("gainDb", 0.0)),
        "distortion_gain": float(params.get("distortionGain", 25.0)),
        "chorus_rate": float(params.get("chorusRate", 1.0)),
        "chorus_depth": float(params.get("chorusDepth", 0.25)),
        "chorus_center_delay": float(params.get("chorusCenterDelay", 7.0)),
        "chorus_feedback": float(params.get("chorusFeedback", 0.0)),
        "chorus_mix": float(params.get("chorusMix", 0.5)),
        "bitcrush_bit_depth": int(params.get("bitcrushBitDepth", 8)),
        "clipping_threshold": float(params.get("clippingThreshold", -6.0)),
        "compressor_threshold": float(params.get("compressorThreshold", 0.0)),
        "compressor_ratio": float(params.get("compressorRatio", 1.0)),
        "compressor_attack": float(params.get("compressorAttack", 1.0)),
        "compressor_release": float(params.get("compressorRelease", 100.0)),
        "delay_seconds": float(params.get("delaySeconds", 0.5)),
        "delay_feedback": float(params.get("delayFeedback", 0.0)),
        "delay_mix": float(params.get("delayMix", 0.5)),
        "sid": int(params.get("sid", 0)),
    }


def run_worker():
    global active_job_id

    # Install redirectors
    sys.stdout = IPCStdoutRedirector(real_stdout, get_active_job_id)
    sys.stderr = IPCStdoutRedirector(real_stdout, get_active_job_id)

    from rvc.infer.infer import VoiceConverter

    # Preload singleton VoiceConverter in background
    vc = VoiceConverter()

    send_ipc({"type": "ready", "pid": os.getpid()})

    for raw_line in sys.stdin:
        line = raw_line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except Exception as e:
            send_ipc({"type": "error", "id": None, "error": f"Invalid JSON: {e}"})
            continue

        cmd = req.get("command")
        job_id = req.get("id")
        active_job_id = job_id

        try:
            if cmd == "ping":
                send_ipc({"type": "pong", "id": job_id})
            elif cmd == "unload":
                vc.cleanup_model()
                import torch

                if torch.cuda.is_available():
                    torch.cuda.empty_cache()
                send_ipc({"type": "unloaded", "id": job_id})
            elif cmd == "infer":
                params = req.get("params", {})
                input_path = req.get("inputPath")
                output_path = req.get("outputPath")
                kwargs = map_params(params, input_path, output_path)

                export_format = kwargs.get("export_format", "WAV")
                kwargs["audio_input_path"] = kwargs.pop("input_path", input_path)
                kwargs["audio_output_path"] = kwargs.pop("output_path", output_path)
                kwargs["model_path"] = kwargs.pop("pth_path", "")

                vc.convert_audio(**kwargs)
                final_out = output_path.replace(".wav", f".{export_format.lower()}")
                info_msg = f"File {input_path} inferred successfully."
                sys.stdout.flush()
                send_ipc(
                    {
                        "type": "done",
                        "id": job_id,
                        "success": True,
                        "outputPath": final_out,
                        "info": info_msg,
                    }
                )
            else:
                send_ipc(
                    {
                        "type": "error",
                        "id": job_id,
                        "error": f"Unknown command: {cmd}",
                    }
                )
        except Exception as e:
            sys.stdout.flush()
            tb = traceback.format_exc()
            send_ipc(
                {
                    "type": "error",
                    "id": job_id,
                    "error": str(e),
                    "traceback": tb,
                }
            )
        finally:
            active_job_id = None


if __name__ == "__main__":
    run_worker()
