import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from rvc.lib.user_config import config_path, load_config


class UserConfigTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="applio-config-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.code = self.root / "code"
        self.data = self.root / "data"
        self.defaults = {
            "version": "2.0",
            "precision": "fp16",
            "realtime": {"input": "", "output": ""},
        }
        self.write(self.code / "assets" / "config_template.json", self.defaults)
        env = patch.dict(
            os.environ,
            {
                "APPLIO_ROOT": str(self.data),
                "APPLIO_CODE_ROOT": str(self.code),
                "APPLIO_CONFIG_DIR": str(self.root / "profile"),
            },
        )
        env.start()
        self.addCleanup(env.stop)

    def write(self, file, value):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_text(json.dumps(value), encoding="utf-8")

    def test_fresh_install(self):
        self.assertEqual(load_config(), self.defaults)
        self.assertEqual(json.loads(config_path().read_text()), {})
        self.assertFalse((self.data / "assets" / "config.json").exists())
        self.assertEqual(list(config_path().parent.iterdir()), [config_path()])

    def test_migration_and_existing_user_precedence(self):
        legacy = self.data / "assets" / "config.json"
        self.write(
            legacy, {"precision": "bf16", "version": "old", "model_author": "Author"}
        )
        self.assertEqual(load_config()["precision"], "bf16")
        self.assertEqual(load_config()["version"], "2.0")
        self.write(legacy, {"precision": "fp32"})
        self.assertEqual(load_config()["precision"], "bf16")
        self.assertEqual(load_config()["model_author"], "Author")

    def test_new_defaults_and_user_overrides(self):
        self.write(config_path(), {"realtime": {"input": "microphone"}})
        self.write(self.data / "assets" / "config_template.json", {"precision": "old"})
        self.assertEqual(
            load_config()["realtime"], {"input": "microphone", "output": ""}
        )
        self.assertEqual(load_config()["precision"], "fp16")

    def test_invalid_json_preserved(self):
        self.write(config_path(), {})
        config_path().write_text("{broken", encoding="utf-8")
        with self.assertRaises(json.JSONDecodeError):
            load_config()
        self.assertEqual(config_path().read_text(), "{broken")

    def test_paths_match_platform_policy(self):
        with patch.dict(os.environ, {}, clear=True), patch(
            "pathlib.Path.home", return_value=self.root
        ):
            for platform, relative in [
                ("win32", "AppData/Roaming/Applio/config.json"),
                ("darwin", "Library/Application Support/Applio/config.json"),
                ("linux", ".config/Applio/config.json"),
            ]:
                with self.subTest(platform=platform), patch("sys.platform", platform):
                    self.assertEqual(config_path(), self.root / relative)


if __name__ == "__main__":
    unittest.main()
