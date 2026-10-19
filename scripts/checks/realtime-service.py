"""Exercise the realtime adapter without Torch, models, or a GPU."""

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


if __name__ == "__main__":
    unittest.main()
