from __future__ import annotations
from math import pi

import torch
from torch import arange, cat, stack, is_tensor, Tensor, meshgrid
from torch.nn import Module, Parameter, ParameterList
from torch.amp import autocast

from einops import einsum, rearrange

from .pope import PolarEmbedReturn, apply_pope_to_qk

# helper functions

def exists(v):
    return v is not None

def default(v, d):
    return v if exists(v) else d

# Axial PoPE class

class AxialPoPE(Module):
    # convenience
    apply_pope_to_qk = staticmethod(apply_pope_to_qk)

    def __init__(
        self,
        dim,
        *,
        heads,
        axial_dims: tuple[int, ...] | None = None,
        theta = 10000,
        bias_uniform_init = False,
    ):
        super().__init__()
        self.dim = dim
        self.heads = heads

        if not exists(axial_dims):
            axial_dims = (dim,)

        self.axial_dims = axial_dims
        assert sum(axial_dims) == dim, f'sum of axial_dims {axial_dims} must be equal to dim {dim}'

        # inv freqs for each axial dimension

        self.inv_freqs = ParameterList()

        for axial_dim in axial_dims:
            inv_freqs = theta ** -(arange(axial_dim).float() / axial_dim)
            self.inv_freqs.append(Parameter(inv_freqs, requires_grad = False))

        # the learned bias on the keys

        self.bias = Parameter(torch.zeros(heads, dim))

        if bias_uniform_init:
            self.bias.uniform_(-2. * pi, 0.)

    @property
    def device(self):
        return self.bias.device

    @staticmethod
    def get_grid_positions(*dims, device = None):
        grid = meshgrid(*[arange(d, device = device).float() for d in dims], indexing = 'ij')
        return stack([g.flatten() for g in reversed(grid)], dim = -1)

    @autocast('cuda', enabled = False)
    def forward(
        self,
        pos_or_dims: Tensor | tuple[int, ...],
    ):
        # handle auto grid generation if tuple is passed

        if isinstance(pos_or_dims, tuple):
            pos = self.get_grid_positions(*pos_or_dims, device = self.device)
        else:
            pos = pos_or_dims

        # pos shape is (..., N) where N is len(axial_dims)

        assert pos.shape[-1] == len(self.axial_dims)

        all_freqs = []

        for i, inv_freqs in enumerate(self.inv_freqs):
            # pos_i shape is (...)

            pos_i = pos[..., i]

            # freqs_i shape is (..., axial_dim)

            freqs_i = einsum(pos_i, inv_freqs, '... , d -> ... d')
            all_freqs.append(freqs_i)

        # concat axial freqs

        freqs = cat(all_freqs, dim = -1)

        # the bias, with clamping

        bias = self.bias.clamp(-2. * pi, 0.)

        return PolarEmbedReturn(freqs, bias)
