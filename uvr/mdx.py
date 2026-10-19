"""MDX separator with native ONNX Runtime and optional torch conversion."""

import os
import platform

import numpy as np
import onnxruntime as ort
import torch
from tqdm import tqdm

from uvr import spectral as spec_utils
from uvr.base import BaseSeparator
from uvr.stft import STFT


class MdxSeparator(BaseSeparator):
    def __init__(self, common_config, arch_config: dict):
        super().__init__(config=common_config)
        self.segment_size = arch_config.get("segment_size")
        self.overlap = arch_config.get("overlap", 0.25)
        self.batch_size = arch_config.get("batch_size", 1)
        self.hop_length = arch_config.get("hop_length", 1024)
        self.enable_denoise = arch_config.get("enable_denoise", False)

        self.compensate = self.model_data["compensate"]
        self.dim_f = self.model_data["mdx_dim_f_set"]
        self.dim_t = 2 ** self.model_data["mdx_dim_t_set"]
        self.n_fft = self.model_data["mdx_n_fft_scale_set"]

        self.load_model()

        self.trim = 0
        self.chunk_size = 0
        self.gen_size = 0
        self.stft = None

    def load_model(self):
        if self.segment_size == self.dim_t:
            options = ort.SessionOptions()
            options.log_severity_level = 3
            execution_providers = list(self.onnx_execution_provider)
            self.onnx_stream = None
            if (
                self.torch_device.type == "cuda"
                and not torch.version.hip
                and "CUDAExecutionProvider" in execution_providers
                and "CUDAExecutionProvider" in ort.get_available_providers()
            ):
                # ORT treats a null/default stream pointer as no user stream.
                # Retain an explicit stream so producer/consumer ordering is reliable.
                self.onnx_stream = torch.cuda.Stream(device=self.torch_device)
                execution_providers = [
                    (
                        (
                            "CUDAExecutionProvider",
                            {
                                "device_id": self.onnx_stream.device.index,
                                "user_compute_stream": str(
                                    self.onnx_stream.cuda_stream
                                ),
                            },
                        )
                        if provider == "CUDAExecutionProvider"
                        else provider
                    )
                    for provider in execution_providers
                ]
            session = ort.InferenceSession(
                self.model_path,
                providers=execution_providers,
                sess_options=options,
            )
            self.onnx_session = session
            self.onnx_input = session.get_inputs()[0]
            self.onnx_output = session.get_outputs()[0]
            if "CUDAExecutionProvider" not in session.get_providers():
                self.onnx_stream = None
            providers = session.get_providers()
            requested = (
                self.onnx_execution_provider[0]
                if self.onnx_execution_provider
                else None
            )
            if requested and requested not in providers:
                self.logger.warning(
                    f"ONNX Runtime could not activate {requested}; using {providers}."
                )
            batch_dimension = self.onnx_input.shape[0]
            self.fixed_batch_size = (
                batch_dimension
                if isinstance(batch_dimension, int) and batch_dimension > 0
                else None
            )
            self.inference_batch_size = self.fixed_batch_size or self.batch_size
            if self.fixed_batch_size and self.fixed_batch_size != self.batch_size:
                self.logger.info(
                    f"ONNX model uses a fixed batch size of {self.fixed_batch_size}."
                )
            self.model_run = self.run_onnx
        else:
            import onnx
            import onnx2torch

            self.fixed_batch_size = None
            self.inference_batch_size = self.batch_size
            if platform.system() == "Windows":
                onnx_model = onnx.load(self.model_path)
                self.model_run = onnx2torch.convert(onnx_model)
            else:
                self.model_run = onnx2torch.convert(self.model_path)
            self.model_run.to(self.torch_device).eval()
            self.logger.warning(
                "Model converted from ONNX to torch (segment size != dim_t); processing may be slower."
            )

    def run_onnx(self, spectrum):
        # Only bind shapes established by model metadata. Custom graphs with
        # unknown output dimensions retain ONNX Runtime's allocating CPU path.
        dimensions = {
            name: size
            for name, size in zip(self.onnx_input.shape, spectrum.shape)
            if isinstance(name, str)
        }
        output_shape = [
            dimension if isinstance(dimension, int) else dimensions.get(dimension)
            for dimension in (self.onnx_output.shape or [])
        ]
        if (
            self.onnx_stream is None
            or spectrum.device != self.onnx_stream.device
            or spectrum.dtype != torch.float32
            or self.onnx_input.type != "tensor(float)"
            or self.onnx_output.type != "tensor(float)"
            or not output_shape
            or not all(isinstance(size, int) and size > 0 for size in output_shape)
        ):
            return self.onnx_session.run(
                [self.onnx_output.name],
                {self.onnx_input.name: spectrum.cpu().numpy()},
            )[0]

        caller_stream = torch.cuda.current_stream(spectrum.device)
        self.onnx_stream.wait_stream(caller_stream)
        with torch.cuda.stream(self.onnx_stream):
            contiguous = spectrum.contiguous()
            output = torch.empty(
                output_shape, dtype=spectrum.dtype, device=spectrum.device
            )
            binding = self.onnx_session.io_binding()
            binding.bind_input(
                self.onnx_input.name,
                "cuda",
                spectrum.device.index,
                np.float32,
                tuple(contiguous.shape),
                contiguous.data_ptr(),
            )
            binding.bind_output(
                self.onnx_output.name,
                "cuda",
                spectrum.device.index,
                np.float32,
                tuple(output.shape),
                output.data_ptr(),
            )
            self.onnx_session.run_with_iobinding(binding)
            # Retain allocator ownership until ORT's stream has consumed the input.
            spectrum.record_stream(self.onnx_stream)
        caller_stream.wait_stream(self.onnx_stream)
        output.record_stream(caller_stream)
        return output

    def separate(self, audio_file_path, custom_output_names=None):
        self.primary_source = None
        self.secondary_source = None
        self.audio_file_path = audio_file_path
        self.audio_file_base = os.path.splitext(os.path.basename(audio_file_path))[0]

        mix = self.prepare_mix(self.audio_file_path)
        peak = np.abs(mix).max()
        mix = spec_utils.normalize(
            wave=mix,
            max_peak=self.normalization_threshold,
            min_peak=self.amplification_threshold,
        )

        self.primary_source = (self.demix(mix) * peak).T
        if self.should_output_stem(self.secondary_stem_name):
            if self.invert_using_spec:
                raw_mix = self.demix(mix, is_match_mix=True)
                self.secondary_source = spec_utils.invert_stem(
                    raw_mix, self.primary_source * self.compensate
                )
            else:
                self.secondary_source = (-self.primary_source * self.compensate) + mix.T

        return [
            self.save_stem(name, source, custom_output_names)
            for name, source in (
                (self.secondary_stem_name, self.secondary_source),
                (self.primary_stem_name, self.primary_source),
            )
            if self.should_output_stem(name)
        ]

    def initialize_model_settings(self):
        self.trim = self.n_fft // 2
        self.chunk_size = self.hop_length * (self.segment_size - 1)
        self.gen_size = self.chunk_size - 2 * self.trim
        if self.gen_size <= 0:
            raise ValueError(
                "MDX segment size and hop length must exceed the FFT window"
            )
        self.stft = STFT(
            self.logger, self.n_fft, self.hop_length, self.dim_f, self.torch_device
        )

    def demix(self, mix, is_match_mix=False):
        self.initialize_model_settings()
        chunk_size = self.chunk_size
        overlap = 0.02 if is_match_mix else self.overlap
        pad = self.gen_size + self.trim - (mix.shape[-1] % self.gen_size)
        mixture = np.pad(mix, ((0, 0), (self.trim, pad)))
        step = max(1, int((1 - overlap) * chunk_size))
        result = np.zeros_like(mixture, dtype=np.float32)
        # Every channel uses the same window; keep a single coverage buffer.
        divider = np.zeros(mixture.shape[-1], dtype=np.float32)
        batch_size = self.inference_batch_size
        starts = range(0, mixture.shape[-1], step)
        full_window = np.hanning(chunk_size).astype(np.float32) if overlap else None

        with torch.inference_mode(), tqdm(
            total=len(starts), desc="Separating"
        ) as progress:
            for offset in range(0, len(starts), batch_size):
                locations = starts[offset : offset + batch_size]
                actual_batch = self.fixed_batch_size or len(locations)
                batch = np.zeros((actual_batch, 2, chunk_size), dtype=np.float32)
                for index, start in enumerate(locations):
                    length = min(chunk_size, mixture.shape[-1] - start)
                    batch[index, :, :length] = mixture[:, start : start + length]
                predictions = self.run_model(
                    torch.from_numpy(batch).to(self.torch_device),
                    is_match_mix=is_match_mix,
                )
                for index, start in enumerate(locations):
                    length = min(chunk_size, mixture.shape[-1] - start)
                    window = full_window
                    if overlap and length != chunk_size:
                        window = np.hanning(length).astype(np.float32)
                    if window is None:
                        result[:, start : start + length] += predictions[
                            index, :, :length
                        ]
                        divider[start : start + length] += 1
                    else:
                        result[:, start : start + length] += (
                            predictions[index, :, :length] * window
                        )
                        divider[start : start + length] += window
                progress.update(len(locations))

        np.divide(result, divider, out=result, where=divider > 0)
        return result[:, self.trim : self.trim + mix.shape[-1]]

    def run_model(self, mix, is_match_mix=False):
        spek = self.stft(mix)
        spek[:, :, :3, :] = 0
        if is_match_mix:
            spec_pred = spek
        elif self.enable_denoise:
            spec_pred = (self.model_run(-spek) * -0.5) + (self.model_run(spek) * 0.5)
        else:
            spec_pred = self.model_run(spek)
        # Converted models and bound ONNX outputs stay on the inference device;
        # the generic ONNX fallback returns NumPy and needs a device transfer.
        spec_pred = torch.as_tensor(spec_pred, device=self.torch_device)
        return self.stft.inverse(spec_pred).cpu().numpy()
