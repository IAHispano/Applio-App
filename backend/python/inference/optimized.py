"""File-inference optimizations for the pinned Applio engine.

The adapter is app-owned: the engine submodule stays reproducible. It retains
the engine's F0 predictors, feature extractor, decoder, precision and padding.
"""

import sys
import weakref

import numpy as np
import torch
import torch.nn.functional as F

# Initialize AMD's runtime settings before importing inference operators.
import rvc.lib.zluda  # noqa: F401
from rvc.infer import pipeline as engine

from backend.python.inference.algorithms import (
    RetrievalIndexCache,
    autotune_f0,
    retrieve_embeddings,
)


class VectorizedAutotune(engine.Autotune):
    def autotune_f0(self, f0, f0_autotune_strength):
        return autotune_f0(f0, self.note_dict, f0_autotune_strength)


def materialize_inference_weights(module):
    """Evaluate fixed parametrizations once, as the realtime decoder does."""
    if not isinstance(module, torch.nn.Module) or module.training:
        return
    with torch.no_grad():
        for layer in list(module.modules()):
            if hasattr(layer, "weight_g") and hasattr(layer, "weight_v"):
                torch.nn.utils.remove_weight_norm(layer)
            if hasattr(layer, "parametrizations"):
                for name in list(layer.parametrizations):
                    torch.nn.utils.parametrize.remove_parametrizations(
                        layer, name, leave_parametrized=True
                    )


class OptimizedPipeline(engine.Pipeline):
    def __init__(self, tgt_sr, config):
        super().__init__(tgt_sr, config)
        self.autotune = VectorizedAutotune()
        self.index_cache = RetrievalIndexCache(engine.faiss.read_index)
        self.prepared_decoder = None

    def _retrieve_speaker_embeddings(self, feats, index, big_npy, index_rate):
        retrieved = retrieve_embeddings(feats[0].cpu().numpy(), index, big_npy)
        return (
            torch.from_numpy(retrieved).unsqueeze(0).to(self.device) * index_rate
            + (1 - index_rate) * feats
        )

    def voice_conversion(
        self,
        model,
        net_g,
        sid,
        audio0,
        pitch,
        pitchf,
        index,
        big_npy,
        index_rate,
        version,
        protect,
    ):
        with torch.no_grad():
            if self.prepared_decoder is None or self.prepared_decoder() is not net_g:
                materialize_inference_weights(net_g)
                self.prepared_decoder = weakref.ref(net_g)
            pitch_guidance = pitch is not None and pitchf is not None
            feats = torch.from_numpy(audio0).float()
            feats = feats.mean(-1) if feats.dim() == 2 else feats
            assert feats.dim() == 1, feats.dim()
            feats = model(feats.view(1, -1).to(self.device))["last_hidden_state"]
            if version == "v1":
                feats = model.final_proj(feats[0]).unsqueeze(0)
            # A protection copy is consumed only when protection is active.
            feats0 = feats.clone() if pitch_guidance and protect < 0.5 else None
            if index is not None:
                feats = self._retrieve_speaker_embeddings(
                    feats, index, big_npy, index_rate
                )
            feats = F.interpolate(feats.permute(0, 2, 1), scale_factor=2).permute(
                0, 2, 1
            )
            p_len = min(audio0.shape[0] // self.window, feats.shape[1])
            if pitch_guidance:
                pitch, pitchf = pitch[:, :p_len], pitchf[:, :p_len].float()
                if feats0 is not None:
                    feats0 = F.interpolate(
                        feats0.permute(0, 2, 1), scale_factor=2
                    ).permute(0, 2, 1)
                    pitchff = pitchf.clone()
                    pitchff[pitchf > 0] = 1
                    pitchff[pitchf < 1] = protect
                    feats = feats * pitchff.unsqueeze(-1) + feats0 * (
                        1 - pitchff.unsqueeze(-1)
                    )
                    feats = feats.to(feats0.dtype)
            else:
                pitch, pitchf = None, None
            p_len = torch.tensor([p_len], device=self.device).long()
            return (
                net_g.infer(feats.float(), p_len, pitch, pitchf, sid)[0][0, 0]
                .detach()
                .cpu()
                .float()
                .numpy()
            )

    def pipeline(
        self,
        model,
        net_g,
        sid,
        audio,
        pitch,
        f0_method,
        file_index,
        index_rate,
        pitch_guidance,
        volume_envelope,
        version,
        protect,
        f0_autotune,
        f0_autotune_strength,
        proposed_pitch,
        proposed_pitch_threshold,
    ):
        index, big_npy = self.index_cache.get(file_index, index_rate)
        audio = engine.signal.filtfilt(engine.bh, engine.ah, audio)
        opt_ts = []
        if len(audio) + self.window > self.t_max:
            audio_pad = np.pad(
                audio, (self.window // 2, self.window // 2), mode="reflect"
            )
            # Linear-time box sum replaces 160 full-array passes. Filtering
            # produces float64 audio, so accumulation stays in float64.
            cumulative = np.empty(len(audio_pad) + 1, dtype=np.float64)
            cumulative[0] = 0
            np.cumsum(audio_pad, dtype=np.float64, out=cumulative[1:])
            audio_sum = (cumulative[self.window :] - cumulative[: -self.window])[
                : len(audio)
            ]
            for t in range(self.t_center, len(audio), self.t_center):
                region = np.abs(audio_sum[t - self.t_query : t + self.t_query])
                opt_ts.append(t - self.t_query + int(region.argmin()))
            del cumulative, audio_sum

        audio_pad = np.pad(audio, (self.t_pad, self.t_pad), mode="reflect")
        p_len = len(audio_pad) // self.window
        sid = torch.tensor(sid, device=self.device).unsqueeze(0).long()
        if pitch_guidance:
            pitch, pitchf = self.get_f0(
                audio_pad,
                p_len,
                f0_method,
                pitch,
                f0_autotune,
                f0_autotune_strength,
                proposed_pitch,
                proposed_pitch_threshold,
            )
            pitch = torch.tensor(pitch[:p_len], device=self.device).unsqueeze(0).long()
            pitchf = (
                torch.from_numpy(np.asarray(pitchf[:p_len], dtype=np.float32))
                .to(self.device)
                .unsqueeze(0)
            )
        else:
            pitch = pitchf = None

        converted = []
        start = 0
        for cut in opt_ts:
            cut = cut // self.window * self.window
            end = cut + self.t_pad2
            converted.append(
                self.voice_conversion(
                    model,
                    net_g,
                    sid,
                    audio_pad[start : end + self.window],
                    (
                        pitch[:, start // self.window : end // self.window]
                        if pitch_guidance
                        else None
                    ),
                    (
                        pitchf[:, start // self.window : end // self.window]
                        if pitch_guidance
                        else None
                    ),
                    index,
                    big_npy,
                    index_rate,
                    version,
                    protect,
                )[self.t_pad_tgt : -self.t_pad_tgt]
            )
            start = cut
        converted.append(
            self.voice_conversion(
                model,
                net_g,
                sid,
                audio_pad[start:],
                pitch[:, start // self.window :] if pitch_guidance else None,
                pitchf[:, start // self.window :] if pitch_guidance else None,
                index,
                big_npy,
                index_rate,
                version,
                protect,
            )[self.t_pad_tgt : -self.t_pad_tgt]
        )
        audio_opt = np.concatenate(converted)
        if volume_envelope != 1:
            audio_opt = engine.AudioProcessor.change_rms(
                audio, self.sample_rate, audio_opt, self.tgt_sr, volume_envelope
            )
        audio_max = np.abs(audio_opt).max() / 0.99
        if audio_max > 1:
            audio_opt /= audio_max
        # Keep CUDA's allocator reusable between chunks/files. Model cleanup
        # and worker teardown still release resources through the engine.
        return audio_opt


def install():
    """Install before importing the worker or running the engine's CLI."""
    engine.Pipeline = OptimizedPipeline
    # The app CLI can install after another command imported inference.
    infer = sys.modules.get("rvc.infer.infer")
    if infer is not None:
        infer.VC = OptimizedPipeline
