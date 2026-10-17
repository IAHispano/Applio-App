import os
import torch
import triton
import triton.language as tl

from einops import repeat

# helpers

def exists(v):
    return v is not None

def divisible_by(num, den):
    return (num % den) == 0

# activation

@triton.jit
def softplus(x):
    return tl.where(x > 20., x, tl.log(1. + tl.exp(x)))

@triton.jit
def softplus_grad(x):
    return tl.sigmoid(x)

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

def _bwd_dqk_pre_hook(nargs):
    """Zero dFreqs buffer before each autotuner benchmark run."""
    df = nargs.get('dFreqs')
    if df is not None:
        df.zero_()

def _bwd_dbias_pre_hook(nargs):
    """Zero dBias buffer before each autotuner benchmark run."""
    nargs['dBias'].zero_()

def _fwd_configs():
    return [
        triton.Config({'BM': 64, 'BN': 32}, num_stages = 1, num_warps = 4),
        triton.Config({'BM': 32, 'BN': 64}, num_stages = 1, num_warps = 4),
        triton.Config({'BM': 32, 'BN': 32}, num_stages = 2, num_warps = 4),
        triton.Config({'BM': 16, 'BN': 16}, num_stages = 1, num_warps = 4),
    ]

def _bwd_dqk_configs():
    return [
        triton.Config({'BM': 64, 'BN': 32}, num_stages = 1, num_warps = 4, pre_hook = _bwd_dqk_pre_hook),
        triton.Config({'BM': 32, 'BN': 64}, num_stages = 1, num_warps = 4, pre_hook = _bwd_dqk_pre_hook),
        triton.Config({'BM': 32, 'BN': 32}, num_stages = 2, num_warps = 4, pre_hook = _bwd_dqk_pre_hook),
        triton.Config({'BM': 16, 'BN': 16}, num_stages = 1, num_warps = 4, pre_hook = _bwd_dqk_pre_hook),
    ]

def _bwd_dbias_configs():
    return [
        triton.Config({'BM': 64, 'BN': 32}, num_stages = 1, num_warps = 4, pre_hook = _bwd_dbias_pre_hook),
        triton.Config({'BM': 32, 'BN': 32}, num_stages = 2, num_warps = 4, pre_hook = _bwd_dbias_pre_hook),
        triton.Config({'BM': 16, 'BN': 16}, num_stages = 1, num_warps = 4, pre_hook = _bwd_dbias_pre_hook),
    ]

# forward kernel

@triton.jit
def _fwd_kernel(
    Q, K, Freqs, Bias, Out,
    stride_qb, stride_qh, stride_qi, stride_qd,
    stride_kb, stride_kh, stride_kj, stride_kd,
    stride_fb, stride_fh, stride_fi, stride_fd,
    stride_bh, stride_bd,
    stride_ob, stride_oh, stride_oi, stride_oj,
    n_heads, seq_q, seq_k, head_dim, rotate_dim,
    BM: tl.constexpr, BN: tl.constexpr, BLOCK_D: tl.constexpr,
    ALLOW_TF32: tl.constexpr,
):
    bhid = tl.program_id(0)
    blk_m = tl.program_id(1)
    blk_n = tl.program_id(2)

    b = bhid // n_heads
    h = bhid % n_heads

    off_i = blk_m * BM + tl.arange(0, BM)
    off_j = blk_n * BN + tl.arange(0, BN)
    off_d = tl.arange(0, BLOCK_D)

    mask_i = off_i < seq_q
    mask_j = off_j < seq_k

    acc = tl.zeros((BM, BN), dtype = tl.float32)
    q_off = seq_k - seq_q

    for d_start in range(0, head_dim, BLOCK_D):
        mask_d = (d_start + off_d) < head_dim
        mask_r = (d_start + off_d) < rotate_dim

        # load q, k

        q = tl.load(Q + b * stride_qb + h * stride_qh + off_i[:, None] * stride_qi + (d_start + off_d[None, :]) * stride_qd, mask = mask_i[:, None] & mask_d[None, :], other = 0.0)
        k = tl.load(K + b * stride_kb + h * stride_kh + off_j[:, None] * stride_kj + (d_start + off_d[None, :]) * stride_kd, mask = mask_j[:, None] & mask_d[None, :], other = 0.0)

        # load freqs, bias

        fq = tl.load(Freqs + b * stride_fb + h * stride_fh + (q_off + off_i[:, None]) * stride_fi + (d_start + off_d[None, :]) * stride_fd, mask = mask_i[:, None] & mask_r[None, :], other = 0.0)
        fk = tl.load(Freqs + b * stride_fb + h * stride_fh + off_j[:, None] * stride_fi + (d_start + off_d[None, :]) * stride_fd, mask = mask_j[:, None] & mask_r[None, :], other = 0.0)
        bias = tl.load(Bias + h * stride_bh + (d_start + off_d), mask = mask_r, other = 0.0)

        # softplus activation

        act_q = tl.where(mask_r[None, :], softplus(q), q)
        act_k = tl.where(mask_r[None, :], softplus(k), k)

        # rotary embedding

        q_cos = tl.where(mask_r[None, :], act_q * tl.cos(fq), act_q)
        q_sin = tl.where(mask_r[None, :], act_q * tl.sin(fq), 0.0)

        th_k = fk + bias[None, :]
        k_cos = tl.where(mask_r[None, :], act_k * tl.cos(th_k), act_k)
        k_sin = tl.where(mask_r[None, :], act_k * tl.sin(th_k), 0.0)

        # accumulate similarity

        acc = tl.dot(q_cos, tl.trans(k_cos), acc, allow_tf32 = ALLOW_TF32)
        acc = tl.dot(q_sin, tl.trans(k_sin), acc, allow_tf32 = ALLOW_TF32)

    tl.store(Out + b * stride_ob + h * stride_oh + off_i[:, None] * stride_oi + off_j[None, :] * stride_oj, acc, mask = mask_i[:, None] & mask_j[None, :])

# backward kernel - computes dQ (MODE=0) or dK (MODE=1) + dFreqs
# each MODE gets its own dFreqs buffer so pre_hook can safely zero it

@triton.jit
def _bwd_kernel_dqk_df(
    dQ, dK, dFreqs, dS, Q, K, Freqs, Bias,
    stride_dqb, stride_dqh, stride_dqi, stride_dqd,
    stride_dkb, stride_dkh, stride_dkj, stride_dkd,
    stride_dfb, stride_dfh, stride_dfi, stride_dfd,
    stride_sb, stride_sh, stride_si, stride_sj,
    stride_qb, stride_qh, stride_qi, stride_qd,
    stride_kb, stride_kh, stride_kj, stride_kd,
    stride_fb, stride_fh, stride_fi, stride_fd,
    stride_bh, stride_bd,
    n_heads, seq_q, seq_k, head_dim, rotate_dim,
    BM: tl.constexpr, BN: tl.constexpr, BLOCK_D: tl.constexpr,
    MODE: tl.constexpr,
    ALLOW_TF32: tl.constexpr,
    HAS_DF: tl.constexpr,
):
    bhid = tl.program_id(0)
    grid_idx = tl.program_id(1)

    b = bhid // n_heads
    h = bhid % n_heads
    off_d = tl.arange(0, BLOCK_D)
    q_off = seq_k - seq_q

    if MODE == 0:
        # compute dQ by iterating over k-blocks

        off_i = grid_idx * BM + tl.arange(0, BM)
        mask_i = off_i < seq_q

        for d_start in range(0, head_dim, BLOCK_D):
            mask_d = (d_start + off_d) < head_dim
            mask_r = (d_start + off_d) < rotate_dim

            d_q = tl.zeros((BM, BLOCK_D), dtype = tl.float32)
            d_fq = tl.zeros((BM, BLOCK_D), dtype = tl.float32)

            # load and precompute q-side quantities

            q = tl.load(Q + b * stride_qb + h * stride_qh + off_i[:, None] * stride_qi + (d_start + off_d[None, :]) * stride_qd, mask = mask_i[:, None] & mask_d[None, :], other = 0.0)
            fq = tl.load(Freqs + b * stride_fb + h * stride_fh + (q_off + off_i[:, None]) * stride_fi + (d_start + off_d[None, :]) * stride_fd, mask = mask_i[:, None] & mask_r[None, :], other = 0.0)

            sp_dq = tl.where(mask_r[None, :], softplus_grad(q), 1.0)
            cos_fq = tl.where(mask_r[None, :], tl.cos(fq), 1.0)
            sin_fq = tl.where(mask_r[None, :], tl.sin(fq), 0.0)
            act_q = tl.where(mask_r[None, :], softplus(q), q)

            for j_start in range(0, seq_k, BN):
                off_j = j_start + tl.arange(0, BN)
                mask_j = off_j < seq_k

                # load grad and k-side quantities

                ds = tl.load(dS + b * stride_sb + h * stride_sh + off_i[:, None] * stride_si + off_j[None, :] * stride_sj, mask = mask_i[:, None] & mask_j[None, :], other = 0.0)

                k = tl.load(K + b * stride_kb + h * stride_kh + off_j[:, None] * stride_kj + (d_start + off_d[None, :]) * stride_kd, mask = mask_j[:, None] & mask_d[None, :], other = 0.0)
                fk = tl.load(Freqs + b * stride_fb + h * stride_fh + off_j[:, None] * stride_fi + (d_start + off_d[None, :]) * stride_fd, mask = mask_j[:, None] & mask_r[None, :], other = 0.0)
                bias = tl.load(Bias + h * stride_bh + (d_start + off_d), mask = mask_r, other = 0.0)

                act_k = tl.where(mask_r[None, :], softplus(k), k)
                th_k = fk + bias[None, :]
                cos_tk = tl.where(mask_r[None, :], tl.cos(th_k), 1.0)
                sin_tk = tl.where(mask_r[None, :], tl.sin(th_k), 0.0)

                dot_cos = tl.dot(ds, (act_k * cos_tk).to(tl.float32), allow_tf32 = ALLOW_TF32)
                dot_sin = tl.dot(ds, (act_k * sin_tk).to(tl.float32), allow_tf32 = ALLOW_TF32)

                d_q += sp_dq * (cos_fq * dot_cos + sin_fq * dot_sin)
                if HAS_DF:
                    d_fq += act_q * (cos_fq * dot_sin - sin_fq * dot_cos)

            tl.store(dQ + b * stride_dqb + h * stride_dqh + off_i[:, None] * stride_dqi + (d_start + off_d[None, :]) * stride_dqd, d_q, mask = mask_i[:, None] & mask_d[None, :])
            if HAS_DF:
                tl.atomic_add(dFreqs + b * stride_dfb + h * stride_dfh + (q_off + off_i[:, None]) * stride_dfi + (d_start + off_d[None, :]) * stride_dfd, d_fq, mask = mask_i[:, None] & mask_r[None, :])

    else:
        # MODE == 1: compute dK by iterating over q-blocks

        off_j = grid_idx * BN + tl.arange(0, BN)
        mask_j = off_j < seq_k

        for d_start in range(0, head_dim, BLOCK_D):
            mask_d = (d_start + off_d) < head_dim
            mask_r = (d_start + off_d) < rotate_dim

            d_k = tl.zeros((BN, BLOCK_D), dtype = tl.float32)
            d_fk = tl.zeros((BN, BLOCK_D), dtype = tl.float32)

            # load and precompute k-side quantities

            k = tl.load(K + b * stride_kb + h * stride_kh + off_j[:, None] * stride_kj + (d_start + off_d[None, :]) * stride_kd, mask = mask_j[:, None] & mask_d[None, :], other = 0.0)
            fk = tl.load(Freqs + b * stride_fb + h * stride_fh + off_j[:, None] * stride_fi + (d_start + off_d[None, :]) * stride_fd, mask = mask_j[:, None] & mask_r[None, :], other = 0.0)
            bias = tl.load(Bias + h * stride_bh + (d_start + off_d), mask = mask_r, other = 0.0)

            sp_dk = tl.where(mask_r[None, :], softplus_grad(k), 1.0)
            th_k = fk + bias[None, :]
            cos_tk = tl.where(mask_r[None, :], tl.cos(th_k), 1.0)
            sin_tk = tl.where(mask_r[None, :], tl.sin(th_k), 0.0)
            act_k = tl.where(mask_r[None, :], softplus(k), k)

            for i_start in range(0, seq_q, BM):
                off_i = i_start + tl.arange(0, BM)
                mask_i = off_i < seq_q

                ds = tl.load(dS + b * stride_sb + h * stride_sh + off_i[:, None] * stride_si + off_j[None, :] * stride_sj, mask = mask_i[:, None] & mask_j[None, :], other = 0.0)

                q = tl.load(Q + b * stride_qb + h * stride_qh + off_i[:, None] * stride_qi + (d_start + off_d[None, :]) * stride_qd, mask = mask_i[:, None] & mask_d[None, :], other = 0.0)
                fq = tl.load(Freqs + b * stride_fb + h * stride_fh + (q_off + off_i[:, None]) * stride_fi + (d_start + off_d[None, :]) * stride_fd, mask = mask_i[:, None] & mask_r[None, :], other = 0.0)

                act_q = tl.where(mask_r[None, :], softplus(q), q)
                cos_fq = tl.where(mask_r[None, :], tl.cos(fq), 1.0)
                sin_fq = tl.where(mask_r[None, :], tl.sin(fq), 0.0)

                dot_cos = tl.dot(tl.trans(ds), (act_q * cos_fq).to(tl.float32), allow_tf32 = ALLOW_TF32)
                dot_sin = tl.dot(tl.trans(ds), (act_q * sin_fq).to(tl.float32), allow_tf32 = ALLOW_TF32)

                d_k += sp_dk * (cos_tk * dot_cos + sin_tk * dot_sin)
                if HAS_DF:
                    d_fk += act_k * (cos_tk * dot_sin - sin_tk * dot_cos)

            tl.store(dK + b * stride_dkb + h * stride_dkh + off_j[:, None] * stride_dkj + (d_start + off_d[None, :]) * stride_dkd, d_k, mask = mask_j[:, None] & mask_d[None, :])
            if HAS_DF:
                tl.atomic_add(dFreqs + b * stride_dfb + h * stride_dfh + off_j[:, None] * stride_dfi + (d_start + off_d[None, :]) * stride_dfd, d_fk, mask = mask_j[:, None] & mask_r[None, :])

# backward kernel for bias gradient

@triton.jit
def _bwd_kernel_dbias(
    dBias, dS, Q, K, Freqs, Bias,
    stride_sb, stride_sh, stride_si, stride_sj,
    stride_qb, stride_qh, stride_qi, stride_qd,
    stride_kb, stride_kh, stride_kj, stride_kd,
    stride_fb, stride_fh, stride_fi, stride_fd,
    stride_bh, stride_bd,
    batch, n_heads, seq_q, seq_k, head_dim, rotate_dim,
    BM: tl.constexpr, BN: tl.constexpr, BLOCK_D: tl.constexpr,
    ALLOW_TF32: tl.constexpr,
):
    bhid = tl.program_id(0)
    blk_m = tl.program_id(1)

    b = bhid // n_heads
    h = bhid % n_heads

    off_i = blk_m * BM + tl.arange(0, BM)
    mask_i = off_i < seq_q
    off_d = tl.arange(0, BLOCK_D)
    q_off = seq_k - seq_q

    for d_start in range(0, head_dim, BLOCK_D):
        mask_d = (d_start + off_d) < head_dim
        mask_r = (d_start + off_d) < rotate_dim

        # load q-side

        q = tl.load(Q + b * stride_qb + h * stride_qh + off_i[:, None] * stride_qi + (d_start + off_d[None, :]) * stride_qd, mask = mask_i[:, None] & mask_d[None, :], other = 0.0)
        fq = tl.load(Freqs + b * stride_fb + h * stride_fh + (q_off + off_i[:, None]) * stride_fi + (d_start + off_d[None, :]) * stride_fd, mask = mask_i[:, None] & mask_r[None, :], other = 0.0)

        act_q = tl.where(mask_r[None, :], softplus(q), q)
        cos_fq = tl.where(mask_r[None, :], tl.cos(fq), 1.0)
        sin_fq = tl.where(mask_r[None, :], tl.sin(fq), 0.0)

        d_bias = tl.zeros((BLOCK_D,), dtype = tl.float32)
        bias = tl.load(Bias + h * stride_bh + (d_start + off_d), mask = mask_r, other = 0.0)

        for j_start in range(0, seq_k, BN):
            off_j = j_start + tl.arange(0, BN)
            mask_j = off_j < seq_k

            ds = tl.load(dS + b * stride_sb + h * stride_sh + off_i[:, None] * stride_si + off_j[None, :] * stride_sj, mask = mask_i[:, None] & mask_j[None, :], other = 0.0)

            k = tl.load(K + b * stride_kb + h * stride_kh + off_j[:, None] * stride_kj + (d_start + off_d[None, :]) * stride_kd, mask = mask_j[:, None] & mask_d[None, :], other = 0.0)
            fk = tl.load(Freqs + b * stride_fb + h * stride_fh + off_j[:, None] * stride_fi + (d_start + off_d[None, :]) * stride_fd, mask = mask_j[:, None] & mask_r[None, :], other = 0.0)

            act_k = tl.where(mask_r[None, :], softplus(k), k)
            th_k = fk + bias[None, :]
            cos_tk = tl.where(mask_r[None, :], tl.cos(th_k), 1.0)
            sin_tk = tl.where(mask_r[None, :], tl.sin(th_k), 0.0)

            # dbias = sum_ij ds_ij * d/dbias (q_cos_i . k_cos_j + q_sin_i . k_sin_j)
            #       = sum_ij ds_ij * sum_d (act_q * sin_fq)(act_k * cos_tk) - (act_q * cos_fq)(act_k * sin_tk)

            q_sin_d = (act_q * sin_fq).to(tl.float32)
            q_cos_d = (act_q * cos_fq).to(tl.float32)
            k_cos_d = (act_k * cos_tk).to(tl.float32)
            k_sin_d = (act_k * sin_tk).to(tl.float32)

            dot_sc = tl.dot(tl.trans(ds), q_sin_d, allow_tf32 = ALLOW_TF32)
            dot_cc = tl.dot(tl.trans(ds), q_cos_d, allow_tf32 = ALLOW_TF32)
            d_bias += tl.sum(k_cos_d * dot_sc - k_sin_d * dot_cc, axis = 0)

        if d_start < rotate_dim:
            tl.atomic_add(dBias + h * stride_bh + (d_start + off_d), d_bias, mask = mask_d & mask_r)

# autograd wrapper

class PoPESimilarityFunction(torch.autograd.Function):
    @staticmethod
    def forward(ctx, q, k, freqs, bias, rotate_dim, allow_tf32):
        b, h, seq_q, d = q.shape
        seq_k = k.shape[2]

        ctx.orig_freqs_shape = freqs.shape
        ctx.freqs_requires_grad = freqs.requires_grad
        ctx.bias_requires_grad = bias.requires_grad

        # expand freqs to (b, h, seq, rotate_dim) if needed

        if freqs.ndim == 2:
            freqs = freqs.view(1, 1, freqs.shape[0], rotate_dim).expand(b, h, freqs.shape[0], rotate_dim)
        elif freqs.ndim == 3:
            freqs = freqs.view(freqs.shape[0], 1, freqs.shape[1], rotate_dim).expand(b, h, freqs.shape[1], rotate_dim)

        freqs = freqs.contiguous()
        sim = torch.empty((b, h, seq_q, seq_k), device = q.device, dtype = q.dtype)
        blk_d = max(triton.next_power_of_2(d), 16)

        configs = _filter_configs(_fwd_configs(), blk_d, q.element_size(), q.device.index)

        if _NO_AUTOTUNE:
            bm, bn = configs[0].kwargs['BM'], configs[0].kwargs['BN']
            grid = (b * h, triton.cdiv(seq_q, bm), triton.cdiv(seq_k, bn))
            _fwd_kernel[grid](
                q, k, freqs, bias, sim,
                q.stride(0), q.stride(1), q.stride(2), q.stride(3),
                k.stride(0), k.stride(1), k.stride(2), k.stride(3),
                freqs.stride(0), freqs.stride(1), freqs.stride(2), freqs.stride(3),
                bias.stride(0), bias.stride(1),
                sim.stride(0), sim.stride(1), sim.stride(2), sim.stride(3),
                h, seq_q, seq_k, d, rotate_dim,
                BM = bm, BN = bn, BLOCK_D = blk_d, ALLOW_TF32 = allow_tf32,
            )
        else:
            kernel = get_autotuned_kernel(_fwd_kernel, _fwd_configs, ('seq_q', 'seq_k', 'head_dim'), blk_d, q.element_size(), q.device.index)
            grid = lambda META: (b * h, triton.cdiv(seq_q, META['BM']), triton.cdiv(seq_k, META['BN']))
            kernel[grid](
                q, k, freqs, bias, sim,
                q.stride(0), q.stride(1), q.stride(2), q.stride(3),
                k.stride(0), k.stride(1), k.stride(2), k.stride(3),
                freqs.stride(0), freqs.stride(1), freqs.stride(2), freqs.stride(3),
                bias.stride(0), bias.stride(1),
                sim.stride(0), sim.stride(1), sim.stride(2), sim.stride(3),
                h, seq_q, seq_k, d, rotate_dim,
                BLOCK_D = blk_d, ALLOW_TF32 = allow_tf32,
            )

        ctx.save_for_backward(q, k, freqs, bias)
        ctx.rotate_dim = rotate_dim
        ctx.allow_tf32 = allow_tf32
        return sim

    @staticmethod
    def backward(ctx, grad_sim):
        q, k, freqs, bias = ctx.saved_tensors
        rotate_dim = ctx.rotate_dim
        allow_tf32 = ctx.allow_tf32
        b, h, seq_q, d = q.shape
        seq_k = k.shape[2]

        dq = torch.zeros_like(q, dtype = torch.float32)
        dk = torch.empty_like(k)
        has_df = ctx.freqs_requires_grad
        has_db = ctx.bias_requires_grad
        dfreqs = torch.zeros_like(freqs, dtype = torch.float32) if has_df else None
        dbias = torch.zeros_like(bias, dtype = torch.float32) if has_db else None

        grad_sim = grad_sim.contiguous()
        blk_d = max(triton.next_power_of_2(d), 16)
        elem_bytes = q.element_size()
        dev = q.device.index

        dqk_configs = _filter_configs(_bwd_dqk_configs(), blk_d, elem_bytes, dev)
        dbias_configs = _filter_configs(_bwd_dbias_configs(), blk_d, elem_bytes, dev)

        if _NO_AUTOTUNE:
            bm, bn = dqk_configs[0].kwargs['BM'], dqk_configs[0].kwargs['BN']
        else:
            kernel_dqk = get_autotuned_kernel(_bwd_kernel_dqk_df, _bwd_dqk_configs, ('seq_q', 'seq_k', 'head_dim'), blk_d, elem_bytes, dev)
            kernel_dbias = get_autotuned_kernel(_bwd_kernel_dbias, _bwd_dbias_configs, ('seq_q', 'seq_k', 'head_dim'), blk_d, elem_bytes, dev)

        # shared stride args for both backward calls

        dfreqs_strides = lambda df: (
            df.stride(0) if exists(df) else 0,
            df.stride(1) if exists(df) else 0,
            df.stride(2) if exists(df) else 0,
            df.stride(3) if exists(df) else 0,
        )

        # separate dFreqs buffers for MODE=0 and MODE=1
        # so autotuner pre_hook can safely zero each independently

        dfreqs_q = torch.zeros_like(freqs, dtype = torch.float32) if has_df else None
        dfreqs_k = torch.zeros_like(freqs, dtype = torch.float32) if has_df else None

        # MODE=0: compute dQ

        if _NO_AUTOTUNE:
            _bwd_kernel_dqk_df[(b * h, triton.cdiv(seq_q, bm))](
                dq, dk, dfreqs_q, grad_sim, q, k, freqs, bias,
                dq.stride(0), dq.stride(1), dq.stride(2), dq.stride(3),
                dk.stride(0), dk.stride(1), dk.stride(2), dk.stride(3),
                *dfreqs_strides(dfreqs_q),
                grad_sim.stride(0), grad_sim.stride(1), grad_sim.stride(2), grad_sim.stride(3),
                q.stride(0), q.stride(1), q.stride(2), q.stride(3),
                k.stride(0), k.stride(1), k.stride(2), k.stride(3),
                freqs.stride(0), freqs.stride(1), freqs.stride(2), freqs.stride(3),
                bias.stride(0), bias.stride(1),
                h, seq_q, seq_k, d, rotate_dim,
                BM = bm, BN = bn, BLOCK_D = blk_d,
                MODE = 0, ALLOW_TF32 = allow_tf32, HAS_DF = has_df,
            )
        else:
            grid_q = lambda META: (b * h, triton.cdiv(seq_q, META['BM']))
            kernel_dqk[grid_q](
                dq, dk, dfreqs_q, grad_sim, q, k, freqs, bias,
                dq.stride(0), dq.stride(1), dq.stride(2), dq.stride(3),
                dk.stride(0), dk.stride(1), dk.stride(2), dk.stride(3),
                *dfreqs_strides(dfreqs_q),
                grad_sim.stride(0), grad_sim.stride(1), grad_sim.stride(2), grad_sim.stride(3),
                q.stride(0), q.stride(1), q.stride(2), q.stride(3),
                k.stride(0), k.stride(1), k.stride(2), k.stride(3),
                freqs.stride(0), freqs.stride(1), freqs.stride(2), freqs.stride(3),
                bias.stride(0), bias.stride(1),
                h, seq_q, seq_k, d, rotate_dim,
                BLOCK_D = blk_d,
                MODE = 0, ALLOW_TF32 = allow_tf32, HAS_DF = has_df,
            )

        # MODE=1: compute dK

        if _NO_AUTOTUNE:
            _bwd_kernel_dqk_df[(b * h, triton.cdiv(seq_k, bn))](
                dq, dk, dfreqs_k, grad_sim, q, k, freqs, bias,
                dq.stride(0), dq.stride(1), dq.stride(2), dq.stride(3),
                dk.stride(0), dk.stride(1), dk.stride(2), dk.stride(3),
                *dfreqs_strides(dfreqs_k),
                grad_sim.stride(0), grad_sim.stride(1), grad_sim.stride(2), grad_sim.stride(3),
                q.stride(0), q.stride(1), q.stride(2), q.stride(3),
                k.stride(0), k.stride(1), k.stride(2), k.stride(3),
                freqs.stride(0), freqs.stride(1), freqs.stride(2), freqs.stride(3),
                bias.stride(0), bias.stride(1),
                h, seq_q, seq_k, d, rotate_dim,
                BM = bm, BN = bn, BLOCK_D = blk_d,
                MODE = 1, ALLOW_TF32 = allow_tf32, HAS_DF = has_df,
            )
        else:
            grid_k = lambda META: (b * h, triton.cdiv(seq_k, META['BN']))
            kernel_dqk[grid_k](
                dq, dk, dfreqs_k, grad_sim, q, k, freqs, bias,
                dq.stride(0), dq.stride(1), dq.stride(2), dq.stride(3),
                dk.stride(0), dk.stride(1), dk.stride(2), dk.stride(3),
                *dfreqs_strides(dfreqs_k),
                grad_sim.stride(0), grad_sim.stride(1), grad_sim.stride(2), grad_sim.stride(3),
                q.stride(0), q.stride(1), q.stride(2), q.stride(3),
                k.stride(0), k.stride(1), k.stride(2), k.stride(3),
                freqs.stride(0), freqs.stride(1), freqs.stride(2), freqs.stride(3),
                bias.stride(0), bias.stride(1),
                h, seq_q, seq_k, d, rotate_dim,
                BLOCK_D = blk_d,
                MODE = 1, ALLOW_TF32 = allow_tf32, HAS_DF = has_df,
            )

        # compute dBias

        if exists(dbias):
            if _NO_AUTOTUNE:
                _bwd_kernel_dbias[(b * h, triton.cdiv(seq_q, bm))](
                    dbias, grad_sim, q, k, freqs, bias,
                    grad_sim.stride(0), grad_sim.stride(1), grad_sim.stride(2), grad_sim.stride(3),
                    q.stride(0), q.stride(1), q.stride(2), q.stride(3),
                    k.stride(0), k.stride(1), k.stride(2), k.stride(3),
                    freqs.stride(0), freqs.stride(1), freqs.stride(2), freqs.stride(3),
                    bias.stride(0), bias.stride(1),
                    b, h, seq_q, seq_k, d, rotate_dim,
                    BM = bm, BN = bn, BLOCK_D = blk_d, ALLOW_TF32 = allow_tf32,
                )
            else:
                grid_b = lambda META: (b * h, triton.cdiv(seq_q, META['BM']))
                kernel_dbias[grid_b](
                    dbias, grad_sim, q, k, freqs, bias,
                    grad_sim.stride(0), grad_sim.stride(1), grad_sim.stride(2), grad_sim.stride(3),
                    q.stride(0), q.stride(1), q.stride(2), q.stride(3),
                    k.stride(0), k.stride(1), k.stride(2), k.stride(3),
                    freqs.stride(0), freqs.stride(1), freqs.stride(2), freqs.stride(3),
                    bias.stride(0), bias.stride(1),
                    b, h, seq_q, seq_k, d, rotate_dim,
                    BLOCK_D = blk_d, ALLOW_TF32 = allow_tf32,
                )

        # sum separate dFreqs buffers and reduce to original shape

        if exists(dfreqs_q):
            dfreqs = dfreqs_q + dfreqs_k
            ndim = len(ctx.orig_freqs_shape)
            if ndim == 2:
                dfreqs_out = dfreqs.sum(dim = (0, 1)).to(q.dtype)
            elif ndim == 3:
                dfreqs_out = dfreqs.sum(dim = 1).to(q.dtype)
            else:
                dfreqs_out = dfreqs.to(q.dtype)
        else:
            dfreqs_out = None

        dbias_out = dbias.to(q.dtype) if exists(dbias) else None
        return dq.to(q.dtype), dk, dfreqs_out, dbias_out, None, None

# public api

def triton_compute_qk_similarity(q, k, freqs, bias, rotate_dim, allow_tf32 = True):
    assert divisible_by(q.shape[1], k.shape[1])

    q, k = q.contiguous(), k.contiguous()

    groups = q.shape[1] // k.shape[1]
    k = repeat(k, 'b h ... -> b (g h) ...', g = groups)
    bias = repeat(bias, 'h ... -> (g h) ...', g = groups)

    return PoPESimilarityFunction.apply(q, k, freqs, bias, rotate_dim, allow_tf32)
