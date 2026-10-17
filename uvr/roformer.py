"""Roformer-family separator (Mel-Band / BS-Roformer .ckpt + yaml configs)."""

import os

import numpy as np
import soundfile as sf
import torch
import torch.nn.functional as F
import yaml
from tqdm import tqdm

from uvr.base import BaseSeparator
from uvr.roformer_lib.registry import resolve as resolve_variant_class


def load_config(config_path):
    with open(config_path, encoding="utf-8") as f:
        return yaml.load(f, Loader=yaml.FullLoader)


def load_weights(model, ckpt_path, logger=None):
    try:
        state = torch.load(ckpt_path, map_location="cpu", weights_only=True)
    except Exception:
        state = torch.load(ckpt_path, map_location="cpu", weights_only=False)
    for wrapper in ("state", "state_dict", "model_state_dict"):
        if isinstance(state, dict) and wrapper in state:
            state = state[wrapper]
    if isinstance(state, dict):
        state = {
            k.replace("module.", "") if k.startswith("module.") else k: v
            for k, v in state.items()
        }
    model.load_state_dict(state, strict=True)
    return model


def _getWindowingArray(window_size, fade_size):
    fadein = torch.linspace(0, 1, fade_size)
    fadeout = torch.linspace(1, 0, fade_size)
    window = torch.ones(window_size)
    window[-fade_size:] = fadeout
    window[:fade_size] = fadein
    return window


class RoformerSeparator(BaseSeparator):
    def __init__(self, common_config, arch_config: dict):
        super().__init__(config=common_config)
        self.roformer_class = common_config.get("roformer_class", "mel_band")
        model_cls = resolve_variant_class(self.roformer_class)
        self.config_path = common_config.get("roformer_config")
        if not self.config_path or not os.path.isfile(self.config_path):
            raise ValueError(f"Roformer config not found: {self.config_path}")

        cfg = load_config(self.config_path)
        self.cfg_audio = cfg.get("audio", {})
        self.cfg_infer = cfg.get("inference", {})
        training = cfg.get("training", {}) or {}
        self.instruments = [str(s) for s in training.get("instruments", [])]
        self.target = str(
            training.get("target_instrument")
            or (self.instruments[0] if self.instruments else "vocals")
        )
        others = [s for s in self.instruments if s.lower() != self.target.lower()]
        self.counterpart = others[0] if others else self.secondary_stem(self.target)
        self.primary_stem_name = self.target
        self.secondary_stem_name = self.counterpart

        self.sample_rate = int(self.cfg_audio.get("sample_rate", 44100))
        chunk_seconds = arch_config.get("chunk_seconds")
        if chunk_seconds:
            self.chunk_size = max(1, int(float(chunk_seconds) * self.sample_rate))
        else:
            self.chunk_size = int(self.cfg_audio.get("chunk_size", 352800))
        overlap_override = arch_config.get("overlap")
        if overlap_override:
            self.overlap = max(1, int(overlap_override))
        else:
            self.overlap = max(1, int(self.cfg_infer.get("num_overlap", 2)))
        self.batch_size = max(1, int(arch_config.get("batch_size", 1) or 1))
        self.enable_denoise = arch_config.get("enable_denoise", False)

        model_kwargs = dict(cfg.get("model", {}) or {})
        self.logger.debug(
            f"Roformer {self.roformer_class} kwargs: {sorted(model_kwargs)}"
        )
        model = model_cls(**model_kwargs)
        load_weights(model, self.model_path, self.logger)
        model.to(self.torch_device)
        model.eval()
        self.model_run = model
        self.logger.info(
            f"Roformer separator initialised ({self.roformer_class}, target: {self.target})"
        )

    def separate(self, audio_file_path, custom_output_names=None):
        self.primary_source = None
        self.secondary_source = None
        self.audio_file_path = audio_file_path
        self.audio_file_base = os.path.splitext(os.path.basename(audio_file_path))[0]

        try:
            self.input_bit_depth = (
                24 if "24" in sf.info(audio_file_path).subtype else 16
            )
        except Exception:
            self.input_bit_depth = 16

        mix = self.prepare_mix(self.audio_file_path)
        mix_tensor = torch.tensor(mix, dtype=torch.float32)

        chunk_size = self.chunk_size
        fade_size = chunk_size // 10
        step = max(1, chunk_size // self.overlap)
        border = chunk_size - step
        length_init = mix_tensor.shape[-1]
        windowing_array = _getWindowingArray(chunk_size, fade_size)

        if length_init > 2 * border and border > 0:
            mix_tensor = F.pad(mix_tensor, (border, border), mode="reflect")

        results = {}
        counters = {}
        order = []

        with torch.inference_mode():
            i = 0
            batch_data = []
            batch_locations = []
            denoise: bool = self.enable_denoise
            with tqdm(
                total=mix_tensor.shape[1], desc="Separating", unit="samples"
            ) as progress_bar:
                while i < mix_tensor.shape[1]:
                    part = mix_tensor[:, i : i + chunk_size]
                    chunk_len = part.shape[-1]
                    pad_mode = "reflect" if chunk_len > chunk_size // 2 else "constant"
                    part = F.pad(
                        part, (0, chunk_size - chunk_len), mode=pad_mode, value=0
                    )
                    batch_data.append(part)
                    batch_locations.append((i, chunk_len))
                    i += step

                    if len(batch_data) >= self.batch_size or i >= mix_tensor.shape[1]:
                        arr = torch.stack(batch_data, dim=0).to(self.torch_device)
                        if denoise:
                            x1 = self.model_run(arr)
                            x2 = self.model_run(-arr)
                            x = (x1 + -x2) * 0.5
                        else:
                            x = self.model_run(arr)
                        x = x.detach().cpu()

                        if not order:
                            order = self._stem_names(x.shape[1])
                            for name in order:
                                results[name] = torch.zeros_like(mix_tensor)
                                counters[name] = torch.zeros_like(mix_tensor)

                        window = windowing_array.clone()
                        if i - step == 0:
                            window[:fade_size] = 1
                        elif i >= mix_tensor.shape[1]:
                            window[-fade_size:] = 1

                        for j, (start, seg_len) in enumerate(batch_locations):
                            for idx, name in enumerate(order):
                                stem = x[j, idx, ..., :seg_len]
                                if stem.shape[0] == 1:
                                    stem = stem.repeat(2, 1)
                                results[name][..., start : start + seg_len] += (
                                    stem * window[..., :seg_len]
                                )
                                counters[name][..., start : start + seg_len] += window[
                                    ..., :seg_len
                                ]

                        batch_data.clear()
                        batch_locations.clear()
                    progress_bar.update(step)

        stems = {}
        for name in order:
            source = (results[name] / counters[name]).detach().cpu().numpy()
            np.nan_to_num(source, copy=False, nan=0.0)
            if length_init > 2 * border and border > 0:
                source = source[..., border:-border]
            stems[name] = source

        if len(order) == 1:
            only = order[0]
            stems[self.counterpart] = mix - stems[only]

        output_files = []
        for stem_name, source in stems.items():
            if (
                self.output_single_stem
                and self.output_single_stem.lower() != stem_name.lower()
            ):
                continue
            stem_path = self.get_stem_output_path(stem_name, custom_output_names)
            self.logger.info(f"Saving {stem_name} stem to {stem_path}...")
            self.final_process(stem_path, source.T, stem_name)
            output_files.append(stem_path)

        return output_files

    def _stem_names(self, n_stems):
        if self.instruments and len(self.instruments) == n_stems:
            return list(self.instruments)
        if n_stems == 1:
            return [self.target]
        if n_stems == 2:
            return [self.target, self.counterpart]
        raise ValueError(
            f"Roformer model produced {n_stems} stems but the config lists "
            f"{self.instruments}; cannot name the outputs."
        )
