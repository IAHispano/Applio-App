"""Roformer-family separator (Mel-Band / BS-Roformer .ckpt + yaml configs)."""

import os

import soundfile as sf
import torch
import torch.nn.functional as F
import yaml

from uvr.base import BaseSeparator
from uvr.roformer_lib.registry import resolve as resolve_variant_class


def load_config(config_path):
    with open(config_path, encoding="utf-8") as f:
        return yaml.load(f, Loader=yaml.FullLoader)


def load_weights(model, ckpt_path):
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


def _windowing_array(window_size, fade_size):
    if fade_size <= 0:
        return torch.ones(window_size)
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
        load_weights(model, self.model_path)
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
        mix_tensor = torch.from_numpy(mix).to(dtype=torch.float32)

        chunk_size = self.chunk_size
        fade_size = chunk_size // 10
        step = max(1, chunk_size // self.overlap)
        border = chunk_size - step
        length_init = mix_tensor.shape[-1]
        windowing_array = _windowing_array(chunk_size, fade_size)

        if length_init > 2 * border and border > 0:
            mix_tensor = F.pad(mix_tensor, (border, border), mode="reflect")

        results = {}
        counter = torch.zeros(mix_tensor.shape[-1])
        order = []
        selected_indices = []

        with torch.inference_mode():
            i = 0
            batch_data = []
            batch_locations = []
            denoise: bool = self.enable_denoise
            with self.inference_progress(
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
                        # Single-target architectures return (batch, channels, samples).
                        if x.ndim == 3:
                            x = x.unsqueeze(1)
                        if x.ndim != 4 or x.shape[0] != len(batch_locations):
                            raise ValueError(
                                f"Invalid Roformer output shape: {tuple(x.shape)}"
                            )
                        if not order:
                            order = self._stem_names(x.shape[1])
                            selected_indices = [
                                idx
                                for idx, name in enumerate(order)
                                if not self.output_single_stem
                                or name.lower() == self.output_single_stem.lower()
                                or (
                                    len(order) == 1
                                    and self.output_single_stem.lower()
                                    == self.counterpart.lower()
                                )
                            ]
                            if not selected_indices:
                                raise ValueError(
                                    f"Unknown output stem: {self.output_single_stem}"
                                )
                            for idx in selected_indices:
                                results[order[idx]] = torch.zeros_like(mix_tensor)
                        # Keep duration-scaled storage on CPU and allocate only requested stems.
                        x = x[:, selected_indices].detach().cpu()
                        for j, (start, seg_len) in enumerate(batch_locations):
                            window = windowing_array
                            if self.overlap == 1:
                                window = torch.ones_like(windowing_array)
                            elif start == 0 or start + seg_len == mix_tensor.shape[-1]:
                                window = windowing_array.clone()
                                if start == 0:
                                    window[:fade_size] = 1
                                if start + seg_len == mix_tensor.shape[-1]:
                                    window[max(0, seg_len - fade_size) : seg_len] = 1
                            counter[start : start + seg_len] += window[:seg_len]
                            for idx, source_idx in enumerate(selected_indices):
                                stem = x[j, idx, ..., :seg_len]
                                if stem.shape[0] == 1:
                                    stem = stem.expand(2, -1)
                                results[order[source_idx]][
                                    ..., start : start + seg_len
                                ] += (stem * window[:seg_len])

                        batch_data.clear()
                        batch_locations.clear()
                    progress_bar.update(min(step, mix_tensor.shape[-1] - (i - step)))

        stems = {}
        for name, result in results.items():
            with torch.inference_mode():
                result.div_(counter.clamp_min(torch.finfo(counter.dtype).tiny))
            source = result.numpy()
            if length_init > 2 * border and border > 0:
                source = source[..., border:-border]
            stems[name] = source

        if len(order) == 1 and (
            not self.output_single_stem
            or self.output_single_stem.lower() == self.counterpart.lower()
        ):
            only = order[0]
            stems[self.counterpart] = mix - stems[only]

        output_files = []
        for stem_name, source in stems.items():
            if self.should_output_stem(stem_name):
                output_files.append(
                    self.save_stem(stem_name, source.T, custom_output_names)
                )

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
