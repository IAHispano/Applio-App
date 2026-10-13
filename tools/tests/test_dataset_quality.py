import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

import numpy as np
import soundfile as sf

spec = importlib.util.spec_from_file_location(
    "dataset_quality", Path(__file__).parents[1] / "dataset_quality.py"
)
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)


class DatasetQualityTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.root = self.base / "source"
        self.root.mkdir()
        self.report = self.base / "report.json"
        self.rate = 16000
        self.voice = 0.2 * np.sin(
            2 * np.pi * 180 * np.arange(self.rate * 3) / self.rate
        )

    def write(self, name, audio, subtype="PCM_16"):
        target = self.root / name
        target.parent.mkdir(parents=True, exist_ok=True)
        sf.write(target, audio, self.rate, subtype=subtype)
        return target

    def review(self):
        return quality.scan(self.root, self.report)

    def test_reports_decoded_duplicates_across_formats_and_level_outliers(self):
        first = self.write("a.wav", self.voice)
        decoded, _ = sf.read(first)
        self.write("b.flac", decoded)
        self.write("c.wav", self.voice * 0.1)
        self.write("d.wav", self.voice * 0.9)
        report = self.review()
        clips = {c["path"]: c for c in report["clips"]}
        self.assertEqual(clips["b.flac"]["duplicateOf"], "a.wav")
        self.assertIn("level", clips["c.wav"]["issues"])
        self.assertEqual(report["summary"]["duplicate"], 1)
        self.assertNotIn("clipping", clips["a.wav"]["issues"])

    def test_clipped_sections_silence_edges_and_internal_pauses(self):
        clipped = self.voice.copy()
        clipped[self.rate : self.rate + 80] = 1
        self.write("clipped.wav", clipped)
        self.write(
            "silence.wav",
            np.concatenate(
                [
                    np.zeros(self.rate * 2),
                    self.voice,
                    np.zeros(self.rate * 3),
                    self.voice,
                    np.zeros(self.rate),
                ]
            ),
        )
        clips = {c["path"]: c for c in self.review()["clips"]}
        self.assertIn("clipping", clips["clipped.wav"]["issues"])
        self.assertAlmostEqual(
            clips["clipped.wav"]["clippingSections"][0]["start"], 1, places=2
        )
        silent = clips["silence.wav"]
        self.assertIn("silence", silent["issues"])
        self.assertEqual(silent["leadingSilence"], 2)
        self.assertEqual(silent["trailingSilence"], 1)
        self.assertGreaterEqual(silent["longestSilence"], 3)

    def test_silent_and_unreadable_files_do_not_break_folder_review(self):
        self.write("silent.wav", np.zeros(self.rate))
        self.write("voice.wav", self.voice)
        (self.root / "broken.wav").write_bytes(b"invalid audio")
        clips = {c["path"]: c for c in self.review()["clips"]}
        self.assertIn("unreadable", clips["broken.wav"]["issues"])
        self.assertIn("no-signal", clips["silent.wav"]["issues"])
        self.assertIsNone(clips["silent.wav"]["activeRmsDb"])
        json.dumps(clips, allow_nan=False)

    def plan(self, clips, **options):
        target = self.base / "plan.json"
        target.write_text(
            json.dumps(
                {
                    "include": [c["id"] for c in clips],
                    "trimSilence": False,
                    "normalize": False,
                    "lowerPeaks": False,
                    **options,
                }
            )
        )
        return target

    def test_copy_excludes_selected_files_and_preserves_original_bytes(self):
        first = self.write("nested/a.wav", self.voice)
        second = self.write("b.wav", self.voice)
        before = (first.read_bytes(), second.read_bytes())
        report = self.review()
        selected = next(c for c in report["clips"] if c["path"] == "nested/a.wav")
        output = self.base / "curated"
        quality.prepare(self.report, self.plan([selected]), output)
        self.assertEqual((output / "nested/a.wav").read_bytes(), before[0])
        self.assertFalse((output / "b.wav").exists())
        self.assertEqual((first.read_bytes(), second.read_bytes()), before)

    def test_repair_trims_only_edges_and_respects_peak_ceiling(self):
        audio = np.concatenate(
            [
                np.zeros(self.rate),
                self.voice * 0.2,
                np.zeros(self.rate * 2),
                self.voice * 0.2,
                np.zeros(self.rate),
            ]
        )
        original = self.write("repair.wav", audio)
        before = original.read_bytes()
        report = self.review()
        output = self.base / "repaired"
        quality.prepare(
            self.report,
            self.plan(
                report["clips"], trimSilence=True, normalize=True, lowerPeaks=True
            ),
            output,
        )
        result, rate = sf.read(output / "repair.wav.wav")
        self.assertAlmostEqual(len(result) / rate, 8.2, delta=0.03)
        self.assertLessEqual(np.max(np.abs(result)), 10 ** (-1 / 20) + 1e-6)
        self.assertLess(np.max(np.abs(result[rate * 4 : rate * 5])), 1e-6)
        self.assertEqual(original.read_bytes(), before)
        self.assertEqual(sf.info(output / "repair.wav.wav").subtype, "PCM_24")

    def test_stale_source_does_not_publish_partial_dataset(self):
        source = self.write("a.wav", self.voice)
        report = self.review()
        sf.write(source, self.voice * 0.5, self.rate)
        output = self.base / "curated"
        with self.assertRaisesRegex(ValueError, "changed"):
            quality.prepare(self.report, self.plan(report["clips"]), output)
        self.assertFalse(output.exists())
        self.assertFalse(list(self.base.glob(".applio-review-*")))

    def test_unsafe_destinations_and_source_traversal_are_rejected(self):
        self.write("a.wav", self.voice)
        report = self.review()
        with self.assertRaisesRegex(ValueError, "outside"):
            quality.prepare(
                self.report, self.plan(report["clips"]), self.root / "curated"
            )
        (self.base / "outside.wav").write_bytes(b"outside")
        with self.assertRaisesRegex(ValueError, "outside"):
            quality.safe_source(self.root, "../outside.wav")
        output = self.base / "existing"
        output.mkdir()
        with self.assertRaisesRegex(ValueError, "new folder"):
            quality.prepare(self.report, self.plan(report["clips"]), output)

    def test_empty_directory_is_reported_clearly(self):
        with self.assertRaisesRegex(ValueError, "No supported"):
            self.review()


if __name__ == "__main__":
    unittest.main()
