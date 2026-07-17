from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

from download import DownloadResult  # noqa: E402
from obsidian_export import export_to_vault  # noqa: E402


class ObsidianExportTests(unittest.TestCase):
    def test_exports_frontmatter_report_and_frames(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            frames = run_dir / "frames"
            frames.mkdir(parents=True)
            summary = run_dir / "summary.md"
            summary.write_text("# Course\n\nReport", encoding="utf-8")
            (frames / "frame_001.jpg").write_bytes(b"image")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course: Intro",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )

            note = export_to_vault(summary, metadata, vault)

            content = note.read_text(encoding="utf-8")
            self.assertIn('title: "Course: Intro"', content)
            self.assertIn('source: "https://example.test/course"', content)
            self.assertIn("# Course", content)
            self.assertIn("![[Video Summaries/assets/", content)
            copied_frames = list((note.parent / "assets").rglob("frame_001.jpg"))
            self.assertEqual(len(copied_frames), 1)

    def test_rejects_folder_outside_vault(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            summary = root / "summary.md"
            summary.write_text("summary", encoding="utf-8")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course",
                duration=None,
                webpage_url="https://example.test/course",
                description="",
                uploader="",
            )

            with self.assertRaises(ValueError):
                export_to_vault(summary, metadata, vault, folder="../outside")


if __name__ == "__main__":
    unittest.main()
