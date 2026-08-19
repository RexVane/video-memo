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
            self.assertIn("![[assets/", content)
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

    def test_auto_topic_folder_from_content(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            frames = run_dir / "frames"
            frames.mkdir(parents=True)
            summary = run_dir / "summary.md"
            summary.write_text("# Git 入门\n\n内容", encoding="utf-8")
            (frames / "frame_001.jpg").write_bytes(b"image")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Git 基础教程",
                duration=10,
                webpage_url="https://example.test/git",
                description="",
                uploader="Teacher",
            )

            note = export_to_vault(
                summary,
                metadata,
                vault,
                note_title="Git 版本控制核心概念",
                topic="Git",
            )

            self.assertEqual(note.parent, vault / "Git")
            self.assertEqual(note.name, "Git 版本控制核心概念.md")
            content = note.read_text(encoding="utf-8")
            self.assertIn("![[Git/assets/", content)
            copied = list((vault / "Git" / "assets").rglob("frame_001.jpg"))
            self.assertEqual(len(copied), 1)

    def test_title_collision_never_clobbers_foreign_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            summary = root / "summary.md"
            summary.write_text("generated", encoding="utf-8")
            vault = root / "vault"
            vault.mkdir()
            foreign = vault / "Git 基础.md"
            foreign.write_text("用户自己的笔记", encoding="utf-8")
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Git 基础",
                duration=None,
                webpage_url="https://example.test/git",
                description="",
                uploader="",
            )

            note = export_to_vault(summary, metadata, vault, note_title="Git 基础")

            self.assertNotEqual(note, foreign)
            self.assertEqual(foreign.read_text(encoding="utf-8"), "用户自己的笔记")
            self.assertIn("generated", note.read_text(encoding="utf-8"))

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
            # The first export migrates no legacy file; the second updates only
            # VideoMemo's generated region in place.
            self.assertEqual(len(list(vault.rglob("*.backup-*.md"))), 0)
            self.assertIn("updated", second.read_text(encoding="utf-8"))

            content = second.read_text(encoding="utf-8")
            content += "\n## 我的批注\n不要删除这段。\n"
            second.write_text(content, encoding="utf-8")
            summary.write_text("third", encoding="utf-8")
            third = export_to_vault(
                summary,
                DownloadResult(title="Updated title", **common),
                vault,
            )
            final = third.read_text(encoding="utf-8")
            self.assertIn("third", final)
            self.assertIn("## 我的批注", final)
            self.assertIn("不要删除这段。", final)


if __name__ == "__main__":
    unittest.main()
