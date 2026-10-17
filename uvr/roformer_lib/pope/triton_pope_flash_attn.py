import os

import torch
from torch.autograd import Function

import triton
import triton.language as tl

# helpers

def exists(v):
    return v is not None

def default(v, d):
    return v if exists(v) else d

# autotuning

_NO_AUTOTUNE = os.environ.get('POPE_NO_AUTOTUNE', '0') == '1'

def _max_shared_mem(device_idx = 0):
    return triton.runtime.driver.active.utils.get_device_properties(device_idx)['max_shared_mem']

def _estimate_shared_bytes(bm, bn, blk_d, stages, elem_bytes):
    """Conservative estimate of shared memory needed for a given block config.
    Triton allocates well beyond the raw tile sizes for pipelining and
    register spilling, so we use a 4x multiplier over the naive tile area."""
    return (bm + bn) * blk_d * 4 * stages * elem_bytes

def _filter_configs(configs, blk_d, elem_bytes, device_idx = 0):
    limit = _max_shared_mem(device_idx)
    valid = [c for c in configs if _estimate_shared_bytes(c.kwargs['BM'], c.kwargs['BN'], blk_d, c.num_stages, elem_bytes) <= limit]
    return valid if valid else configs[-1:]

def cache_by_id(fn):
    cache = dict()
    def inner(kernel_fn, *args):
        key = (id(kernel_fn), *args)
        if key not in cache:
            cache[key] = fn(kernel_fn, *args)
        return cache[key]
    return inner

@cache_by_id
def get_autotuned_kernel(kernel_fn, configs_fn, keys, blk_d, elem_bytes, device_idx = 0):
    configs = configs_fn()
    configs = _filter_configs(configs, blk_d, elem_bytes, device_idx)
    return triton.autotune(configs, key = keys)(kernel_fn)

def _fwd_configs():
    return [
        triton.Config({'BM': 64, 'BN': 64}, num_stages = 1, num_warps = 8),
        triton.Config({'BM': 64, 'BN': 32}, num_stages = 2, num_warps = 4),
        triton.Config({'BM': 32, 'BN': 64}, num_stages = 2, num_warps = 4),
        triton.Config({'BM': 32, 'BN': 32}, num_stages = 2, num_warps = 4),
        triton.Config({'BM': 16, 'BN': 16}, num_stages = 1, num_warps = 4),
    ]

def _bwd_pre_hook(nargs):
    """Zero atomic accumulation buffers before each autotuner benchmark run."""
    nargs['DQ'].zero_()
    df = nargs.get('DFreqs')
    if df is not None:
        df.zero_()
    dpb = nargs.get('DPopeBias')
    if dpb is not None:
        dpb.zero_()

def _bwd_configs():
    return [
        triton.Config({'BM': 64, 'BN': 32}, num_stages = 1, num_warps = 4, pre_hook = _bwd_pre_hook),
        triton.Config({'BM': 32, 'BN': 64}, num_stages = 1, num_warps = 4, pre_hook = _bwd_pre_hook),
        triton.Config({'BM': 32, 'BN': 32}, num_stages = 2, num_warps = 4, pre_hook = _bwd_pre_hook),
        triton.Config({'BM': 32, 'BN': 32}, num_stages = 1, num_warps = 4, pre_hook = _bwd_pre_hook),
        triton.Config({'BM': 16, 'BN': 16}, num_stages = 1, num_warps = 4, pre_hook = _bwd_pre_hook),
    ]

# stride helpers

def _freq_strides(freqs):
    if not exists(freqs):
        return (0, 0, 0)
    if freqs.ndim == 2:
        return (0, 0, freqs.stride(0))
    if freqs.ndim == 3:
        return (freqs.stride(0), 0, freqs.stride(1))
    return (freqs.stride(0), freqs.stride(2), freqs.stride(1))

def _mask_strides(mask):
    if not exists(mask):
        return (0, 0)
    return (mask.stride(0), mask.stride(1))

# activation helpers

@triton.jit
def _softplus(x):
    """Numerically stable softplus: log(1 + exp(x)), linear for x > 20."""
    return tl.where(x > 20., x, tl.log(1.0 + tl.exp(x)))

@triton.jit
def _softplus_grad(x):
    return tl.sigmoid(x)

@triton.jit
def _apply_softplus(x, mask_r):
    """Apply softplus only to rotary dimensions."""
    return tl.where(mask_r[None, :], _softplus(x.to(tl.float32)).to(x.dtype), x)

@triton.jit
def _apply_rotations(act, freq, mask_r):
    """Decompose activated value into cos/sin rotary components."""
    cos = tl.where(mask_r[None, :], act * tl.cos(freq).to(act.dtype), act)
    sin = tl.where(mask_r[None, :], act * tl.sin(freq).to(act.dtype), 0.0)
    return cos, sin

@triton.heuristics({
    'EVEN_M': lambda args: args['seqlen_q'] % args['BM'] == 0,
    'EVEN_N': lambda args: args['seqlen_k'] % args['BN'] == 0,
    'EVEN_HEADDIM': lambda args: args['headdim'] == args['BLOCK_HEADDIM'],
})
@triton.jit
def _fwd_kernel(
    Q, K, V, Freqs, PopeBias, Out, Lse, Mask,
    softmax_scale,
    stride_qb, stride_qh, stride_qm,
    stride_kb, stride_kh, stride_kn,
    stride_vb, stride_vh, stride_vn,
    stride_fb, stride_fh, stride_fi,
    stride_pbh,
    stride_ob, stride_oh, stride_om,
    stride_kmb, stride_kmn,
    n_heads, seqlen_q, seqlen_k, headdim, rotate_dim, dropout_p, drop_seed,
    HAS_POPE: tl.constexpr, IS_CAUSAL: tl.constexpr, HAS_MASK: tl.constexpr, IS_DROPOUT: tl.constexpr,
    BLOCK_HEADDIM: tl.constexpr, EVEN_M: tl.constexpr, EVEN_N: tl.constexpr, EVEN_HEADDIM: tl.constexpr,
    BM: tl.constexpr, BN: tl.constexpr,
):
    bhid = tl.program_id(1)
    b = bhid // n_heads
    h = bhid % n_heads
    blk_m = tl.program_id(0)

    off_m = blk_m * BM + tl.arange(0, BM)
    off_n = tl.arange(0, BN)
    off_d = tl.arange(0, BLOCK_HEADDIM)

    mask_m = off_m < seqlen_q
    mask_d = off_d < headdim
    mask_r = off_d < rotate_dim

    # load q

    q_ptr = Q + b * stride_qb + h * stride_qh + off_m[:, None] * stride_qm + off_d[None, :]

    if EVEN_M & EVEN_HEADDIM:
        q = tl.load(q_ptr)
    else:
        q = tl.load(q_ptr, mask = mask_m[:, None] & mask_d[None, :], other = 0.0)

    # apply pope rotary to q

    q_off = seqlen_k - seqlen_q

    if HAS_POPE:
        q = _apply_softplus(q, mask_r)
        fq = tl.load(Freqs + b * stride_fb + h * stride_fh + (q_off + off_m[:, None]) * stride_fi + off_d[None, :], mask = mask_m[:, None] & mask_r[None, :], other = 0.0).to(tl.float32)
        q_cos, q_sin = _apply_rotations(q, fq, mask_r)
    else:
        q_cos, q_sin = q, None

    # online softmax accumulators

    max_i = tl.zeros([BM], tl.float32) - float('inf')
    sum_i = tl.zeros([BM], tl.float32)
    acc = tl.zeros([BM, BLOCK_HEADDIM], tl.float32)

    end_n = seqlen_k if not IS_CAUSAL else tl.minimum((blk_m + 1) * BM + q_off, seqlen_k)

    for start_n in range(0, end_n, BN):
        col_n = start_n + off_n
        cmask = col_n < seqlen_k

        # load k

        k_ptr = K + b * stride_kb + h * stride_kh + col_n[:, None] * stride_kn + off_d[None, :]

        if EVEN_N & EVEN_HEADDIM:
            k = tl.load(k_ptr)
        else:
            k = tl.load(k_ptr, mask = cmask[:, None] & mask_d[None, :], other = 0.0)

        # compute qk

        if HAS_POPE:
            k = _apply_softplus(k, mask_r)
            fk = tl.load(Freqs + b * stride_fb + h * stride_fh + col_n[:, None] * stride_fi + off_d[None, :], mask = cmask[:, None] & mask_r[None, :], other = 0.0)
            bias = tl.load(PopeBias + h * stride_pbh + off_d, mask = mask_r, other = 0.0)
            th_k = (fk + bias[None, :]).to(tl.float32)
            k_cos, k_sin = _apply_rotations(k, th_k, mask_r)
            qk = tl.dot(q_cos, tl.trans(k_cos)) + tl.dot(q_sin, tl.trans(k_sin))
        else:
            qk = tl.dot(q_cos, tl.trans(k))

        qk *= softmax_scale

        # masking

        if IS_CAUSAL:
            qk += tl.where(off_m[:, None] + q_off >= col_n[None, :], 0, float('-inf'))

        if HAS_MASK:
            mask = tl.load(Mask + b * stride_kmb + col_n * stride_kmn, mask = cmask, other = False)
            qk += tl.where(mask[None, :], 0, float('-inf'))

        if not EVEN_N:
            qk += tl.where(cmask[None, :], 0, float('-inf'))

        # online softmax update

        m_j = tl.max(qk, 1)
        prob = tl.exp(qk - tl.where(m_j == float('-inf'), 0.0, m_j)[:, None])
        prob = tl.where(m_j[:, None] == float('-inf'), 0.0, prob)
        l_j = tl.sum(prob, 1)

        m_new = tl.maximum(max_i, m_j)
        m_safe = tl.where(m_new == float('-inf'), 0.0, m_new)
        alpha = tl.exp(max_i - m_safe)
        beta = tl.exp(m_j - m_safe)

        acc *= alpha[:, None]

        # load v and accumulate

        v_ptr = V + b * stride_vb + h * stride_vh + col_n[:, None] * stride_vn + off_d[None, :]

        if EVEN_N & EVEN_HEADDIM:
            v = tl.load(v_ptr)
        else:
            v = tl.load(v_ptr, mask = cmask[:, None] & mask_d[None, :], other = 0.0)

        if IS_DROPOUT:
            drop_offset = (bhid * seqlen_q + off_m[:, None]) * seqlen_k + col_n[None, :]
            keep = tl.rand(drop_seed, drop_offset) > dropout_p
            prob = tl.where(keep, prob / (1.0 - dropout_p), 0.0)

        acc += tl.dot(prob.to(v.dtype), v) * beta[:, None]
        sum_i = sum_i * alpha + l_j * beta
        max_i = m_new

    # normalize and store

    acc /= tl.where(sum_i == 0.0, 1.0, sum_i)[:, None]

    tl.store(Out + b * stride_ob + h * stride_oh + off_m[:, None] * stride_om + off_d[None, :], acc.to(Out.dtype.element_ty), mask = mask_m[:, None] & mask_d[None, :])
    tl.store(Lse + bhid * seqlen_q + off_m, max_i + tl.log(sum_i), mask = mask_m)

# backward preprocess - compute delta = rowsum(o * do)

@triton.jit
def _bwd_preprocess(
    Out, DO, Delta,
    stride_ob, stride_oh, stride_om,
    stride_db, stride_dh, stride_dm,
    n_heads, seqlen_q, d,
    BM: tl.constexpr, BLOCK_D: tl.constexpr,
):
    bhid = tl.program_id(1)
    b = bhid // n_heads
    h = bhid % n_heads

    off_m = tl.program_id(0) * BM + tl.arange(0, BM)
    off_d = tl.arange(0, BLOCK_D)
    mask = (off_m < seqlen_q)[:, None] & (off_d < d)[None, :]

    o = tl.load(Out + b * stride_ob + h * stride_oh + off_m[:, None] * stride_om + off_d[None, :], mask = mask, other = 0.0).to(tl.float32)
    do = tl.load(DO + b * stride_db + h * stride_dh + off_m[:, None] * stride_dm + off_d[None, :], mask = mask, other = 0.0).to(tl.float32)

    tl.store(Delta + bhid * seqlen_q + off_m, tl.sum(o * do, 1), mask = off_m < seqlen_q)

# backward kernel

@triton.heuristics({
    'EVEN_M': lambda args: args['seqlen_q'] % args['BM'] == 0,
    'EVEN_N': lambda args: args['seqlen_k'] % args['BN'] == 0,
    'EVEN_HEADDIM': lambda args: args['headdim'] == args['BLOCK_HEADDIM'],
})
@triton.jit
def _bwd_kernel(
    Q, K, V, Freqs, PopeBias, DO, DQ, DK, DV, DFreqs, DPopeBias, Lse, Delta, Mask,
    softmax_scale,
    stride_qb, stride_qh, stride_qm,
    stride_kb, stride_kh, stride_kn,
    stride_vb, stride_vh, stride_vn,
    stride_fb, stride_fh, stride_fi,
    stride_pbh,
    stride_db, stride_dh, stride_dm,
    stride_dqb, stride_dqh, stride_dqm,
    stride_dkb, stride_dkh, stride_dkn,
    stride_dvb, stride_dvh, stride_dvn,
    stride_dfb, stride_dfh, stride_dfi,
    stride_kmb, stride_kmn,
    n_heads, seqlen_q, seqlen_k, headdim, rotate_dim, dropout_p, drop_seed,
    HAS_POPE: tl.constexpr, IS_CAUSAL: tl.constexpr, HAS_MASK: tl.constexpr, IS_DROPOUT: tl.constexpr,
    BLOCK_HEADDIM: tl.constexpr, EVEN_M: tl.constexpr, EVEN_N: tl.constexpr, EVEN_HEADDIM: tl.constexpr,
    BM: tl.constexpr, BN: tl.constexpr,
):
    bhid = tl.program_id(1)
    b = bhid // n_heads
    h = bhid % n_heads
    blk_n = tl.program_id(0)

    off_m = tl.arange(0, BM)
    off_n = blk_n * BN + tl.arange(0, BN)
    off_d = tl.arange(0, BLOCK_HEADDIM)

    mask_n = off_n < seqlen_k
    mask_d = off_d < headdim
    mask_r = off_d < rotate_dim

    # load k, v for this block

    k = tl.load(K + b * stride_kb + h * stride_kh + off_n[:, None] * stride_kn + off_d[None, :], mask = mask_n[:, None] & mask_d[None, :], other = 0.0)
    v = tl.load(V + b * stride_vb + h * stride_vh + off_n[:, None] * stride_vn + off_d[None, :], mask = mask_n[:, None] & mask_d[None, :], other = 0.0)

    # apply pope rotary to k

    if HAS_POPE:
        act_k = _apply_softplus(k, mask_r)
        fk = tl.load(Freqs + b * stride_fb + h * stride_fh + off_n[:, None] * stride_fi + off_d[None, :], mask = mask_n[:, None] & mask_r[None, :], other = 0.0)
        bias = tl.load(PopeBias + h * stride_pbh + off_d, mask = mask_r, other = 0.0)
        th_k = (fk + bias[None, :]).to(tl.float32)
        k_cos, k_sin = _apply_rotations(act_k, th_k, mask_r)
    else:
        k_cos, k_sin = k, None

    # gradient accumulators

    d_v = tl.zeros([BN, BLOCK_HEADDIM], tl.float32)
    d_k = tl.zeros([BN, BLOCK_HEADDIM], tl.float32)

    q_off = seqlen_k - seqlen_q

    # iterate over q blocks

    for start_m in range(0, seqlen_q, BM):
        cur_m = start_m + off_m
        mask_m = cur_m < seqlen_q

        q = tl.load(Q + b * stride_qb + h * stride_qh + cur_m[:, None] * stride_qm + off_d[None, :], mask = mask_m[:, None] & mask_d[None, :], other = 0.0)

        # recompute attention

        if HAS_POPE:
            act_q = _apply_softplus(q, mask_r)
            fq = tl.load(Freqs + b * stride_fb + h * stride_fh + (q_off + cur_m[:, None]) * stride_fi + off_d[None, :], mask = mask_m[:, None] & mask_r[None, :], other = 0.0).to(tl.float32)
            q_cos, q_sin = _apply_rotations(act_q, fq, mask_r)
            qk = tl.dot(q_cos, tl.trans(k_cos)) + tl.dot(q_sin, tl.trans(k_sin))
        else:
            qk = tl.dot(q, tl.trans(k))

        qk *= softmax_scale

        if IS_CAUSAL:
            qk += tl.where(cur_m[:, None] + q_off >= off_n[None, :], 0, float('-inf'))

        if HAS_MASK:
            mask = tl.load(Mask + b * stride_kmb + off_n * stride_kmn, mask = mask_n, other = False)
            qk += tl.where(mask[None, :], 0, float('-inf'))

        # recompute prob from lse

        lse = tl.load(Lse + bhid * seqlen_q + cur_m, mask = mask_m, other = float('-inf'))
        prob = tl.exp(qk - tl.where(lse == float('-inf'), 0.0, lse)[:, None])
        prob = tl.where((lse[:, None] == float('-inf')) | (~mask_m[:, None]), 0.0, prob)

        # dv, dp

        do = tl.load(DO + b * stride_db + h * stride_dh + cur_m[:, None] * stride_dm + off_d[None, :], mask = mask_m[:, None] & mask_d[None, :], other = 0.0)

        if IS_DROPOUT:
            drop_offset = (bhid * seqlen_q + cur_m[:, None]) * seqlen_k + off_n[None, :]
            keep = tl.rand(drop_seed, drop_offset) > dropout_p
            prob_drop = tl.where(keep, prob / (1.0 - dropout_p), 0.0)
        else:
            prob_drop = prob

        d_v += tl.dot(tl.trans(prob_drop.to(do.dtype)), do)
        dp = tl.dot(do.to(prob.dtype), tl.trans(v.to(prob.dtype)))

        if IS_DROPOUT:
            dp = tl.where(keep, dp / (1.0 - dropout_p), 0.0)

        delta = tl.load(Delta + bhid * seqlen_q + cur_m, mask = mask_m, other = 0.0)
        ds = prob * (dp - delta[:, None]) * softmax_scale

        # dq, dk gradients

        if HAS_POPE:
            dqkc = tl.dot(ds.to(q_cos.dtype), k_cos)
            dqks = tl.dot(ds.to(k_sin.dtype), k_sin)
            dq = tl.where(mask_r[None, :], (dqkc * tl.cos(fq).to(dqkc.dtype) + dqks * tl.sin(fq).to(dqks.dtype)) * _softplus_grad(q.to(tl.float32)).to(q.dtype), dqkc)

            dkkc = tl.dot(tl.trans(ds.to(q_cos.dtype)), q_cos)
            dkks = tl.dot(tl.trans(ds.to(q_sin.dtype)), q_sin)
            d_k += tl.where(mask_r[None, :], (dkkc * tl.cos(th_k).to(dkkc.dtype) + dkks * tl.sin(th_k).to(dkks.dtype)) * _softplus_grad(k.to(tl.float32)).to(k.dtype), dkkc)

            # dfreqs, dpope_bias via atomic_add

            dfq = (dqks.to(tl.float32) * q_cos.to(tl.float32) - dqkc.to(tl.float32) * q_sin.to(tl.float32)).to(DFreqs.dtype.element_ty)
            tl.atomic_add(DFreqs + b * stride_dfb + h * stride_dfh + (q_off + cur_m[:, None]) * stride_dfi + off_d[None, :], dfq, mask = mask_m[:, None] & mask_r[None, :])

            dfk = (dkks.to(tl.float32) * k_cos.to(tl.float32) - dkkc.to(tl.float32) * k_sin.to(tl.float32)).to(DFreqs.dtype.element_ty)
            tl.atomic_add(DFreqs + b * stride_dfb + h * stride_dfh + off_n[:, None] * stride_dfi + off_d[None, :], dfk, mask = mask_n[:, None] & mask_r[None, :])
            tl.atomic_add(DPopeBias + h * stride_pbh + off_d, tl.sum(dfk, 0), mask = mask_r)
        else:
            dq = tl.dot(ds.to(k.dtype), k)
            d_k += tl.dot(tl.trans(ds.to(q.dtype)), q)

        # dq via atomic_add (accumulated across k-blocks)

        tl.atomic_add(DQ + b * stride_dqb + h * stride_dqh + cur_m[:, None] * stride_dqm + off_d[None, :], dq.to(DQ.dtype.element_ty), mask = mask_m[:, None] & mask_d[None, :])

    # store dk, dv

    tl.store(DV + b * stride_dvb + h * stride_dvh + off_n[:, None] * stride_dvn + off_d[None, :], d_v.to(DV.dtype.element_ty), mask = mask_n[:, None] & mask_d[None, :])
    tl.store(DK + b * stride_dkb + h * stride_dkh + off_n[:, None] * stride_dkn + off_d[None, :], d_k.to(DK.dtype.element_ty), mask = mask_n[:, None] & mask_d[None, :])

# wrapper functions

def flash_attn_forward(q, k, v, freqs = None, pope_bias = None, mask = None, causal = False, softmax_scale = None, dropout = 0., drop_seed = 0):
    batch, seq_q, heads, d = q.shape
    seq_k = k.shape[1]

    scale = default(softmax_scale, d ** -0.5)
    has_p = exists(freqs) and exists(pope_bias)

    f_str = _freq_strides(freqs) if has_p else (0, 0, 0)
    pb_str = pope_bias.stride(0) if has_p else 0
    rot = freqs.shape[-1] if has_p else 0
    m_str = _mask_strides(mask)

    lse = torch.empty((batch, heads, seq_q), device = q.device, dtype = torch.float32)
    o = torch.empty_like(q)
    blk_d = max(triton.next_power_of_2(d), 16)
    configs = _filter_configs(_fwd_configs(), blk_d, q.element_size(), q.device.index)

    if _NO_AUTOTUNE:
        bm, bn = configs[0].kwargs['BM'], configs[0].kwargs['BN']
        grid = (triton.cdiv(seq_q, bm), batch * heads)
        _fwd_kernel[grid](
            q, k, v, freqs, pope_bias, o, lse, mask, scale,
            q.stride(0), q.stride(2), q.stride(1),
            k.stride(0), k.stride(2), k.stride(1),
            v.stride(0), v.stride(2), v.stride(1),
            *f_str, pb_str,
            o.stride(0), o.stride(2), o.stride(1),
            *m_str,
            heads, seq_q, seq_k, d, rot, dropout, drop_seed,
            has_p, causal, exists(mask), dropout > 0.0,
            BLOCK_HEADDIM = blk_d, BM = bm, BN = bn,
            num_warps = 4, num_stages = 1,
        )
    else:
        kernel = get_autotuned_kernel(_fwd_kernel, _fwd_configs, ('seqlen_q', 'seqlen_k', 'headdim'), blk_d, q.element_size(), q.device.index)
        grid = lambda META: (triton.cdiv(seq_q, META['BM']), batch * heads)
        kernel[grid](
            q, k, v, freqs, pope_bias, o, lse, mask, scale,
            q.stride(0), q.stride(2), q.stride(1),
            k.stride(0), k.stride(2), k.stride(1),
            v.stride(0), v.stride(2), v.stride(1),
            *f_str, pb_str,
            o.stride(0), o.stride(2), o.stride(1),
            *m_str,
            heads, seq_q, seq_k, d, rot, dropout, drop_seed,
            has_p, causal, exists(mask), dropout > 0.0,
            BLOCK_HEADDIM = blk_d,
        )

    return o, lse

def flash_attn_backward(do, q, k, v, o, lse, dq, dk, dv, dfreqs = None, dpope_bias = None, freqs = None, pope_bias = None, mask = None, causal = False, softmax_scale = None, dropout = 0., drop_seed = 0):
    batch, seq_q, heads, d = q.shape
    seq_k = k.shape[1]

    scale = default(softmax_scale, d ** -0.5)
    blk_d = max(triton.next_power_of_2(d), 16)

    # preprocess: delta = rowsum(o * do)

    delta = torch.empty_like(lse)
    bm_pre = 32

    _bwd_preprocess[(triton.cdiv(seq_q, bm_pre), batch * heads)](
        o, do, delta,
        o.stride(0), o.stride(2), o.stride(1),
        do.stride(0), do.stride(2), do.stride(1),
        heads, seq_q, d, bm_pre, blk_d,
    )

    has_p = exists(freqs) and exists(pope_bias)

    f_str = _freq_strides(freqs) if has_p else (0, 0, 0)
    df_str = _freq_strides(dfreqs) if has_p and exists(dfreqs) else (0, 0, 0)
    pb_str = pope_bias.stride(0) if has_p else 0
    rot = freqs.shape[-1] if has_p else 0
    m_str = _mask_strides(mask)

    elem_bytes = q.element_size()
    dev = q.device.index
    bwd_configs = _filter_configs(_bwd_configs(), blk_d, elem_bytes, dev)

    if _NO_AUTOTUNE:
        bm, bn = bwd_configs[0].kwargs['BM'], bwd_configs[0].kwargs['BN']
        nw = 4 if d > 32 else 2
        grid = (triton.cdiv(seq_k, bn), batch * heads)
        _bwd_kernel[grid](
            q, k, v, freqs, pope_bias, do, dq, dk, dv, dfreqs, dpope_bias, lse, delta, mask, scale,
            q.stride(0), q.stride(2), q.stride(1),
            k.stride(0), k.stride(2), k.stride(1),
            v.stride(0), v.stride(2), v.stride(1),
            *f_str, pb_str,
            do.stride(0), do.stride(2), do.stride(1),
            dq.stride(0), dq.stride(2), dq.stride(1),
            dk.stride(0), dk.stride(2), dk.stride(1),
            dv.stride(0), dv.stride(2), dv.stride(1),
            *df_str, *m_str,
            heads, seq_q, seq_k, d, rot, dropout, drop_seed,
            has_p, causal, exists(mask), dropout > 0.0,
            BLOCK_HEADDIM = blk_d, BM = bm, BN = bn,
            num_warps = nw, num_stages = 1,
        )
    else:
        kernel = get_autotuned_kernel(_bwd_kernel, _bwd_configs, ('seqlen_q', 'seqlen_k', 'headdim'), blk_d, elem_bytes, dev)
        grid = lambda META: (triton.cdiv(seq_k, META['BN']), batch * heads)
        kernel[grid](
            q, k, v, freqs, pope_bias, do, dq, dk, dv, dfreqs, dpope_bias, lse, delta, mask, scale,
            q.stride(0), q.stride(2), q.stride(1),
            k.stride(0), k.stride(2), k.stride(1),
            v.stride(0), v.stride(2), v.stride(1),
            *f_str, pb_str,
            do.stride(0), do.stride(2), do.stride(1),
            dq.stride(0), dq.stride(2), dq.stride(1),
            dk.stride(0), dk.stride(2), dk.stride(1),
            dv.stride(0), dv.stride(2), dv.stride(1),
            *df_str, *m_str,
            heads, seq_q, seq_k, d, rot, dropout, drop_seed,
            has_p, causal, exists(mask), dropout > 0.0,
            BLOCK_HEADDIM = blk_d,
        )

# autograd wrapper

class FlashAttnFunction(Function):
    @staticmethod
    def forward(ctx, q, k, v, freqs = None, pope_bias = None, mask = None, causal = False, softmax_scale = None, dropout = 0.):
        drop_seed = int(torch.randint(0, 2**31 - 1, (1,), device=q.device).item()) if dropout > 0. else 0
        o, lse = flash_attn_forward(q, k, v, freqs, pope_bias, mask, causal, softmax_scale, dropout, drop_seed)
        ctx.save_for_backward(q, k, v, freqs, pope_bias, mask, o, lse)
        ctx.causal = causal
        ctx.softmax_scale = softmax_scale
        ctx.dropout = dropout
        ctx.drop_seed = drop_seed
        return o

    @staticmethod
    def backward(ctx, do):
        do = do.contiguous()
        q, k, v, f, pb, m, o, lse = ctx.saved_tensors

        dq = torch.zeros_like(q, dtype = torch.float32)
        dk = torch.zeros_like(k)
        dv = torch.zeros_like(v)
        df = torch.zeros_like(f) if exists(f) else None
        dpb = torch.zeros_like(pb) if exists(pb) else None

        flash_attn_backward(do, q, k, v, o, lse, dq, dk, dv, df, dpb, f, pb, m, ctx.causal, ctx.softmax_scale, ctx.dropout, ctx.drop_seed)
        return dq.to(q.dtype), dk, dv, df, dpb, None, None, None, None

# public api

def flash_attn(q, k, v, freqs = None, pope_bias = None, mask = None, causal = False, softmax_scale = None, dropout = 0.):
    q, k, v = map(lambda t: t.contiguous(), (q, k, v))
    return FlashAttnFunction.apply(q, k, v, freqs, pope_bias, mask, causal, softmax_scale, dropout)
