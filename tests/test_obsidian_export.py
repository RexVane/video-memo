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
            self.assertIn('type: "learning-note"', content)
            self.assertIn("media: video", content)
            self.assertIn("duration_seconds: 10", content)
            self.assertIn("  - learning-note", content)
            self.assertIn("  - media-summary", content)
            self.assertIn("  - video-summary", content)
            self.assertIn('source: "https://example.test/course"', content)
            self.assertIn("# Course", content)
            self.assertIn("![[Video Memos/assets/", content)
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

    def test_marks_local_audio_as_audio_learning_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            summary = root / "summary.md"
            summary.write_text("## 一眼看懂\n\nAudio notes", encoding="utf-8")
            vault = root / "vault"
            vault.mkdir()
            source = root / "meeting.m4a"
            metadata = DownloadResult(
                video_path=None,
                audio_path=source,
                title="Meeting",
                duration=None,
                webpage_url=source.as_uri(),
                description="",
                uploader="本地文件",
            )

            note = export_to_vault(summary, metadata, vault)

            content = note.read_text(encoding="utf-8")
            self.assertIn("media: audio", content)
            self.assertIn("duration_seconds: null", content)
            self.assertIn("  - audio-summary", content)

    def test_title_change_updates_existing_note_for_same_source(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            summary = root / "summary.md"
            summary.write_text("first", encoding="utf-8")
            vault = root / "vault"
            vault.mkdir()
            common = {
                "video_path": None,
                "audio_path": None,
                "duration": 10,
                "webpage_url": "https://example.test/course/42",
                "description": "",
                "uploader": "Teacher",
            }
            first = export_to_vault(
                summary,
                DownloadResult(title="Original title", **common),
                vault,
            )
            summary.write_text("updated", encoding="utf-8")
            second = export_to_vault(
                summary,
                DownloadResult(title="Updated title", **common),
                vault,
            )

            self.assertEqual(first, second)
            self.assertEqual(len(list(vault.rglob("*.md"))), 1)
            self.assertIn("updated", second.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
