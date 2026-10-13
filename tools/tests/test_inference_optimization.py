"""Numerical/behavioral regression tests against the pinned inference engine."""

from pathlib import Path
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import faiss
import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "applio"))
from rvc.infer.pipeline import Autotune, Pipeline
from rvc.lib.tools.split_audio import merge_audio as original_merge
from tools.inference_algorithms import (
    RetrievalIndexCache,
    autotune_f0,
    merge_audio,
    retrieve_embeddings,
)
from tools.optimized_inference import OptimizedPipeline, materialize_inference_weights


class InferenceAlgorithmsTests(unittest.TestCase):
    def test_autotune_matches_scalar_search_including_ties_and_unvoiced_frames(self):
        original = Autotune()
        rng = np.random.default_rng(15)
        for dtype in (np.float32, np.float64):
            notes = np.asarray(original.note_dict, dtype=dtype)
            f0 = np.concatenate(
                (rng.uniform(0, 1400, 10000), [0, 49], (notes[:-1] + notes[1:]) / 2)
            ).astype(dtype)
            for strength in (0, 0.25, 1):
                np.testing.assert_array_equal(
                    autotune_f0(f0, original.note_dict, strength),
                    original.autotune_f0(f0, strength),
                )
        self.assertEqual(autotune_f0(np.empty(0), original.note_dict, 1).size, 0)

    def test_retrieval_matches_original_formula_and_bounds_neighbor_gathers(self):
        rng = np.random.default_rng(18)
        vectors = rng.normal(size=(193, 32)).astype(np.float32)
        queries = rng.normal(size=(681, 32)).astype(np.float32)
        index = faiss.IndexFlatL2(32)
        index.add(vectors)
        scores, neighbors = index.search(queries, 8)
        weights = np.square(1 / scores)
        weights /= weights.sum(axis=1, keepdims=True)
        expected = (vectors[neighbors] * weights[:, :, None]).sum(axis=1)
        bounded = Mock(wraps=index)

        class ObservedVectors:
            sizes = []

            def __len__(self):
                return len(vectors)

            def __getitem__(self, neighbors):
                self.sizes.append(len(neighbors))
                return vectors[neighbors]

        observed = ObservedVectors()
        np.testing.assert_array_equal(
            retrieve_embeddings(queries, bounded, observed, batch_size=64), expected
        )
        self.assertEqual(bounded.search.call_count, 1)
        self.assertGreater(len(observed.sizes), 1)
        self.assertTrue(all(size <= 64 for size in observed.sizes))

    def test_exact_matches_missing_neighbors_and_empty_index_stay_finite(self):
        vectors = np.asarray([[1, 2], [1, 2], [3, 4]], dtype=np.float32)
        index = faiss.IndexFlatL2(2)
        index.add(vectors)
        queries = np.asarray([[1, 2], [2, 3]], dtype=np.float32)
        result = retrieve_embeddings(queries, index, vectors)
        np.testing.assert_array_equal(result[0], queries[0])
        self.assertTrue(np.isfinite(result).all())
        empty = faiss.IndexFlatL2(2)
        np.testing.assert_array_equal(
            retrieve_embeddings(queries, empty, np.empty((0, 2))), queries
        )
        missing = Mock()
        missing.search.return_value = (
            np.full((2, 8), np.inf, dtype=np.float32),
            np.full((2, 8), -1),
        )
        np.testing.assert_array_equal(
            retrieve_embeddings(queries, missing, vectors), queries
        )
        near_zero = Mock()
        near_zero.search.return_value = (
            np.asarray([[1e-30, 2e-30] + [np.inf] * 6], dtype=np.float32),
            np.asarray([[0, 2] + [-1] * 6]),
        )
        tiny_result = retrieve_embeddings(queries[:1], near_zero, vectors)
        self.assertTrue(np.isfinite(tiny_result).all())
        np.testing.assert_allclose(tiny_result[0], vectors[0] * 0.8 + vectors[2] * 0.2)

    def test_index_cache_reuses_refreshes_evicts_and_obeys_budget(self):
        with tempfile.TemporaryDirectory() as folder:
            filename = Path(folder) / "voice.index"
            filename.write_bytes(b"initial")
            index = Mock(ntotal=8)
            index.reconstruct_n.return_value = np.ones((8, 2), dtype=np.float32)
            loader = Mock(return_value=index)
            cache = RetrievalIndexCache(loader, max_bytes=1000)
            first = cache.get(filename, 0.75)
            self.assertIs(cache.get(filename, 0.5)[1], first[1])
            self.assertEqual(loader.call_count, 1)
            self.assertEqual(index.reconstruct_n.call_count, 1)
            filename.write_bytes(b"replacement")
            cache.get(filename, 1)
            self.assertEqual(loader.call_count, 2)
            cache.get(filename, 0)
            self.assertIsNone(cache.vectors)
            cache.get(filename, 1)
            self.assertEqual(loader.call_count, 3)
            tiny = RetrievalIndexCache(loader, max_bytes=1)
            tiny.get(filename, 1)
            self.assertIsNone(tiny.vectors)
            tiny.get(filename, 1)
            self.assertEqual(loader.call_count, 5)
            filename.unlink()
            self.assertEqual(cache.get(filename, 1), (None, None))
            self.assertIsNone(cache.index)

    def test_changing_index_during_read_never_publishes_stale_data(self):
        with tempfile.TemporaryDirectory() as folder:
            filename = Path(folder) / "voice.index"
            filename.write_bytes(b"before")
            index = Mock(ntotal=1)

            def reconstruct(*args):
                filename.write_bytes(b"changed while loading")
                return np.ones((1, 2), dtype=np.float32)

            index.reconstruct_n.side_effect = reconstruct
            cache = RetrievalIndexCache(Mock(return_value=index))
            self.assertEqual(cache.get(filename, 1), (None, None))
            self.assertIsNone(cache.key)

    def test_merge_preserves_gaps_overlong_chunks_and_sample_rate_rounding(self):
        for rate in (24000, 32000, 40000, 44100, 48000):
            for dtype in (np.float32, np.float64):
                segments = [
                    np.arange(18, dtype=dtype),
                    np.arange(5, dtype=dtype),
                    np.arange(20, dtype=dtype),
                ]
                intervals = np.asarray([[2, 7], [10, 11], [15, 23]])
                np.testing.assert_array_equal(
                    merge_audio([], segments, intervals, 16000, rate),
                    original_merge([], segments, intervals, 16000, rate),
                )
        self.assertEqual(merge_audio([], [], [], 16000, 40000).size, 0)


class FeatureModel:
    def __call__(self, audio):
        # Deterministic feature extractor with the same temporal stride as HuBERT.
        count = max(1, (audio.shape[1] - 400) // 320 + 1)
        frames = audio[:, : count * 320].reshape(1, count, 320)
        return {
            "last_hidden_state": torch.stack(
                (
                    frames.mean(-1),
                    frames.square().mean(-1),
                    frames[:, :, 0],
                    frames[:, :, -1],
                ),
                dim=-1,
            )
        }

    def final_proj(self, feats):
        return feats * 0.9


class Decoder:
    def infer(self, feats, length, pitch, pitchf, sid):
        audio = feats[0, : int(length[0])].sum(-1).repeat_interleave(400)
        return (audio.reshape(1, 1, -1),)


class PipelineParityTests(unittest.TestCase):
    def setUp(self):
        self.config = SimpleNamespace(
            x_pad=1, x_query=1, x_center=2, x_max=3, device="cpu"
        )
        self.rng = np.random.default_rng(92)
        self.model, self.decoder = FeatureModel(), Decoder()

    def test_weight_materialization_preserves_legacy_and_modern_decoder_output(self):
        inputs = torch.linspace(-1, 1, 96).reshape(1, 2, 48)
        for weight_norm in (
            torch.nn.utils.weight_norm,
            torch.nn.utils.parametrizations.weight_norm,
        ):
            module = weight_norm(torch.nn.Conv1d(2, 4, 3)).eval()
            before = module(inputs).detach()
            materialize_inference_weights(module)
            materialize_inference_weights(module)
            self.assertFalse(hasattr(module, "parametrizations"))
            self.assertFalse(hasattr(module, "weight_g"))
            torch.testing.assert_close(module(inputs).detach(), before, rtol=0, atol=0)
        training = torch.nn.utils.parametrizations.weight_norm(torch.nn.Conv1d(2, 4, 3))
        materialize_inference_weights(training)
        self.assertTrue(hasattr(training, "parametrizations"))

    def test_features_match_with_and_without_retrieval_and_pitch_protection(self):
        audio = self.rng.normal(0, 0.1, 16000).astype(np.float64)
        vectors = self.rng.normal(size=(19, 4)).astype(np.float32)
        index = faiss.IndexFlatL2(4)
        index.add(vectors)
        pitch = torch.full((1, 100), 100)
        pitchf = torch.tensor([[0, 120] * 50], dtype=torch.float32)
        original = Pipeline(40000, self.config)
        optimized = OptimizedPipeline(40000, self.config)
        for version in ("v1", "v2"):
            for protect in (0, 0.33, 0.5):
                for retrieval in (None, index):
                    for guidance in (False, True):
                        args = (
                            self.model,
                            self.decoder,
                            torch.tensor([0]),
                            audio,
                            pitch if guidance else None,
                            pitchf if guidance else None,
                            retrieval,
                            vectors,
                            0.75,
                            version,
                            protect,
                        )
                        np.testing.assert_allclose(
                            optimized.voice_conversion(*args),
                            original.voice_conversion(*args),
                            rtol=2e-5,
                            atol=1e-6,
                        )

    def test_long_file_padding_cut_positions_and_envelope_match(self):
        # Ten seconds forces multiple cuts and a final query reaching EOF.
        audio = self.rng.normal(0, 0.1, 160000).astype(np.float32)
        for guidance in (False, True):
            for envelope in (0.25, 1):
                original = Pipeline(40000, self.config)
                optimized = OptimizedPipeline(40000, self.config)

                def f0(x, length, *args):
                    return np.full(length, 100), np.full(length, 120, dtype=np.float64)

                original.get_f0 = optimized.get_f0 = f0
                args = (
                    self.model,
                    self.decoder,
                    0,
                    audio,
                    0,
                    "rmvpe",
                    "",
                    0,
                    guidance,
                    envelope,
                    "v2",
                    0.33,
                    False,
                    1,
                    False,
                    155,
                )
                with patch("torch.cuda.empty_cache") as empty_cache:
                    expected = original.pipeline(*args)
                    empty_cache.reset_mock()
                    actual = optimized.pipeline(*args)
                    empty_cache.assert_not_called()
                np.testing.assert_allclose(actual, expected, rtol=2e-5, atol=1e-6)


if __name__ == "__main__":
    unittest.main()
