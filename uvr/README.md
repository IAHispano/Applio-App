# Applio UVR — self-contained local stem separation

Distilled from the UVR / audio-separator / MSST ecosystem. Layout is local —
never importing those libraries — with only standard scientific Python
dependencies (`requirements-uvr.txt`: torch, onnx stack, julius,
rotary/beartype); model downloads reuse the pinned core helper
`rvc.lib.tools.http_download`, which the app provides and the repository
exposes via `backend/applio` on `PYTHONPATH`.

## Layout

```
uvr/
  separate.py      CLI entry (what the backend spawns per job); also hosts
                   --list-models, --list-variants and --fetch-only.
  separator.py     Orchestrator: download, arch dispatch, stem naming.
  models.py        Catalog (VR/MDX/MDXC/Demucs/MSST-Roformer + custom_models.json).
  base.py          Shared mix prep, soundfile writing, downloads, devices.
  spectral.py      Spectral DSP helpers.
  stft.py device.py tfc_tdf_v3.py  Shared low-level helpers.
  vr.py            VR-architecture separator (.pth).
  mdx.py           MDX separator (.onnx via onnx2torch / ONNX Runtime).
  mdxc.py          MDXC separator (.ckpt + yaml via TFC-TDF).
  demucs.py        Demucs v4 separator (+ vendored `demucs_lib/` stack).
  roformer.py      MSST Roformer separator (.ckpt + yaml, see `roformer_lib/`).
  roformer_lib/
    *.py           Vendored model classes (mel/band, BS + derived variants).
    registry.py    Variant key -> class (+ `custom/` user architectures).
    pope/          Vendored PoPE attention used by the PolarFormer models.
  demucs_lib/      Vendored Demucs v4 stack (torch-only).
  vr_net/          VR network definitions + band parameter JSONs.
  vr_model_data.json / mdx_model_data.json
                   Vendored UVR parameter tables (hash-keyed) + current-file entries.
```

## Notes

- Weights download on first use into `rvc/models/uvr/<model-key>/`, relative
  to the app data root (the repository root in development), and are reused
  afterwards. The catalog (`--list-models`) never imports torch.
- User models: entries in `rvc/models/uvr/custom_models.json` (same schema as
  `models.py`; merged at import). A `null` URL marks a local-only file: place
  the weights (and any yaml) in the model's folder yourself; separation runs
  fully offline and raises a clear error if something is missing. The audio
  separator UI imports both cases ("Import model": a direct link is turned
  into a fetch job — see `--fetch-only` — while uploaded files land directly
  in the model's folder); press "Reload models" to refresh the catalog.
- MDX parameters resolve through the vendored hash tables, extended with
  entries for the current release files (verified from each ONNX graph).
  Unknown files fail with a clear error instead of degrading silently. The
  hash gate also means VR and MDX weights from outside the official catalogs
  cannot be imported as customs; Roformer, MDX23C and Demucs are config-driven
  (yaml) and work fine.
- Roformer variants with their own architecture file (e.g. HyperACE v2)
  are first-class: drop the module into `rvc/models/uvr/custom_architectures/`
  (user data, survives updates — see the roformer_lib README) and reference it
  from a catalog entry via `cls`. The import dialog lists the available
  variant keys live (`--list-variants`).
