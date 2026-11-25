"""Bounded-memory phase crossfade for the desktop realtime engine on CPU."""

import torch

_TILE_VALUES = 1 << 20


def cpu_phase_vocoder(a, b, fade_out, fade_in):
    # Match the pinned phase vocoder, including DC/Nyquist weighting and
    # phase unwrapping. Only the lifetime of the synthesis matrix changes.
    samples = a.shape[0]
    window = (fade_out * fade_in).sqrt()
    fa = torch.fft.rfft(a * window)
    fb = torch.fft.rfft(b * window)
    magnitude = fa.abs() + fb.abs()
    magnitude[1 : -1 if samples % 2 == 0 else None] *= 2

    initial_phase = fa.angle()
    delta = fb.angle() - initial_phase
    bins = torch.arange(magnitude.numel(), device=a.device, dtype=a.dtype)
    frequency = 2 * torch.pi * bins + (
        delta - 2 * torch.pi * (delta / 2 / torch.pi + 0.5).floor()
    )
    position = (
        torch.arange(samples, device=a.device, dtype=a.dtype) / samples
    ).unsqueeze(-1)
    overlap = torch.empty_like(a)

    # Reuse each tile in place instead of materializing the full sample-by-bin
    # matrix for phase, cosine, and weighted magnitude at the same time.
    rows = max(1, _TILE_VALUES // magnitude.numel())
    for start in range(0, samples, rows):
        stop = min(samples, start + rows)
        phase = frequency * position[start:stop]
        phase.add_(initial_phase).cos_().mul_(magnitude)
        torch.sum(phase, dim=-1, out=overlap[start:stop])

    return a * (fade_out**2) + b * (fade_in**2) + overlap * window / samples
