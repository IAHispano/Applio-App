from __future__ import annotations
from functools import wraps

import torch
from torch import tensor, is_tensor, cat, stack, arange
import torch.nn.functional as F

from torch.utils._pytree import tree_flatten, tree_unflatten, tree_map

from einops import rearrange, repeat, reduce, pack, unpack

# helper functions

def exists(v):
    return v is not None

def default(v, d):
    return v if exists(v) else d

def identity(t, *args, **kwargs):
    return t

def first(arr):
    return arr[0]

def compact(arr):
    return [*filter(exists, arr)]

def maybe(fn):

    if not exists(fn):
        return identity

    @wraps(fn)
    def inner(t, *args, **kwargs):
        if not exists(t):
            return None

        return fn(t, *args, **kwargs)

    return inner

def safe(fn):
    @wraps(fn)
    def inner(tensors, *args, **kwargs):
        tensors = compact(tensors)

        if len(tensors) == 0:
            return None

        if len(tensors) == 1:
            return tensors[0]

        return fn(tensors, *args, **kwargs)

    return inner

# exported functions

def masked_mean(
    t,
    mask = None,
    dim = None,
    eps = 1e-5
):
    if not exists(mask):
        return t.mean(dim = dim) if exists(dim) else t.mean()

    if mask.ndim < t.ndim:
        mask = pad_right_ndim(mask, t.ndim - mask.ndim)

    mask = mask.expand_as(t)

    if not exists(dim):
        return t[mask].mean() if mask.any() else t[mask].sum()

    num = (t * mask).sum(dim = dim)
    den = mask.sum(dim = dim)

    return num / den.clamp(min = eps)

# shapes

def shape_with_replace(
    t,
    replace_dict: dict[int, int] | None = None
):
    shape = t.shape

    if not exists(replace_dict):
        return shape

    shape_list = list(shape)

    for index, value in replace_dict.items():
        assert index < len(shape_list)
        shape_list[index] = value

    return torch.Size(shape_list)

# slicing

def slice_at_dim(t, slc, dim = -1):
    dims = t.ndim
    dim = (dim + dims) if dim < 0 else dim

    full_slice = [slice(None)] * dims
    full_slice[dim] = slc

    return t[tuple(full_slice)]

def slice_left_at_dim(t, length, dim = -1):
    if length == 0:
        return slice_at_dim(t, slice(0, 0), dim = dim)

    return slice_at_dim(t, slice(None, length), dim = dim)

def slice_right_at_dim(t, length, dim = -1):
    if length == 0:
        return slice_at_dim(t, slice(0, 0), dim = dim)

    return slice_at_dim(t, slice(-length, None), dim = dim)

# dimensions

def pad_ndim(t, ndims: tuple[int, int]):
    shape = t.shape
    left, right = ndims
    assert left >= 0 and right >= 0

    ones = (1,)
    ones_left = ones * left
    ones_right = ones * right
    return t.reshape(*ones_left, *shape, *ones_right)

def pad_left_ndim(t, ndims: int):
    return pad_ndim(t, (ndims, 0))

def pad_right_ndim(t, ndims: int):
    return pad_ndim(t, (0, ndims))

def pad_right_ndim_to(t, ndims: int):
    if t.ndim >= ndims:
        return t

    return pad_right_ndim(t, ndims - t.ndim)

def pad_left_ndim_to(t, ndims: int):
    if t.ndim >= ndims:
        return t

    return pad_left_ndim(t, ndims - t.ndim)

def align_dims_left(
    tensors,
    *,
    ndim = None
):
    if not exists(ndim):
        ndim = max([t.ndim for t in tensors])

    return tuple(pad_right_ndim(t, ndim - t.ndim) for t in tensors)

# cat and stack

def safe_stack(tensors, dim = 0):
    tensors = compact(tensors)

    if len(tensors) == 0:
        return None

    return stack(tensors, dim = dim)

@safe
def safe_cat(tensors, dim = 0):
    return cat(tensors, dim = dim)

# masking

def lens_to_mask(lens, max_len = None):
    device = lens.device

    if not exists(max_len):
        max_len = lens.amax().item()

    seq = arange(max_len, device = device)
    lens = rearrange(lens, '... -> ... 1')
    return seq < lens

@safe
def reduce_masks(masks, op):
    mask, *rest_masks = masks

    for rest_mask in rest_masks:
        mask = op(mask, rest_mask)

    return mask

def and_masks(masks):
    return reduce_masks(masks, torch.logical_and)

def or_masks(masks):
    return reduce_masks(masks, torch.logical_or)

# padding

def pad_at_dim(
    t,
    pad: tuple[int, int],
    *,
    dim = -1,
    value = 0.
):
    dims_from_right = (- dim - 1) if dim < 0 else (t.ndim - dim - 1)
    zeros = ((0, 0) * dims_from_right)
    return F.pad(t, (*zeros, *pad), value = value)

def pad_left_at_dim(t, pad: int, **kwargs):
    return pad_at_dim(t, (pad, 0), **kwargs)

def pad_right_at_dim(t, pad: int, **kwargs):
    return pad_at_dim(t, (0, pad), **kwargs)

def pad_left_at_dim_to(t, length: int, dim = -1, **kwargs):
    curr_len = t.shape[dim]
    if curr_len >= length:
        return t

    return pad_left_at_dim(t, length - curr_len, dim = dim, **kwargs)

def pad_right_at_dim_to(t, length: int, dim = -1, **kwargs):
    curr_len = t.shape[dim]
    if curr_len >= length:
        return t

    return pad_right_at_dim(t, length - curr_len, dim = dim, **kwargs)

# better pad sequence

def pad_sequence(
    tensors,
    *,
    dim = -1,
    value = 0.,
    left = False,
    dim_stack = 0,
    return_stacked = True,
    return_lens = False,
    pad_lens = False # returns padding length instead of sequence lengths
):
    if len(tensors) == 0:
        return None

    device = first(tensors).device

    lens = tensor([t.shape[dim] for t in tensors], device = device)
    max_len = lens.amax().item()

    pad_fn = pad_left_at_dim if left else pad_right_at_dim
    padded_tensors = [pad_fn(t, max_len - t_len, dim = dim, value = value) for t, t_len in zip(tensors, lens)]

    output = padded_tensors
    if return_stacked:
        output = stack(output, dim = dim_stack)

    if not return_lens:
        return output

    if pad_lens:
        lens = max_len - lens

    return output, lens

def pad_sequence_and_cat(
    tensors,
    *,
    dim_cat = 0,
    **kwargs
):
    assert 'return_stacked' not in kwargs

    padded = pad_sequence(tensors, return_stacked = False, **kwargs)
    return cat(padded, dim = dim_cat)

# tree flatten with inverse

def tree_map_tensor(fn, tree):
    return tree_map(lambda t: fn(t) if is_tensor(t) else t, tree)

def tree_flatten_with_inverse(tree):
    flattened, spec = tree_flatten(tree)

    def inverse(out):
        return tree_unflatten(out, spec)

    return flattened, inverse

# einops pack

def pack_with_inverse(t, pattern):
    is_one = is_tensor(t)

    if is_one:
        t = [t]

    packed, packed_shape = pack(t, pattern)

    def inverse(out, inv_pattern = None):
        inv_pattern = default(inv_pattern, pattern)
        out = unpack(out, packed_shape, inv_pattern)

        if is_one:
            out = first(out)

        return out

    return packed, inverse
