"""Roformer implementation registry: variant key -> (module, class).

Mirrors the dispatch in mvsepless' inference loader (plain, windowed,
conformer, SW/FNO/HyperACE/conditional/siamese variants). Custom user
architectures live in the data folder ``rvc/models/uvr/custom_architectures/``
— see the README.md in this directory.
"""

import importlib
import importlib.util
import os

# variant key -> (module path inside uvr.roformer, class name)
BUILTIN_VARIANTS = {
    "mel_band": ("mel_band_roformer", "MelBandRoformer"),
    "bs": ("bs_roformer", "BSRoformer"),
    "windowed": ("windowed_model", "MelBandRoformerWSA"),
    "mel_conformer": ("mel_band_conformer", "MelBandConformer"),
    "bs_conformer": ("bs_conformer", "BSConformer"),
    "sw": ("bs_roformer_sw", "BSRoformer_SW"),
    "fno": ("bs_roformer_fno", "BSRoformer_FNO"),
    "hyperace": ("bs_roformer_hyperace", "BSRoformerHyperACE"),
    "hyperace2": ("bs_roformer_hyperace2", "BSRoformerHyperACE_2"),
    "conditional": ("bs_roformer_conditional", "BSRoformer_Conditional"),
    "siamese": ("bs_siamese_roformer", "BSSiameseRoformer"),
    "unwa_inst_large_2": ("bs_roformer_unwa_inst_large_2", "BSRoformer_2"),
}

# Official families are the model_type keys shipped by ZFTurbo's
# Music-Source-Separation-Training (bs_roformer / mel_band_roformer +
# the two conformers inside models/bs_roformer.py). Every other builtin is
# a community fork vendored here so catalog weights load.
OFFICIAL_VARIANTS = frozenset({"bs", "mel_band", "bs_conformer", "mel_conformer"})

CUSTOM_DIR = "custom_architectures"


def _load_custom_variants():
    """Scan rvc/models/uvr/custom_architectures/*.py under the data root.

    The process runs with the app data root as its working directory (the
    repository root in development), where user files survive updates. Files
    are imported by path, so user code stays with user data instead of the
    read-only installed engine tree. Contract: the module must define
    ``MODEL_CLASS`` (an nn.Module whose forward takes
    ``(batch, channels, samples)`` waveforms and returns stems) and may
    define ``VARIANT_KEY`` (defaults to the file stem).
    """
    from uvr import OUTPUT_MODELS_DIRNAME

    found = {}
    custom_dir = os.path.join(os.getcwd(), OUTPUT_MODELS_DIRNAME, CUSTOM_DIR)
    if not os.path.isdir(custom_dir):
        return {}
    for fname in sorted(os.listdir(custom_dir)):
        if not fname.endswith(".py") or fname.startswith("_"):
            continue
        stem = fname[:-3]
        try:
            spec = importlib.util.spec_from_file_location(
                f"uvr_custom_arch.{stem}", os.path.join(custom_dir, fname)
            )
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
        except Exception:
            continue
        cls = getattr(module, "MODEL_CLASS", None)
        if cls is None:
            continue
        found[getattr(module, "VARIANT_KEY", stem)] = cls
    return found


def resolve(variant_key):
    """Return the model class for a variant key (builtin or custom)."""
    custom = _load_custom_variants()
    if variant_key in custom:
        return custom[variant_key]
    if variant_key not in BUILTIN_VARIANTS:
        raise ValueError(
            f"Unknown Roformer variant '{variant_key}'. "
            f"Builtins: {', '.join(sorted(BUILTIN_VARIANTS))}. "
            f"Add custom architectures to rvc/models/uvr/{CUSTOM_DIR}/ (see README.md)."
        )
    module_path, class_name = BUILTIN_VARIANTS[variant_key]
    module = importlib.import_module(f"uvr.roformer_lib.{module_path}")
    return getattr(module, class_name)


def available_variants():
    custom = _load_custom_variants()
    return sorted({*BUILTIN_VARIANTS, *custom})
