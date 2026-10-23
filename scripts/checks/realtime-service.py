"""Check the realtime adapter, plus RVC numerics when ML packages are installed."""

import ast
import asyncio
import importlib.util
import os
import sys
import tempfile
import threading
import types
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch


class RealtimeServiceTests(unittest.TestCase):
    def setUp(self):
        self.converter = Mock(side_effect=lambda *a, **kw: object())
        self.embedding = Mock(side_effect=lambda *a, **kw: Mock(spec=["to", "eval"]))
        self.strip = Mock()
        self.f0 = Mock(side_effect=lambda *a, **kw: object())
        pipeline = types.ModuleType("rvc.realtime.pipeline")
        pipeline.RealtimeVoiceConverter = self.converter
        pipeline.load_embedding = self.embedding
        pipeline.strip_parametrizations = self.strip
        pipeline.inference_config = lambda: types.SimpleNamespace(device="cpu")
        pipeline.Realtime_Pipeline = type("Pipeline", (), {"setup_f0": self.f0})
        client = types.ModuleType("rvc.realtime.client")
        client.app = object()
        client.VoiceChanger = Mock(side_effect=AssertionError("speculative GPU load"))
        configuration = types.ModuleType("rvc.realtime.configuration")
        realtime = types.ModuleType("rvc.realtime")
        realtime.client = client
        realtime.configuration = configuration
        realtime.pipeline = pipeline
        modules = {
            "rvc": types.ModuleType("rvc"),
            "rvc.realtime": realtime,
            "rvc.realtime.client": client,
            "rvc.realtime.configuration": configuration,
            "rvc.realtime.pipeline": pipeline,
        }
        spec = importlib.util.spec_from_file_location(
            "realtime_service_check",
            Path(__file__).resolve().parents[2] / "backend/python/realtime/service.py",
        )
        self.service = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, modules), patch.dict(
            os.environ, {"APPLIO_REALTIME_PREWARM": "1"}
        ), patch.object(threading.Thread, "start") as start:
            spec.loader.exec_module(self.service)
            start.assert_not_called()
        client.VoiceChanger.assert_not_called()
        self.converter.assert_not_called()
        self.embedding.assert_not_called()
        self.f0.assert_not_called()
        self.pipeline = pipeline
        self.configuration = configuration

    def test_server_start_is_lazy_even_with_legacy_prewarm_flag(self):
        self.assertTrue(self.service._installed)
        self.assertIs(
            self.configuration.RealtimeVoiceConverter,
            self.pipeline.RealtimeVoiceConverter,
        )
        self.assertNotIn("torch", self.service.__dict__)

    def test_engine_rejects_direct_browser_requests_before_loading_models(self):
        async def check():
            for kind in ("http", "websocket"):
                for headers, allowed in (
                    ([(b"host", b"127.0.0.1:8001")], True),
                    (
                        [
                            (b"host", b"127.0.0.1:8001"),
                            (b"origin", b"https://attacker.example"),
                        ],
                        False,
                    ),
                    (
                        [
                            (b"host", b"127.0.0.1:8001"),
                            (b"origin", b"http://127.0.0.1:3000"),
                        ],
                        False,
                    ),
                    ([(b"host", b"rebind.example:8001")], False),
                    (
                        [
                            (b"host", b"127.0.0.1:8001"),
                            (b"sec-fetch-site", b"cross-site"),
                        ],
                        False,
                    ),
                    ([], False),
                ):
                    downstream, receive, send = AsyncMock(), AsyncMock(), AsyncMock()
                    app = self.service.LocalRealtimeApp(downstream)
                    scope = {"type": kind, "headers": headers}
                    await app(scope, receive, send)
                    if allowed:
                        downstream.assert_awaited_once_with(scope, receive, send)
                        send.assert_not_awaited()
                    else:
                        downstream.assert_not_awaited()
                        first = send.await_args_list[0].args[0]
                        self.assertEqual(
                            first.get("status", first.get("code")),
                            403 if kind == "http" else 1008,
                        )

        asyncio.run(check())

    def test_model_reuse_invalidates_changed_weights_and_device(self):
        with tempfile.TemporaryDirectory() as directory:
            weight = Path(directory) / "model.pth"
            weight.write_bytes(b"first")
            load = self.pipeline.RealtimeVoiceConverter
            first = load(weight, "cpu")
            self.assertIs(first, load(weight, "cpu"))
            self.assertIsNot(first, load(weight, "cuda"))
            weight.write_bytes(b"changed weights")
            self.assertIsNot(first, load(weight, "cpu"))
            self.assertEqual(self.converter.call_count, 3)

    def test_concurrent_connections_share_a_single_load(self):
        with ThreadPoolExecutor(max_workers=8) as pool:
            results = list(
                pool.map(
                    lambda _: self.pipeline.RealtimeVoiceConverter("model", "cpu"),
                    range(32),
                )
            )
        self.assertTrue(all(value is results[0] for value in results))
        self.converter.assert_called_once()

    def test_embedding_preparation_and_f0_cache_keys(self):
        embedding = self.pipeline.load_embedding("contentvec")
        self.assertIs(embedding, self.pipeline.load_embedding("contentvec"))
        self.pipeline.strip_parametrizations(embedding)
        self.strip.assert_called_once_with(embedding)
        embedding.to.assert_called_once_with("cpu")
        pipeline = self.pipeline.Realtime_Pipeline()
        pipeline.device, pipeline.sample_rate, pipeline.window, pipeline.use_f0 = (
            "cpu",
            48000,
            160,
            True,
        )
        first = pipeline.setup_f0("fcpe")
        self.assertIs(first, pipeline.setup_f0("fcpe"))
        pipeline.device = "cuda"
        self.assertIsNot(first, pipeline.setup_f0("fcpe"))
        pipeline.window = 320
        pipeline.setup_f0("fcpe")
        self.assertEqual(self.f0.call_count, 3)


@unittest.skipUnless(
    all(
        importlib.util.find_spec(name)
        for name in ("torch", "numpy", "librosa", "soundfile")
    ),
    "RVC numerical checks require the engine's Python environment",
)
class RvcNumericsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.root = Path(__file__).resolve().parents[2]
        sys.path[:0] = [str(cls.root / "backend/applio"), str(cls.root)]
        import numpy as np
        import torch

        cls.np, cls.torch = np, torch

    def _engine_method(self, relative_path, class_name, method_name):
        source = self.root / "backend/applio" / relative_path
        tree = ast.parse(source.read_text(encoding="utf-8"))
        cls = next(
            node for node in tree.body
            if isinstance(node, ast.ClassDef) and node.name == class_name
        )
        method = next(
            node for node in cls.body
            if isinstance(node, ast.FunctionDef) and node.name == method_name
        )
        namespace = {"torch": self.torch, "np": self.np, "IndexWrapper": object}
        code = compile(ast.Module(body=[method], type_ignores=[]), str(source), "exec")
        exec(code, namespace)
        return namespace[method_name]

    def test_crops_preserve_values_gradients_and_short_inputs(self):
        from rvc.lib.algorithm.commons import slice_segments

        torch = self.torch
        for shape, dim in (((3, 15), 2), ((3, 4, 15), 3)):
            x = torch.arange(torch.tensor(shape).prod()).float().reshape(shape)
            x = x[..., ::2].detach().requires_grad_()
            starts = torch.tensor([0, 2, 4])
            expected = torch.stack(
                [x[i, ..., start : start + 4] for i, start in enumerate((0, 2, 4))]
            )
            result = slice_segments(x, starts, 4, dim)
            torch.testing.assert_close(result, expected, rtol=0, atol=0)
            torch.testing.assert_close(
                slice_segments(x, starts[:, None], 4, dim), expected, rtol=0, atol=0
            )
            actual_grad = torch.autograd.grad(result.sum(), x)[0]
            expected_grad = torch.autograd.grad(expected.sum(), x)[0]
            torch.testing.assert_close(actual_grad, expected_grad, rtol=0, atol=0)
            torch.testing.assert_close(
                torch.jit.script(slice_segments)(x, starts, 4, dim), result
            )
        x = torch.arange(6).reshape(2, 3)
        torch.testing.assert_close(
            slice_segments(x, torch.zeros(2, dtype=torch.long), 8), x
        )

    def test_mixed_precision_losses_reduce_in_float32(self):
        from rvc.train.losses import feature_loss, kl_loss

        torch = self.torch
        real = torch.full((8,), 50000, dtype=torch.float16)
        fake = (-real).detach().requires_grad_()
        result = feature_loss([[real]], [[fake]])
        expected = 2 * (real.float() - fake.float()).abs().mean()
        self.assertEqual(result.dtype, torch.float32)
        torch.testing.assert_close(result, expected)
        result.backward()
        self.assertTrue(torch.isfinite(fake.grad).all())

        shape = (2, 192, 300)
        z = torch.ones(shape, dtype=torch.float16, requires_grad=True)
        logs_q, mean = torch.zeros_like(z), torch.zeros_like(z)
        logs_p = torch.full_like(z, -2)
        mask = torch.ones((2, 1, 300), dtype=torch.float16)
        result = kl_loss(z, logs_q, mean, logs_p, mask)
        expected = kl_loss(
            z.float(), logs_q.float(), mean.float(), logs_p.float(), mask.float()
        )
        self.assertEqual(result.dtype, torch.float32)
        torch.testing.assert_close(result, expected)
        self.assertTrue(torch.isfinite(result))
        result.backward()
        self.assertTrue(torch.isfinite(z.grad).all())

    def test_gradient_norm_includes_only_existing_gradients(self):
        from rvc.lib.algorithm.commons import grad_norm

        torch = self.torch
        params = [torch.nn.Parameter(torch.zeros(size)) for size in (3, 5, 8)]
        params[0].grad = torch.tensor([3.0, 4.0, 0.0])
        params[2].grad = torch.ones(8)
        expected = (
            torch.stack([p.grad.norm() for p in params if p.grad is not None])
            .norm()
            .item()
        )
        self.assertEqual(grad_norm(params), expected)
        deferred = grad_norm(params, return_tensor=True)
        self.assertIsInstance(deferred, torch.Tensor)
        self.assertFalse(deferred.requires_grad)
        self.assertEqual(deferred.item(), expected)
        self.assertEqual(grad_norm([]), 0.0)
        self.assertEqual(grad_norm([], return_tensor=True).item(), 0.0)
        self.assertEqual(grad_norm(params[1]), 0.0)
        with patch.object(torch.nn.utils, "get_total_norm", None, create=True):
            self.assertEqual(grad_norm(params), expected)
            self.assertEqual(grad_norm(params, return_tensor=True).item(), expected)

    def test_deferred_loss_tracking_preserves_steps_epochs_ties_and_nonfinite_values(self):
        torch = self.torch
        source = self.root / "backend/applio/rvc/train/train.py"
        tree = ast.parse(source.read_text(encoding="utf-8"))
        function = next(
            node for node in tree.body
            if isinstance(node, ast.FunctionDef) and node.name == "_update_lowest_loss"
        )
        namespace = {"torch": torch}
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
        update = namespace[function.name]
        initial = {"step": 0, "value": float("inf"), "epoch": 0}
        expected = initial
        actual = initial
        for epoch, values in ((1, [float("nan"), float("inf"), 3.0, 2.0, 2.0]),
                              (2, [2.0, 4.0]), (3, [-1.0, float("-inf"), 0.0])):
            pending = []
            for offset, value in enumerate(values):
                step = epoch * 100 + offset
                loss = torch.tensor(value, requires_grad=True)
                pending.append((step, loss.detach()))
                if loss.item() < expected["value"]:
                    expected = {"step": step, "value": loss.item(), "epoch": epoch}
            actual = update(pending, actual, epoch)
            self.assertEqual(actual, expected)
            self.assertEqual(pending, [])
            self.assertIs(update([], actual, epoch), actual)

    def test_interrupted_checkpoint_save_preserves_the_previous_file(self):
        from rvc.train.utils import atomic_torch_save

        torch = self.torch
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "G_latest.pth"
            atomic_torch_save({"iteration": 3, "weight": torch.ones(3)}, filename)
            previous = filename.read_bytes()
            if os.name != "nt":
                filename.chmod(0o640)

            def interrupted(value, stream):
                stream.write(b"incomplete checkpoint")
                raise OSError("Simulated full disk")

            with patch("rvc.train.utils.torch.save", side_effect=interrupted):
                with self.assertRaises(OSError):
                    atomic_torch_save({"iteration": 4}, filename)
            self.assertEqual(filename.read_bytes(), previous)
            with patch(
                "rvc.train.utils.os.replace",
                side_effect=PermissionError("Simulated sharing violation"),
            ):
                with self.assertRaises(PermissionError):
                    atomic_torch_save({"iteration": 4}, filename)
            self.assertEqual(filename.read_bytes(), previous)
            self.assertEqual(list(Path(directory).iterdir()), [filename])
            collision = Path(directory) / ".checkpoint-existing.tmp"
            collision.write_bytes(b"another operation owns this file")
            with patch("rvc.train.utils.secrets.token_hex", return_value="existing"):
                with self.assertRaises(FileExistsError):
                    atomic_torch_save({"iteration": 4}, filename)
            self.assertEqual(collision.read_bytes(), b"another operation owns this file")
            self.assertEqual(filename.read_bytes(), previous)
            collision.unlink()
            atomic_torch_save({"iteration": 4, "weight": torch.zeros(3)}, filename)
            result = torch.load(filename, weights_only=True)
            self.assertEqual(result["iteration"], 4)
            torch.testing.assert_close(result["weight"], torch.zeros(3))
            if os.name != "nt":
                self.assertEqual(filename.stat().st_mode & 0o777, 0o640)

    def test_export_without_dataset_metadata_preserves_the_model_contract(self):
        import json
        from rvc.train.process import extract_model as export
        from rvc.train.utils import HParams

        torch = self.torch
        config = json.loads(
            (self.root / "backend/applio/rvc/configs/40000.json").read_text()
        )
        config["model"]["spk_embed_dim"] = 2
        weights = {
            "emb_g.weight": torch.ones(2, 256),
            "enc_q.training_only": torch.ones(1),
        }
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "voice.pth"
            with patch.object(export, "load_config", return_value={}):
                export.extract_model(
                    weights, 40000, "voice", str(filename), 3, 100,
                    HParams(**config), "HiFi-GAN",
                )
            checkpoint = torch.load(filename, weights_only=True)
            self.assertEqual(checkpoint["speakers_id"], 2)
            self.assertEqual(checkpoint["config"][-3], 2)
            self.assertEqual(checkpoint["sr"], 40000)
            self.assertEqual(checkpoint["version"], "v2")
            self.assertTrue(checkpoint["f0"])
            self.assertEqual(checkpoint["epoch"], 3)
            self.assertEqual(checkpoint["step"], 100)
            self.assertEqual(checkpoint["vocoder"], "HiFi-GAN")
            self.assertIsNone(checkpoint["embedder_model"])
            self.assertIsNone(checkpoint["dataset_length"])
            self.assertNotIn("enc_q.training_only", checkpoint["weight"])
            self.assertEqual(checkpoint["weight"]["emb_g.weight"].dtype, torch.float16)

    def test_atomic_checkpoint_writes_preserve_symbolic_links(self):
        from rvc.train.utils import atomic_torch_save

        torch = self.torch
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "target.pth"
            link = Path(directory) / "linked.pth"
            atomic_torch_save({"iteration": 3}, target)
            try:
                link.symlink_to(target)
            except (OSError, NotImplementedError):
                self.skipTest("Symbolic links are unavailable for this account")
            atomic_torch_save({"iteration": 4}, link)
            self.assertTrue(link.is_symlink())
            self.assertEqual(torch.load(target, weights_only=True)["iteration"], 4)
            previous = target.read_bytes()
            with patch("rvc.train.utils.os.replace", side_effect=PermissionError()):
                with self.assertRaises(PermissionError):
                    atomic_torch_save({"iteration": 5}, link)
            self.assertTrue(link.is_symlink())
            self.assertEqual(target.read_bytes(), previous)

    def test_mel_caches_separate_rates_ranges_and_resolutions(self):
        from librosa.filters import mel
        from rvc.train.mel_processing import MultiScaleMelSpectrogramLoss, spec_to_mel_torch

        torch, np = self.torch, self.np
        settings = (
            (16000, 256, 20, 0), (8000, 256, 20, 0),
            (16000, 256, 20, 200), (16000, 512, 40, 0),
        )
        for rate, fft, bins, minimum in settings:
            spec = torch.ones((1, fft // 2 + 1, 8))
            result = spec_to_mel_torch(spec, fft, bins, rate, minimum, None)
            bank = torch.from_numpy(
                mel(sr=rate, n_fft=fft, n_mels=bins, fmin=minimum, fmax=None)
            )
            torch.testing.assert_close(result, (bank @ spec).clamp(min=1e-5).log())
        loss = MultiScaleMelSpectrogramLoss(sample_rate=16000)
        wav = torch.from_numpy(
            np.random.default_rng(0).normal(size=(1, 1, 2048)).astype("float32")
        )
        for window in (64, 128):
            result = loss.mel_spectrogram(wav, 10, window)
            fresh = MultiScaleMelSpectrogramLoss(sample_rate=16000)
            torch.testing.assert_close(result, fresh.mel_spectrogram(wav, 10, window))

    def test_preprocess_silence_and_per_chunk_normalization(self):
        from rvc.train.preprocess.preprocess import PreProcess
        import soundfile as sf

        np = self.np
        with tempfile.TemporaryDirectory() as directory:
            processor = PreProcess(16000, directory)
            silence = np.zeros(1600, dtype=np.float32)
            np.testing.assert_array_equal(processor._normalize_audio(silence), silence)
            invalid_inputs = (
                np.array([]), np.array([np.nan]), np.array([np.inf]), np.array([3.0]),
            )
            for invalid in invalid_inputs:
                self.assertIsNone(processor._normalize_audio(invalid))
            processor.process_audio_segment(silence, 0, 0, 0, "post")
            audio, _ = sf.read(Path(directory) / "sliced_audios/0_0_0.wav")
            self.assertTrue(np.isfinite(audio).all())
            source = np.concatenate((np.full(1600, 0.1), np.full(1600, 0.8)))
            processor.simple_cut(source, 0, 1, 0.1, 0, "post")
            for index, peak in enumerate((0.1, 0.8)):
                actual, _ = sf.read(Path(directory) / f"sliced_audios/0_1_{index}.wav")
                np.testing.assert_allclose(actual, 0.675 + 0.25 * peak, atol=1e-7)

    def test_spectral_caches_remain_usable_after_inference_mode_validation(self):
        from rvc.train import mel_processing as mel

        torch = self.torch
        mel.hann_window.clear()
        mel.mel_basis.clear()
        params = (256, 20, 16000, 64, 256, 0, None)
        with torch.inference_mode():
            mel.mel_spectrogram_torch(torch.zeros(1, 2048), *params)
        audio = torch.randn(1, 2048, requires_grad=True)
        mel.mel_spectrogram_torch(audio, *params).sum().backward()
        self.assertTrue(torch.isfinite(audio.grad).all())
        loss = mel.MultiScaleMelSpectrogramLoss(
            sample_rate=16000, n_mels=[10], window_lengths=[64]
        )
        real = torch.zeros(1, 1, 2048)
        with torch.inference_mode():
            loss(real, real)
        fake = torch.randn_like(real, requires_grad=True)
        loss(real, fake).backward()
        self.assertTrue(torch.isfinite(fake.grad).all())

    def test_preprocess_resampling_retains_the_existing_filter(self):
        import soundfile as sf
        import torchaudio
        from rvc.lib.utils import load_audio_ta

        np, torch = self.np, self.torch
        source = np.random.default_rng(41).normal(0, 0.1, 8820).astype("float32")
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "audio.wav"
            sf.write(filename, source, 44100, subtype="FLOAT")
            resample = torchaudio.transforms.Resample(
                44100, 40000, lowpass_filter_width=128
            )
            expected = resample(torch.from_numpy(source).unsqueeze(0))[0].numpy()
            for _ in range(2):
                np.testing.assert_array_equal(load_audio_ta(str(filename), 40000), expected)

    def test_dataset_buckets_use_audio_frames_for_each_wav_encoding(self):
        import soundfile as sf
        from rvc.train.data_utils import DistributedBucketSampler, TextAudioLoaderMultiNSFsid

        with tempfile.TemporaryDirectory() as directory:
            directory = Path(directory)
            lines = []
            for index, encoding in enumerate(("FLOAT", "PCM_16", "PCM_24")):
                audio = directory / f"{index}.wav"
                sf.write(audio, self.np.zeros(9 * 16000), 16000, subtype=encoding)
                lines.append(f"{audio}|features.npy|pitch.npy|pitchf.npy|0")
            filelist = directory / "filelist.txt"
            filelist.write_text("\n".join(lines), encoding="utf-8")
            params = types.SimpleNamespace(
                training_files=str(filelist), max_wav_value=32768,
                sample_rate=16000, filter_length=1024,
                hop_length=160, win_length=1024,
            )
            dataset = TextAudioLoaderMultiNSFsid(params)
            self.assertEqual(dataset.lengths, [900, 900, 900])
            sampler = DistributedBucketSampler(
                dataset, 1, [50, 100, 300, 600, 900], num_replicas=1, rank=0
            )
            self.assertEqual(sorted(batch[0] for batch in sampler), [0, 1, 2])

    def test_realtime_retrieval_exact_missing_and_tiny_distances(self):
        from backend.python.inference.algorithms import retrieve_embeddings

        torch, np = self.torch, self.np
        retrieve = self._engine_method(
            "rvc/realtime/pipeline.py", "Realtime_Pipeline",
            "_retrieve_speaker_embeddings",
        )
        rng = np.random.default_rng(7)
        vectors = rng.normal(size=(9, 4)).astype("float32")
        original = rng.normal(size=(1, 5, 4)).astype("float32")
        scores = np.array(
            [[0, 0, 1, 2, 3, 4, 5, 6], [np.inf] * 8,
             [value * 1e-30 for value in range(1, 9)], list(range(1, 9))],
            dtype="float32",
        )
        neighbors = np.tile(np.arange(8), (4, 1))
        neighbors[1] = -1
        cpu_index = types.SimpleNamespace(search=lambda queries, k: (scores, neighbors))
        gpu_index = types.SimpleNamespace(
            search=lambda queries, k: (
                torch.from_numpy(scores), torch.from_numpy(neighbors)
            )
        )
        expected = original.copy()
        expected[0, 1:] = (
            retrieve_embeddings(original[0, 1:], cpu_index, vectors) * 0.75
            + original[0, 1:] * 0.25
        )
        result = retrieve(
            None, 2, torch.from_numpy(original.copy()), gpu_index,
            torch.from_numpy(vectors), 0.75,
        )
        np.testing.assert_allclose(result.numpy(), expected, rtol=1e-6, atol=1e-7)
        np.testing.assert_array_equal(result[0, 0].numpy(), original[0, 0])
        empty = torch.empty((0, 4))
        feats = torch.from_numpy(original.copy())
        self.assertIs(
            retrieve(None, 0, feats, None, empty, 0.75), feats
        )

    def test_file_retrieval_handles_invalid_neighbors_across_batch_boundaries(self):
        from backend.python.inference.algorithms import retrieve_embeddings

        torch, np = self.torch, self.np
        retrieve = self._engine_method(
            "rvc/infer/pipeline.py", "Pipeline", "_retrieve_speaker_embeddings"
        )
        rng = np.random.default_rng(65)
        vectors = rng.normal(size=(9, 4)).astype("float32")
        original = rng.normal(size=(1, 513, 4)).astype("float32")
        scores = rng.uniform(1, 10, size=(513, 8)).astype("float32")
        neighbors = np.tile(np.arange(8), (513, 1))
        scores[0] = [0, 0, 1, 2, 3, 4, 5, 6]
        scores[1] = np.inf
        neighbors[1] = -1
        scores[2] = np.arange(1, 9) * 1e-30
        scores[3] = -1
        neighbors[3] = 20
        index = types.SimpleNamespace(search=lambda queries, k: (scores, neighbors))
        owner = types.SimpleNamespace(device="cpu")
        actual = retrieve(owner, torch.from_numpy(original.copy()), index, vectors, 0.75)
        self.assertTrue(torch.isfinite(actual).all())
        expected_match = vectors[:2].mean(0) * 0.75 + original[0, 0] * 0.25
        np.testing.assert_allclose(actual[0, 0].numpy(), expected_match, atol=1e-7)
        np.testing.assert_allclose(actual[0, 1].numpy(), original[0, 1], atol=1e-7)
        np.testing.assert_allclose(actual[0, 3].numpy(), original[0, 3], atol=1e-7)
        weight = np.square(1 / scores[4:])
        weight /= weight.sum(axis=1, keepdims=True)
        expected = np.sum(vectors[neighbors[4:]] * weight[:, :, None], axis=1)
        expected = expected * 0.75 + original[0, 4:] * 0.25
        np.testing.assert_array_equal(actual[0, 4:].numpy(), expected)
        desktop = retrieve_embeddings(original[0], index, vectors) * 0.75 + original[0] * 0.25
        np.testing.assert_array_equal(actual[0].numpy(), desktop)
        features = torch.from_numpy(original)
        self.assertIs(retrieve(owner, features, None, vectors[:0], 0.75), features)

    @unittest.skipUnless(importlib.util.find_spec("faiss"), "FAISS is required for index checks")
    def test_realtime_search_handles_small_indexes_without_falling_back(self):
        import faiss
        from rvc.realtime.utils.torch import IndexWrapper

        np, torch = self.np, self.torch
        rng = np.random.default_rng(12)
        queries = rng.normal(size=(5, 8)).astype("float32")
        for count in (0, 1, 3, 7, 32):
            vectors = rng.normal(size=(count, 8)).astype("float32")
            reference = faiss.IndexFlatL2(8)
            reference.add(vectors)
            wrapper = IndexWrapper("", device="cpu")
            wrapper.index = reference
            wrapper.big_tensor = torch.from_numpy(vectors)
            wrapper.b_norms = wrapper.big_tensor.square().sum(-1, keepdim=True).T.contiguous()
            scores, indices = wrapper.search(torch.from_numpy(queries))
            self.assertFalse(wrapper.faiss_cpu)
            self.assertEqual(tuple(scores.shape), (5, 8))
            self.assertEqual(tuple(indices.shape), (5, 8))
            available = min(count, 8)
            if available:
                expected_scores, expected_indices = reference.search(queries, available)
                np.testing.assert_array_equal(
                    indices[:, :available].numpy(), expected_indices
                )
                np.testing.assert_allclose(
                    scores[:, :available].numpy(), expected_scores,
                    rtol=1e-5, atol=1e-5,
                )
            if count < 8:
                self.assertTrue(torch.isinf(scores[:, available:]).all())
                self.assertTrue((indices[:, available:] == -1).all())

    @unittest.skipUnless(importlib.util.find_spec("faiss"), "FAISS is required for index checks")
    def test_index_norm_chunks_preserve_exact_values_across_the_boundary(self):
        import faiss
        from rvc.realtime.utils.torch import IndexWrapper

        np, torch = self.np, self.torch
        devices = ["cpu"]
        if os.environ.get("APPLIO_CHECK_GPU_NUMERICS") == "1":
            self.assertTrue(torch.cuda.is_available())
            devices.append("cuda")
        with tempfile.TemporaryDirectory() as directory:
            filename = Path(directory) / "voice.index"
            for count, dimension in ((4103, 16), (4097, 768)):
                vectors = np.random.default_rng(73).normal(
                    size=(count, dimension)
                ).astype("float32")
                index = faiss.IndexFlatL2(dimension)
                index.add(vectors)
                faiss.write_index(index, str(filename))
                for device in devices:
                    wrapper = IndexWrapper(str(filename), device=device)
                    tensor, norms = wrapper.read_index_tensor()
                    torch.testing.assert_close(
                        tensor.cpu(), torch.from_numpy(vectors), rtol=0, atol=0
                    )
                    expected = tensor.square().sum(dim=-1, keepdim=True).T.contiguous()
                    torch.testing.assert_close(norms, expected, rtol=0, atol=0)
                    self.assertTrue(norms.is_contiguous())
                    self.assertIsNone(wrapper.big_npy)
                    wrapper.unload()


if __name__ == "__main__":
    unittest.main()
