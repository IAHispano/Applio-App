"""Applio UVR orchestrator: model download, arch dispatch, single-file separation."""

import hashlib
import importlib
import json
import logging
import os
import sys

from uvr import OUTPUT_MODELS_DIRNAME
from uvr import models as catalog

ARCH_CLASSES = {
    "vr": ("uvr.vr", "VrSeparator"),
    "mdx": ("uvr.mdx", "MdxSeparator"),
    "demucs": ("uvr.demucs", "DemucsSeparator"),
    "roformer": ("uvr.roformer", "RoformerSeparator"),
    "mdxc": ("uvr.mdxc", "MdxcSeparator"),
}


def _resolve_model(model_key):
    model = catalog.resolve(model_key)
    if model is None:
        raise ValueError(
            f"Unknown UVR model '{model_key}'. Available: {', '.join(sorted(catalog.BY_KEY))}"
        )
    return model


def _md5(path):
    size = os.path.getsize(path)
    with open(path, "rb") as f:
        # 10,240,000 bytes
        if size >= 10000 * 1024:
            # Move the file pointer 10MB before the end of the file
            f.seek(size - 10000 * 1024)
        return hashlib.md5(f.read()).hexdigest()


def _yaml_in_dir(model_dir):
    yamls = sorted(f for f in os.listdir(model_dir) if f.endswith((".yaml", ".yml")))
    return os.path.join(model_dir, yamls[0]) if yamls else None


def _model_data_for(arch, weight_path):
    """Resolve arch params: yaml-driven archs read their config, VR/MDX look up the vendored hash tables."""
    here = os.path.dirname(os.path.abspath(__file__))
    if arch in ("demucs", "roformer", "mdxc"):
        import yaml

        yaml_path = _yaml_in_dir(os.path.dirname(weight_path))
        if yaml_path:
            with open(yaml_path, encoding="utf-8") as f:
                data = yaml.load(f, Loader=yaml.FullLoader) or {}
            training = data.get("training", {}) or {}
            instruments = [str(s) for s in training.get("instruments", [])]
            target = training.get("target_instrument") or (
                instruments[0] if instruments else "Vocals"
            )
            data.setdefault("primary_stem", target)
            return data
        return {"primary_stem": "Vocals"}
    digest = _md5(weight_path)
    table_file = os.path.join(
        here, "vr_model_data.json" if arch == "vr" else "mdx_model_data.json"
    )
    with open(table_file, encoding="utf-8") as f:
        table = json.load(f)
    if digest not in table:
        raise ValueError(
            f"Unsupported {arch.upper()} weights: MD5 {digest} not in the vendored model data table."
        )
    return table[digest]


def _default_arch_params(arch):
    if arch == "vr":
        return {
            "batch_size": 1,
            "window_size": 512,
            "aggression": 5,
            "enable_tta": False,
            "enable_post_process": False,
            "post_process_threshold": 0.2,
            "high_end_process": False,
        }
    if arch == "mdx":
        return {
            "hop_length": 1024,
            "segment_size": 256,
            "overlap": 0.25,
            "batch_size": 1,
            "enable_denoise": False,
        }
    if arch == "mdxc":
        return {
            "segment_size": 256,
            "override_model_segment_size": False,
            "batch_size": None,
            "overlap": None,
            "pitch_shift": 0,
        }
    if arch == "demucs":
        return {
            "segment_size": "Default",
            "shifts": 2,
            "overlap": 0.25,
            "segments_enabled": True,
        }
    return {}


def ensure_model_files(model, models_dir=None, logger=None):
    """Download or verify every catalog file of a model. Returns its models dir."""
    models_dir = models_dir or os.path.join(
        os.getcwd(), OUTPUT_MODELS_DIRNAME, model.key
    )
    os.makedirs(models_dir, exist_ok=True)
    print("APPLIO_STAGE:Downloading models…", file=sys.stderr, flush=True)
    for filename, url in model.files:
        model_path = os.path.join(models_dir, filename)
        if url is None:
            # Local-only catalog entry: weights must already be in place.
            if not (os.path.isfile(model_path) and os.path.getsize(model_path) > 0):
                raise ValueError(
                    f"Local model file missing: {model_path}. "
                    "Place the model file there (its catalog URL is null) and re-run."
                )
            if logger:
                logger.debug(f"Local model file already present: {model_path}")
            continue
        if os.path.isfile(model_path) and os.path.getsize(model_path) > 0:
            continue
        from rvc.lib.tools.http_download import download_http
        from tqdm import tqdm

        with tqdm(unit="B", unit_scale=True, desc=filename) as bar:

            def progress(received, total):
                bar.total = total or None
                bar.n = received
                bar.refresh()

            download_http(url, model_path, progress=progress)
    return models_dir


def fetch_model(model_key, logger=None):
    """Resolve a catalog entry, ensure its files (download if needed) and report
    yaml-derived stems, patching them back into custom_models.json.

    Used by ``uvr/separate.py --fetch-only``: the Rust import route starts a
    job with this flag so link imports show download progress as jobs.
    """
    logger = logger or logging.getLogger("uvr")
    model = _resolve_model(model_key)
    models_dir = ensure_model_files(model, None, logger)
    info = {"key": model.key, "files": [name for name, _ in model.files]}
    if model.arch in ("roformer", "mdxc", "demucs"):
        data = _model_data_for(model.arch, os.path.join(models_dir, model.files[0][0]))
        training = data.get("training") or {}
        stems = [str(stem) for stem in training.get("instruments") or []]
        if stems:
            info["stems"] = stems
            info["target"] = data.get("primary_stem") or stems[0]
            catalog.patch_custom_entry(model.key, stems, info["target"])
    info["filename"] = info["files"][0]
    return info


def _stem_labels(model, separator):
    if model.arch == "demucs":
        return list(model.stems)
    labels = [separator.primary_stem_name, separator.secondary_stem_name]
    if model.arch == "mdxc":
        labels = [*separator.model_data_cfg.training.instruments, *labels]
    elif model.arch == "roformer":
        labels = [*(getattr(separator, "instruments", None) or []), *labels]
    return list(dict.fromkeys(labels))


def separate_stems(
    input_path,
    model_key,
    models_dir=None,
    output_dir=None,
    output_format="wav",
    use_gpu=True,
    single_stem="all",
    arch_overrides=None,
    logger=None,
):
    """Separate one audio file. Returns {stem_name: absolute_path}."""
    logger = logger or logging.getLogger("uvr")
    model = _resolve_model(model_key)
    models_dir = ensure_model_files(model, models_dir, logger)

    output_dir = os.path.abspath(output_dir) if output_dir else None
    # Imports and model construction happen only in the scheduled inference process.
    from uvr.base import select_onnx_providers, select_torch_device

    torch_device = select_torch_device(use_gpu)
    logger.info(f"Separating with {model.label} on {torch_device}...")

    weight_path = os.path.join(models_dir, model.files[0][0])
    roformer_config = None
    if model.arch == "demucs":
        # Demucs loads from its yaml config (weights resolved beside it).
        yaml_path = _yaml_in_dir(models_dir)
        if not yaml_path:
            raise ValueError(
                f"Demucs model '{model.key}' is missing its yaml config in {models_dir}."
            )
        weight_path = yaml_path
    elif model.arch in ("roformer", "mdxc"):
        yaml_path = _yaml_in_dir(models_dir)
        if not yaml_path:
            raise ValueError(
                f"Model '{model.key}' is missing its yaml config in {models_dir}."
            )
        roformer_config = yaml_path
    model_data = _model_data_for(model.arch, weight_path)
    common_config = {
        "logger": logger,
        "torch_device": torch_device,
        "onnx_execution_provider": select_onnx_providers(
            use_gpu and torch_device.type == "cuda"
        ),
        "model_name": (
            model.key
            if model.arch in ("demucs", "roformer")
            else model.files[0][0].rsplit(".", 1)[0]
        ),
        "model_path": weight_path,
        "model_data": model_data,
        "roformer_class": model.cls,
        "roformer_config": roformer_config,
        "output_dir": output_dir,
        "output_format": output_format,
        "normalization_threshold": 0.9,
        "amplification_threshold": 0.0,
        "output_single_stem": (
            None if str(single_stem).lower() == "all" else single_stem
        ),
        "sample_rate": 44100,
    }
    arch_params = _default_arch_params(model.arch)
    if arch_overrides:
        arch_params = {
            **arch_params,
            **{k: v for k, v in arch_overrides.items() if v is not None},
        }
    print("APPLIO_STAGE:Loading models…", file=sys.stderr, flush=True)
    module_name, class_name = ARCH_CLASSES[model.arch]
    arch_class = getattr(importlib.import_module(module_name), class_name)
    arch = arch_class(common_config, arch_params)
    try:
        print("APPLIO_STAGE:Separating…", file=sys.stderr, flush=True)
        paths = arch.separate(input_path)
    finally:
        try:
            arch.clear_gpu_cache()
        except Exception:
            pass

    labels = _stem_labels(model, arch)
    stems = {}
    for path in paths:
        # Archs return paths relative to output_dir; resolve to absolute.
        full = (
            path
            if os.path.isabs(path)
            else os.path.join(output_dir or os.getcwd(), path)
        )
        base = os.path.basename(full)
        lowered_base = base.lower()
        match = next((s for s in labels if f"_({s.lower()})_" in lowered_base), None)
        stems[match or os.path.splitext(base)[0]] = os.path.abspath(full)
    logger.info(f"Separation complete: {len(stems)} stems.")
    return stems
