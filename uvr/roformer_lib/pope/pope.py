from __future__ import annotations
from collections import namedtuple
from math import pi

import torch
from torch import arange, cat, stack, is_tensor, Tensor
from torch.nn import Module, Parameter
from torch.amp import autocast

import torch.nn.functional as F

from einops import einsum, rearrange

from .torch_einops_utils import slice_right_at_dim

# constants

PolarEmbedReturn = namedtuple('PolarEmbedReturn', ('freqs', 'bias'))

# helper functions

def exists(v):
    return v is not None

def default(v, d):
    return v if exists(v) else d

# applying pope to qk

@autocast('cuda', enabled = False)
def apply_pope_to_qk(
    pope: PolarEmbedReturn,
    q, k,
    to_magnitude = F.softplus,
    return_complex = False
):
    freqs, bias = pope

    q_len, k_len, qk_dim, rotate_dim = q.shape[-2], k.shape[-2], q.shape[-1], freqs.shape[-1]

    assert q_len <= k_len and rotate_dim <= qk_dim

    is_partial_rotate = rotate_dim < qk_dim

    if is_partial_rotate:
        q, q_rest = q[..., :rotate_dim], q[..., rotate_dim:]
        k, k_rest = k[..., :rotate_dim], k[..., rotate_dim:]

        if return_complex:
            q_rest = torch.polar(q_rest, torch.zeros_like(q_rest))
            k_rest = torch.polar(k_rest, torch.zeros_like(k_rest))

    if freqs.ndim == 3:
        freqs = rearrange(freqs, 'b n d -> b 1 n d')

    freqs_with_bias = freqs + rearrange(bias, 'h d -> h 1 d')

    # convert q and k to polar magnitudes with activation

    q, k = to_magnitude(q), to_magnitude(k)

    # apply rotations

    freqs = slice_right_at_dim(freqs, q_len, dim = -2)

    if return_complex:
        q = torch.polar(q, freqs)
    else:
        qcos, qsin = freqs.cos(), freqs.sin()
        q = rearrange([q * qcos, q * qsin], 'two ... d -> ... (d two)')

    # handle inference

    if return_complex:
        k = torch.polar(k, freqs_with_bias)
    else:
        kcos, ksin = freqs_with_bias.cos(), freqs_with_bias.sin()
        k = rearrange([k * kcos, k * ksin], 'two ... d -> ... (d two)')

    # concat

    if is_partial_rotate:
        q = cat((q, q_rest), dim = -1)
        k = cat((k, k_rest), dim = -1)

    return q, k

# main class

class PoPE(Module):
    apply_pope_to_qk = staticmethod(apply_pope_to_qk)

    def __init__(
        self,
        dim,
        *,
        heads,
        theta = 10000,
        bias_uniform_init = False,
        inv_freqs: Tensor | list[float] | None = None
    ):
        super().__init__()

        # freqs

        if not exists(inv_freqs):
            inv_freqs = theta ** -(arange(dim).float() / dim)

        self.register_buffer('inv_freqs', inv_freqs)

        # the learned bias on the keys

        self.bias = Parameter(torch.zeros(heads, dim))

        if bias_uniform_init:
            self.bias.uniform_(-2. * pi, 0.)

    @property
    def device(self):
        return self.inv_freqs.device

    @autocast('cuda', enabled = False)
    def forward(
        self,
        pos_or_seq_len: Tensor | int,
        offset = 0
    ):

        # get positions depending on input

        if is_tensor(pos_or_seq_len):
            pos = pos_or_seq_len
        else:
            seq_len = pos_or_seq_len
            pos = arange(seq_len, device = self.device, dtype = self.inv_freqs.dtype)

        pos = pos + offset

        # freqs

        freqs = einsum(pos, self.inv_freqs, '... i, j -> ... i j')

        # the bias, with clamping

        bias = self.bias.clamp(-2. * pi, 0.)

        return PolarEmbedReturn(freqs, bias)
