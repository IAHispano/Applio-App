import torch
import torch.nn.functional as F

from uvr.device import should_fallback_to_cpu_for_complex_ops


class STFT:
    """Convert stereo audio to MDX real/imaginary spectra and back."""

    def __init__(self, logger, n_fft, hop_length, dim_f, device):
        self.logger = logger
        self.n_fft = n_fft
        self.hop_length = hop_length
        self.dim_f = dim_f
        self.device = device
        self.hann_window = torch.hann_window(window_length=n_fft, periodic=True)

    def window_for(self, tensor):
        # Cache on the effective device, including the complex-operation CPU fallback.
        if self.hann_window.device != tensor.device:
            self.hann_window = self.hann_window.to(tensor.device)
        return self.hann_window

    def __call__(self, input_tensor):
        original_device = input_tensor.device
        if should_fallback_to_cpu_for_complex_ops(original_device):
            input_tensor = input_tensor.cpu()
        batch_dimensions = input_tensor.shape[:-2]
        channels, samples = input_tensor.shape[-2:]
        spectrum = torch.stft(
            input_tensor.reshape(-1, samples),
            n_fft=self.n_fft,
            hop_length=self.hop_length,
            window=self.window_for(input_tensor),
            center=True,
            return_complex=True,
        )
        # Keep the model's established [L real, L imag, R real, R imag] order.
        spectrum = torch.view_as_real(spectrum).permute(0, 3, 1, 2)
        spectrum = spectrum.reshape(
            *batch_dimensions, channels * 2, spectrum.shape[-2], spectrum.shape[-1]
        )
        return spectrum[..., : self.dim_f, :].to(original_device)

    def inverse(self, input_tensor):
        original_device = input_tensor.device
        if should_fallback_to_cpu_for_complex_ops(original_device):
            input_tensor = input_tensor.cpu()
        batch_dimensions = input_tensor.shape[:-3]
        channels, frequencies, frames = input_tensor.shape[-3:]
        bins = self.n_fft // 2 + 1
        padded = F.pad(input_tensor, (0, 0, 0, bins - frequencies))
        components = padded.reshape(-1, 2, bins, frames).permute(0, 2, 3, 1)
        spectrum = torch.view_as_complex(components.contiguous())
        audio = torch.istft(
            spectrum,
            n_fft=self.n_fft,
            hop_length=self.hop_length,
            window=self.window_for(input_tensor),
            center=True,
        )
        return audio.reshape(*batch_dimensions, channels // 2, -1).to(original_device)
