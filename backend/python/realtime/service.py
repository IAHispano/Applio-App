"""Repo-level entry point for the realtime engine.

The pinned engine rebuilds its pipeline on every audio connection: the model
instance is discarded when the socket closes, so each "Start Streaming"
reloads the checkpoint, the embedder and the F0 model from disk, and the first
blocks of a cold process also compile the device kernels. This adapter caches
those heavyweight modules across connections (keyed by file identity and
device). Models load only when the pinned engine handles an explicit audio
connection, after the API acquires the realtime GPU lease. Starting this
server must never construct a pipeline or capture CUDA graphs in a background
thread: that can overlap training or the live connection's own warmup.
Request handling stays in the pinned engine; this module re-exports its app.
"""

import os
import sys
import threading
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


def _boot():
    try:
        _install_caches()
    except Exception:
        traceback.print_exc()


_boot()
