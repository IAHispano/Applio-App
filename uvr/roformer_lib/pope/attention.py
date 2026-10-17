import torch
import torch.nn.functional as F

from .pope import apply_pope_to_qk

from .torch_einops_utils import and_masks
from einops import rearrange, repeat

# helpers

TORCH_VERSION = tuple(map(int, torch.__version__.split('.')[:2]))
IS_TORCH_LT_2_0 = TORCH_VERSION < (2, 0)

def exists(v):
    return v is not None

def default(v, d):
    return v if exists(v) else d

def divisible_by(num, den):
    return (num % den) == 0

# triton available

try:
    from .triton_pope import triton_compute_qk_similarity
    from .triton_pope_flash_attn import flash_attn
    TRITON_AVAILABLE = True
except ImportError:
    TRITON_AVAILABLE = False

# functions

def compute_attn_similarity_non_fused(
    q,
    k,
    pope,
    head_dimension_at_first = True
):
    if not head_dimension_at_first:
        q = rearrange(q, 'b n h d -> b h n d')
        k = rearrange(k, 'b n h d -> b h n d')

    q, k = apply_pope_to_qk(pope, q, k, to_magnitude = F.softplus)

    # group query attention support

    groups = q.shape[1] // k.shape[1]
    k = repeat(k, 'b h ... -> b (g h) ...', g = groups)

    return torch.einsum('b h i d, b h j d -> b h i j', q, k)

def compute_attn_similarity(
    q,
    k,
    pope,
    allow_tf32 = True,
    head_dimension_at_first = True
):
    assert divisible_by(q.shape[1 if head_dimension_at_first else 2], k.shape[1 if head_dimension_at_first else 2])

    freqs, bias = pope
    head_dim = q.shape[-1]

    assert head_dim in {32, 48, 64, 128, 256}, f"head_dim {head_dim} not in common sizes"

    is_cuda = q.is_cuda and k.is_cuda and freqs.is_cuda and bias.is_cuda

    if TRITON_AVAILABLE and is_cuda:
        if not head_dimension_at_first:
            q = rearrange(q, 'b n h d -> b h n d')
            k = rearrange(k, 'b n h d -> b h n d')

        rotate_dim = freqs.shape[-1]
        return triton_compute_qk_similarity(q, k, freqs, bias, rotate_dim, allow_tf32 = allow_tf32)

    return compute_attn_similarity_non_fused(q, k, pope, head_dimension_at_first = head_dimension_at_first)

def manual_scaled_dot_product_attention(q, k, v, attn_mask=None, is_causal=False, scale=None, dropout_p=0.0):
    """SDPA implementation for PyTorch < 2.0"""
    if scale is None:
        scale = q.shape[-1] ** -0.5
    
    attn_weights = torch.matmul(q, k.transpose(-2, -1)) * scale
    
    if is_causal:
        seq_len = attn_weights.shape[-1]
        causal_mask = torch.triu(torch.ones(seq_len, seq_len, device=attn_weights.device), diagonal=1).bool()
        attn_weights = attn_weights.masked_fill(causal_mask, float('-inf'))
    
    if attn_mask is not None:
        if attn_mask.dtype == torch.bool:
            attn_weights = attn_weights.masked_fill(~attn_mask, float('-inf'))
        else:
            attn_weights = attn_weights + attn_mask
    
    attn_weights = torch.softmax(attn_weights, dim=-1)
    
    if dropout_p > 0.0 and q.requires_grad:
        attn_weights = torch.dropout(attn_weights, dropout_p, train=True)
    
    return torch.matmul(attn_weights, v)

def flash_attn_with_pope(
    q,
    k,
    v,
    pos_emb = None,
    mask = None,
    causal = False,
    softmax_scale = None,
    fused = None,
    head_dimension_at_first = True,
    dropout = 0.
):
    seq_dim = 2 if head_dimension_at_first else 1
    q_len, kv_len, device = q.shape[seq_dim], k.shape[seq_dim], q.device

    fused = default(fused, TRITON_AVAILABLE and q.is_cuda)

    softmax_scale = default(softmax_scale, q.shape[-1] ** -0.5)

    if fused:
        # fused kernel expects (batch, seq, heads, dim)

        if head_dimension_at_first:
            q = rearrange(q, 'b h n d -> b n h d')
            k = rearrange(k, 'b h n d -> b n h d')
            v = rearrange(v, 'b h n d -> b n h d')

        freqs, bias = pos_emb
        out = flash_attn(q, k, v, freqs = freqs, pope_bias = bias, mask = mask, causal = causal, softmax_scale = softmax_scale, dropout = dropout)

        if head_dimension_at_first:
            out = rearrange(out, 'b n h d -> b h n d')

        return out

    # non-fused manual path
    # standardize to (batch, heads, seq, dim)

    if not head_dimension_at_first:
        q = rearrange(q, 'b n h d -> b h n d')
        k = rearrange(k, 'b n h d -> b h n d')
        v = rearrange(v, 'b n h d -> b h n d')

    q, k = apply_pope_to_qk(pos_emb, q, k, to_magnitude = F.softplus)

    # group query attention support

    groups = q.shape[1] // k.shape[1]
    k = repeat(k, 'b h ... -> b (g h) ...', g = groups)
    v = repeat(v, 'b h ... -> b (g h) ...', g = groups)

    # manual attention path using SDPA
    # ensure dtypes match for SDPA (apply_pope_to_qk might have upcasted to float32)

    v_dtype = v.dtype
    v_dim = v.shape[-1]

    if q.dtype != v.dtype:
        v = v.to(q.dtype)

    attn_mask = None
    if exists(mask):
        attn_mask = rearrange(mask, 'b j -> b 1 1 j')

    if causal and q_len < kv_len:
        causal_mask = torch.ones((q_len, kv_len), dtype = torch.bool, device = device).tril(diagonal = kv_len - q_len)
        attn_mask = and_masks(attn_mask, causal_mask)
        causal = False

    if IS_TORCH_LT_2_0:
        out = manual_scaled_dot_product_attention(
            q, k, v,
            attn_mask=attn_mask,
            is_causal=causal,
            scale=softmax_scale,
            dropout_p=dropout
        )
    else:
        out = F.scaled_dot_product_attention(
            q, k, v,
            attn_mask=attn_mask,
            is_causal=causal,
            scale=softmax_scale,
            dropout_p=dropout
        )

    # mps sdpa bug (pytorch 2.9.1) - output takes q/k dim instead of v dim
    # first v_dim elements are correct, so slicing suffices
    # only triggers in no_grad (inference). todo - remove once fixed upstream

    if out.shape[-1] != v_dim:
        out = out[..., :v_dim]

    out = out.to(v_dtype)

    if not head_dimension_at_first:
        out = rearrange(out, 'b h n d -> b n h d')

    return out
