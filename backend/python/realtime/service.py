"""Repo-level entry point for the realtime engine.

The pinned engine rebuilds its pipeline on every audio connection: the model
instance is discarded when the socket closes, so each "Start Streaming"
reloads the checkpoint, the embedder and the F0 model from disk, and the first
blocks of a cold process also compile the device kernels. This adapter caches
those heavyweight modules across connections (keyed by file identity and
device) and preloads the pipeline in a background thread right after the
engine starts, using the last realtime settings saved by the app. Request
handling stays in the pinned engine; this module only re-exports its app.

Set APPLIO_REALTIME_PREWARM=0 to keep the caches but skip the startup load.
"""

import os
import sys
import threading
import time
import traceback
from pathlib import Path

_code_root = Path(__file__).resolve().parents[3]
_backend_root = (
    Path(os.environ["APPLIO_BACKEND_ROOT"])
    if os.environ.get("APPLIO_BACKEND_ROOT")
    else _code_root / "backend" / "applio"
)
for _entry in (str(_backend_root), str(_code_root)):
    if _entry not in sys.path:
        sys.path.insert(0, _entry)

from rvc.realtime import client  # noqa: E402

app = client.app

_MISSING = object()
_LOCK = threading.RLock()


class _RecentCache:
    """Keeps the most recently used entries for one kind of resource."""

    def __init__(self, limit: int = 2):
        self._limit = limit
        self._entries = {}
        self._order = []

    def get(self, key):
        with _LOCK:
            if key not in self._entries:
                return _MISSING
            self._order.remove(key)
            self._order.append(key)
            return self._entries[key]

    def put(self, key, value):
        with _LOCK:
            self._entries[key] = value
            if key in self._order:
                self._order.remove(key)
            self._order.append(key)
            while len(self._order) > self._limit:
                self._entries.pop(self._order.pop(0), None)


_key_locks = {}


def _key_lock(key):
    with _LOCK:
        lock = _key_locks.get(key)
        if lock is None:
            lock = _key_locks[key] = threading.Lock()
        return lock


def _file_identity(path):
    try:
        name = os.path.normcase(os.path.abspath(os.fspath(path)))
        info = os.stat(name)
    except (OSError, TypeError, ValueError):
        return (str(path), 0, 0)
    return (name, info.st_mtime_ns, info.st_size)


def _cached(original, cache, key_of, label, prepare=None):
    """Memoizes a heavyweight constructor; concurrent misses share one load."""

    def load(*args, **kwargs):
        key = key_of(*args, **kwargs)
        value = cache.get(key)
        if value is not _MISSING:
            return value
        with _key_lock((label, key)):
            value = cache.get(key)
            if value is not _MISSING:
                return value
            value = original(*args, **kwargs)
            if prepare is not None:
                prepare(value)
            cache.put(key, value)
            return value

    return load


_STRIP_MARK = "_applio_parametrizations_stripped"
_installed = False


def _install_caches():
    """Keep checkpoints, embedders and F0 models loaded between connections."""
    global _installed
    if _installed:
        return
    _installed = True

    from rvc.realtime import configuration, pipeline

    original_strip = pipeline.strip_parametrizations

    def strip_once(module):
        # Parametrization removal is one-shot; a cached module must not be
        # stripped again (PyTorch raises on the second attempt).
        if getattr(module, _STRIP_MARK, False):
            return
        with _LOCK:
            if getattr(module, _STRIP_MARK, False):
                return
            original_strip(module)
            setattr(module, _STRIP_MARK, True)

    def prepare_embedding(module):
        strip_once(module)
        try:
            module.to(pipeline.inference_config().device).eval()
        except Exception:
            traceback.print_exc()

    converter = _cached(
        pipeline.RealtimeVoiceConverter,
        _RecentCache(2),
        lambda weight_root, device=None: (
            *_file_identity(weight_root),
            str(device or ""),
        ),
        "voice",
    )
    pipeline.RealtimeVoiceConverter = converter
    configuration.RealtimeVoiceConverter = converter

    embedding = _cached(
        pipeline.load_embedding,
        _RecentCache(2),
        lambda embedder_model, custom_embedder=None: (
            str(embedder_model),
            str(custom_embedder or ""),
        ),
        "embedder",
        prepare_embedding,
    )
    pipeline.load_embedding = embedding
    configuration.load_embedding = embedding
    pipeline.strip_parametrizations = strip_once
    configuration.strip_parametrizations = strip_once

    setup_f0 = _cached(
        pipeline.Realtime_Pipeline.setup_f0,
        _RecentCache(2),
        lambda self, f0_method="fcpe": (
            str(f0_method),
            str(self.device),
            int(self.sample_rate),
            int(self.window),
            bool(self.use_f0),
        ),
        "f0",
    )
    pipeline.Realtime_Pipeline.setup_f0 = setup_f0


def _float(settings, key, default):
    try:
        return float(settings.get(key, default))
    except (TypeError, ValueError):
        return float(default)


def _saved_settings():
    try:
        from rvc.lib.user_config import load_config

        saved = load_config().get("realtime")
    except Exception:
        return None
    return saved if isinstance(saved, dict) else None


def _warm_options(saved):
    """Map the app's saved realtime settings onto engine init parameters."""
    model = str(saved.get("model_file") or "").strip()
    if not model:
        return None
    auto = bool(saved.get("auto_chunk", True))
    chunk_ms = _float(saved, "chunk_ms", 30.0)
    if auto or chunk_ms <= 0:
        chunk_ms = 100.0
    return {
        "block_frame": max(480, min(48000, round(chunk_ms * 48))),
        "cross_fade_overlap_size": _float(saved, "cross_fade_overlap_size", 0.05),
        "extra_convert_size": _float(saved, "extra_convert_size", 2.5),
        "model_path": model,
        "index_path": str(saved.get("index_file") or "").strip(),
        "f0_method": str(saved.get("f0_method") or "fcpe"),
        "embedder_model": str(saved.get("embedder_model") or "contentvec"),
        "embedder_model_custom": str(saved.get("embedder_model_custom") or ""),
        "silent_threshold": int(_float(saved, "silent_threshold", -60.0)),
        "vad_enabled": bool(saved.get("vad_enabled", True)),
        "vad_sensitivity": 1,
        "vad_frame_ms": 30,
        "sid": int(_float(saved, "sid", 0.0)),
        "formant_shifting": bool(saved.get("formant_shifting", False)),
        "formant_qfrency": _float(saved, "formant_qfrency", 1.0),
        "formant_timbre": _float(saved, "formant_timbre", 1.0),
    }


def _warmup_options(saved):
    return {
        "f0_up_key": int(_float(saved, "pitch", 0.0)),
        "index_rate": _float(saved, "index_rate", 0.0),
        "protect": _float(saved, "protect", 0.5),
        "volume_envelope": _float(saved, "volume_envelope", 1.0),
        "f0_autotune": bool(saved.get("autotune", False)),
        "f0_autotune_strength": _float(saved, "autotune_strength", 1.0),
        "proposed_pitch": bool(saved.get("proposed_pitch", False)),
        "proposed_pitch_threshold": _float(saved, "proposed_pitch_threshold", 155.0),
    }


def _prewarm():
    try:
        _prewarm_inner()
    except Exception:
        traceback.print_exc()


def _prewarm_inner():
    saved = _saved_settings()
    if not saved:
        return
    options = _warm_options(saved)
    if options is None:
        return
    if client.vc_instance is not None or client.active_audio_ws is not None:
        return

    import torch
    from rvc.realtime.core import AUDIO_SAMPLE_RATE
    from rvc.realtime.utils.chunks import automatic_block_frame

    warmup_options = _warmup_options(saved)
    started = time.perf_counter()
    print(
        f"[prewarm] Loading realtime model: {options['model_path']}",
        flush=True,
    )
    instance = None
    try:
        instance = client.VoiceChanger(**options)
        if client.vc_instance is not None or client.active_audio_ws is not None:
            # A stream started while the model was loading; the caches still
            # shave that load off the next connection.
            return
        decoder = instance.vc_model.pipeline.vc
        decoder.decoder_fp16 = bool(
            saved.get("decoder_fp16", False)
        ) and decoder.vocoder in ("HiFi-GAN", "MRF HiFi-GAN")
        warmup_ms = instance.warmup(**warmup_options)
        if bool(saved.get("auto_chunk", True)):
            # Mirror the connection handler so the final block size is warm.
            block_frame = options["block_frame"]
            for _ in range(3):
                needed = automatic_block_frame(warmup_ms, AUDIO_SAMPLE_RATE)
                if needed <= block_frame:
                    break
                block_frame = needed
                instance.block_frame = block_frame
                instance.vc_model.realloc(
                    block_frame,
                    instance.extra_frame,
                    instance.crossfade_frame,
                    instance.sola_search_frame,
                )
                instance.generate_strength()
                warmup_ms = instance.warmup(**warmup_options)
        print(
            f"[prewarm] Realtime model ready in {time.perf_counter() - started:.1f}s.",
            flush=True,
        )
    finally:
        if instance is not None:
            del instance
            torch.cuda.empty_cache()


def _boot():
    try:
        _install_caches()
    except Exception:
        traceback.print_exc()
    if os.environ.get("APPLIO_REALTIME_PREWARM", "1") == "0":
        return
    try:
        threading.Thread(target=_prewarm, name="realtime-prewarm", daemon=True).start()
    except Exception:
        traceback.print_exc()


_boot()
