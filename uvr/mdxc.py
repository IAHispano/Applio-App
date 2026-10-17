"""MDXC-architecture separator (TFC-TDF .ckpt + yaml configs)."""

import os

import numpy as np
import torch
from ml_collections import ConfigDict
from tqdm import tqdm

from uvr import spectral as spec_utils
from uvr.base import BaseSeparator
from uvr.tfc_tdf_v3 import TFC_TDF_net


class MdxcSeparator(BaseSeparator):
    def __init__(self, common_config, arch_config: dict):
        super().__init__(config=common_config)
        self.logger.debug(
            f"Model data keys: {list(self.model_data.keys()) if isinstance(self.model_data, dict) else None}"
        )

        self.segment_size = arch_config.get("segment_size", 256)
        self.override_model_segment_size = arch_config.get(
            "override_model_segment_size", False
        )
        inference_config = (
            self.model_data.get("inference", {})
            if isinstance(self.model_data, dict)
            else {}
        )

        overlap = arch_config.get("overlap")
        if overlap is None:
            overlap = inference_config.get("num_overlap")
        if overlap is None:
            overlap = 8
        batch_size = arch_config.get("batch_size")
        if batch_size is None:
            batch_size = inference_config.get("batch_size")
        if batch_size is None:
            batch_size = 1
        if overlap <= 0:
            raise ValueError("MDXC overlap must be greater than zero")
        if batch_size <= 0:
            raise ValueError("MDXC batch size must be greater than zero")
        self.overlap = overlap
        self.batch_size = batch_size

        # Amount of pitch shift to apply during processing (this does NOT affect the pitch of the output audio):
        # • Whole numbers indicate semitones.
        # • Using higher pitches may cut the upper bandwidth, even in high-quality models.
        # • Upping the pitch can be better for tracks with deeper vocals.
        # • Dropping the pitch may take more processing time but works well for tracks with high-pitched vocals.
        self.pitch_shift = arch_config.get("pitch_shift", 0)

        self.process_all_stems = arch_config.get("process_all_stems", True)

        self.load_model()

        self.primary_source = None
        self.secondary_source = None
        self.audio_file_path = None
        self.audio_file_base = None

        # Only mark primary stem as main target for single-target models.
        # Multi-stem models should not trigger residual subtraction logic.
        self.is_primary_stem_main_target = bool(
            self.model_data_cfg.training.target_instrument
        )

        self.logger.info("MDXC separator initialised")

    def load_model(self):
        self.model_data_cfg = ConfigDict(self.model_data)
        self.model_run = TFC_TDF_net(self.model_data_cfg, device=self.torch_device)
        self.model_run.load_state_dict(
            torch.load(self.model_path, map_location="cpu", weights_only=True)
        )
        self.model_run.to(self.torch_device).eval()

    def separate(self, audio_file_path, custom_output_names=None):
        self.primary_source = None
        self.secondary_source = None

        self.audio_file_path = audio_file_path
        self.audio_file_base = os.path.splitext(os.path.basename(audio_file_path))[0]

        mix = self.prepare_mix(self.audio_file_path)

        # Short inputs need the configured segment size, but this automatic
        # override must not persist when the separator instance is reused.
        audio_duration_seconds = mix.shape[1] / self.sample_rate
        override_model_segment_size = self._use_model_segment_override(
            audio_duration_seconds
        )

        mix = spec_utils.normalize(
            wave=mix,
            max_peak=self.normalization_threshold,
            min_peak=self.amplification_threshold,
        )
        source = self.demix(
            mix=mix, override_model_segment_size=override_model_segment_size
        )

        output_files = []
        if isinstance(source, dict):
            stem_list = []
            if self.model_data_cfg.training.target_instrument:
                stem_list = [self.model_data_cfg.training.target_instrument]
            else:
                stem_list = self.model_data_cfg.training.instruments

            is_multi_stem_model = len(stem_list) > 2
            should_process_all_stems = self.process_all_stems and is_multi_stem_model

            if should_process_all_stems:
                self.logger.debug("Processing all stems from multi-stem model...")
                for stem_name in stem_list:
                    stem_output_path = self.get_stem_output_path(stem_name, custom_output_names)
                    stem_source = spec_utils.normalize(
                        wave=source[stem_name],
                        max_peak=self.normalization_threshold,
                        min_peak=self.amplification_threshold
                    ).T

                    self.logger.info(f"Saving {stem_name} stem to {stem_output_path}...")
                    self.final_process(stem_output_path, stem_source, stem_name)
                    output_files.append(stem_output_path)
            else:
                # Standard processing for primary and secondary stems
                if not isinstance(self.primary_source, np.ndarray):
                    self.primary_source = spec_utils.normalize(
                        wave=source[self.primary_stem_name],
                        max_peak=self.normalization_threshold,
                        min_peak=self.amplification_threshold
                    ).T

                if not isinstance(self.secondary_source, np.ndarray):
                    self.secondary_source = spec_utils.normalize(
                        wave=source[self.secondary_stem_name],
                        max_peak=self.normalization_threshold,
                        min_peak=self.amplification_threshold
                    ).T

                if not self.output_single_stem or self.output_single_stem.lower() == self.secondary_stem_name.lower():
                    self.secondary_stem_output_path = self.get_stem_output_path(self.secondary_stem_name, custom_output_names)

                    self.logger.info(f"Saving {self.secondary_stem_name} stem to {self.secondary_stem_output_path}...")
                    self.final_process(self.secondary_stem_output_path, self.secondary_source, self.secondary_stem_name)
                    output_files.append(self.secondary_stem_output_path)

                if not self.output_single_stem or self.output_single_stem.lower() == self.primary_stem_name.lower():
                    self.primary_stem_output_path = self.get_stem_output_path(self.primary_stem_name, custom_output_names)

                    self.logger.info(f"Saving {self.primary_stem_name} stem to {self.primary_stem_output_path}...")
                    self.final_process(self.primary_stem_output_path, self.primary_source, self.primary_stem_name)
                    output_files.append(self.primary_stem_output_path)

        else:
            # Handle case when source is not a dictionary (single source model)
            if not self.output_single_stem or self.output_single_stem.lower() == self.primary_stem_name.lower():
                self.primary_stem_output_path = self.get_stem_output_path(self.primary_stem_name, custom_output_names)

                if not isinstance(self.primary_source, np.ndarray):
                    self.primary_source = source.T

                self.logger.info(f"Saving {self.primary_stem_name} stem to {self.primary_stem_output_path}...")
                self.final_process(self.primary_stem_output_path, self.primary_source, self.primary_stem_name)
                output_files.append(self.primary_stem_output_path)

        return output_files

    def _use_model_segment_override(self, audio_duration_seconds: float) -> bool:
        """Resolve the segment-size override for one input without mutating the separator."""
        is_short_audio = audio_duration_seconds < 10.0
        if is_short_audio and not self.override_model_segment_size:
            self.logger.warning(
                f"Audio duration ({audio_duration_seconds:.2f}s) is less than 10 seconds."
            )
            self.logger.warning(
                "Automatically enabling override_model_segment_size for better processing of short audio."
            )
        return self.override_model_segment_size or is_short_audio

    def pitch_fix(self, source, sr_pitched, orig_mix):
        """
        Change the pitch of the source audio by a number of semitones.

        Args:
            source (np.ndarray): The source audio to be pitch-shifted.
            sr_pitched (int): The sample rate of the pitch-shifted audio.
            orig_mix (np.ndarray): The original mix, used to match the shape of the pitch-shifted audio.

        Returns:
            np.ndarray: The pitch-shifted source audio.
        """
        source = spec_utils.change_pitch_semitones(source, sr_pitched, semitone_shift=self.pitch_shift)[0]
        source = spec_utils.match_array_shapes(source, orig_mix)
        return source

    def demix(self, mix: np.ndarray, override_model_segment_size: bool | None = None):
        orig_mix = mix
        if override_model_segment_size is None:
            override_model_segment_size = self.override_model_segment_size

        if self.pitch_shift != 0:
            self.logger.debug(f"Shifting pitch by -{self.pitch_shift} semitones...")
            mix, sample_rate = spec_utils.change_pitch_semitones(
                mix, self.sample_rate, semitone_shift=-self.pitch_shift
            )

        try:
            num_stems = self.model_run.num_target_instruments
        except AttributeError:
            num_stems = self.model_run.module.num_target_instruments

        if override_model_segment_size:
            mdx_segment_size = self.segment_size
            self.logger.debug(f"Using configured segment size: {mdx_segment_size}")
        else:
            mdx_segment_size = self.model_data_cfg.inference.dim_t
            self.logger.debug(f"Using model default segment size: {mdx_segment_size}")
        hop_length = self.model_data_cfg.audio.hop_length
        chunk_size = hop_length * (mdx_segment_size - 1)
        self.logger.debug(f"Chunk size: {chunk_size}")
        hop_size = chunk_size // self.overlap
        mix_len = mix.shape[1]
        pad_size = hop_size - (mix_len - chunk_size) % hop_size
        padded_length = mix_len + pad_size + 2 * (chunk_size - hop_size)

        mix_t = torch.tensor(mix, dtype=torch.float32, device=self.torch_device)
        mix_t = torch.cat(
            [
                torch.zeros(2, chunk_size - hop_size, device=self.torch_device),
                mix_t,
                torch.zeros(
                    2, pad_size + chunk_size - hop_size, device=self.torch_device
                ),
            ],
            1,
        )
        chunks = mix_t.unfold(1, chunk_size, hop_size).transpose(0, 1)
        batches = [
            chunks[i : i + self.batch_size]
            for i in range(0, len(chunks), self.batch_size)
        ]

        accumulated_outputs = (
            torch.zeros(num_stems, *mix_t.shape, device=self.torch_device)
            if num_stems > 1
            else torch.zeros_like(mix_t)
        )
        with torch.no_grad():
            count = 0
            for batch in tqdm(batches, desc="Separating"):
                single_batch_result = self.model_run(batch.to(self.torch_device))
                for individual_output in single_batch_result:
                    individual_output = (
                        individual_output.to(self.torch_device)
                        if individual_output.device != self.torch_device
                        else individual_output
                    )
                    accumulated_outputs[
                        ..., count * hop_size : count * hop_size + chunk_size
                    ] += individual_output
                    count += 1

        accumulated_outputs.div_(self.overlap)
        inferenced_outputs = accumulated_outputs[
            ..., chunk_size - hop_size : -(pad_size + chunk_size - hop_size)
        ]
        del accumulated_outputs

        if num_stems > 1:
            sources = {}

            for key, value in zip(
                self.model_data_cfg.training.instruments,
                inferenced_outputs.cpu().detach().numpy(),
            ):
                if self.pitch_shift != 0:
                    sources[key] = self.pitch_fix(value, sample_rate, orig_mix)
                else:
                    sources[key] = value

            del inferenced_outputs

            return sources
        else:
            inferenced_output = inferenced_outputs.cpu().detach().numpy()

            del inferenced_outputs

            # For single-target models (e.g., karaoke), also return the residual as secondary
            if self.pitch_shift != 0:
                self.logger.debug("Applying pitch correction for single instrument")
                primary = self.pitch_fix(inferenced_output, sample_rate, orig_mix)
            else:
                primary = inferenced_output

            if self.is_primary_stem_main_target:
                self.logger.debug("Single-target model detected; computing residual secondary stem from original mix")
                # Ensure shapes match before residual subtraction
                if primary.shape[1] != orig_mix.shape[1]:
                    primary = spec_utils.match_array_shapes(primary, orig_mix)
                secondary = orig_mix - primary
                return {
                    self.primary_stem_name: primary,
                    self.secondary_stem_name: secondary,
                }

            self.logger.debug("Returning inferenced output for single instrument")
            return primary
