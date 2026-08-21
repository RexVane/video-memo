from __future__ import annotations

import multiprocessing
import os
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import obsidian_export  # noqa: E402
from download import DownloadResult  # noqa: E402
from obsidian_export import export_to_vault  # noqa: E402


def _linked_frame(note: Path, vault: Path, name: str = "frame_001.jpg") -> Path:
    content = note.read_text(encoding="utf-8")
    for link in content.split("![[")[1:]:
        relative = link.split("]]", 1)[0]
        if relative.endswith(f"/{name}"):
            return vault.resolve().joinpath(*relative.split("/"))
    raise AssertionError(f"笔记中没有找到附件链接: {name}")


def _crash_before_note_commit(
    summary: Path,
    metadata: DownloadResult,
    vault: Path,
    note: Path,
) -> None:
    original_replace = Path.replace

    def crash_on_note_replace(path: Path, target: Path):
        if target == note:
            os._exit(73)
        return original_replace(path, target)

    with patch("obsidian_export.Path.replace", new=crash_on_note_replace):
        export_to_vault(summary, metadata, vault)


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

            self.assertEqual(note.parent, (vault / "Git").resolve())
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

    def test_failed_frame_copy_preserves_existing_generation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            frames = run_dir / "frames"
            frames.mkdir(parents=True)
            summary = run_dir / "summary.md"
            summary.write_text("original summary", encoding="utf-8")
            (frames / "frame_001.jpg").write_bytes(b"first generation")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )
            note = export_to_vault(summary, metadata, vault)
            old_frame = _linked_frame(note, vault)
            old_generation = old_frame.parent
            asset_root = old_generation.parent
            original_note = note.read_text(encoding="utf-8")
            stale_frame = old_generation / "frame_003.jpg"
            stale_frame.write_bytes(b"keep stale until commit")
            (frames / "frame_001.jpg").write_bytes(b"second generation")
            (frames / "frame_002.jpg").write_bytes(b"second frame")
            summary.write_text("updated summary", encoding="utf-8")

            original_copy2 = obsidian_export.shutil.copy2
            calls = 0

            def failing_copy(source, destination):  # noqa: ANN001
                nonlocal calls
                calls += 1
                if calls == 2:
                    raise OSError("simulated attachment copy failure")
                return original_copy2(source, destination)

            with patch("obsidian_export.shutil.copy2", side_effect=failing_copy):
                with self.assertRaisesRegex(OSError, "simulated attachment"):
                    export_to_vault(summary, metadata, vault)

            self.assertEqual(note.read_text(encoding="utf-8"), original_note)
            self.assertEqual(old_frame.read_bytes(), b"first generation")
            self.assertEqual(stale_frame.read_bytes(), b"keep stale until commit")
            self.assertFalse((old_generation / "frame_002.jpg").exists())
            self.assertEqual(set(asset_root.iterdir()), {old_generation})

    def test_failed_note_commit_discards_unreferenced_attachment_generation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            frames = run_dir / "frames"
            frames.mkdir(parents=True)
            summary = run_dir / "summary.md"
            summary.write_text("original summary", encoding="utf-8")
            source_frame = frames / "frame_001.jpg"
            source_frame.write_bytes(b"first generation")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )
            note = export_to_vault(summary, metadata, vault)
            old_frame = _linked_frame(note, vault)
            old_generation = old_frame.parent
            asset_root = old_generation.parent
            original_note = note.read_text(encoding="utf-8")
            source_frame.write_bytes(b"second generation")
            summary.write_text("updated summary", encoding="utf-8")
            original_replace = Path.replace

            def failing_replace(path: Path, target: Path):
                if target == note:
                    raise OSError("simulated note commit failure")
                return original_replace(path, target)

            with patch("obsidian_export.Path.replace", new=failing_replace):
                with self.assertRaisesRegex(OSError, "simulated note commit"):
                    export_to_vault(summary, metadata, vault)

            self.assertEqual(note.read_text(encoding="utf-8"), original_note)
            self.assertEqual(old_frame.read_bytes(), b"first generation")
            self.assertEqual(set(asset_root.iterdir()), {old_generation})

    def test_precommit_attachment_publish_keeps_old_note_and_frames_coherent(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            frames = run_dir / "frames"
            frames.mkdir(parents=True)
            summary = run_dir / "summary.md"
            summary.write_text("original summary", encoding="utf-8")
            source_frame = frames / "frame_001.jpg"
            source_frame.write_bytes(b"first generation")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )
            note = export_to_vault(summary, metadata, vault)
            old_frame = _linked_frame(note, vault)
            old_generation = old_frame.parent
            asset_root = old_generation.parent
            original_note = note.read_text(encoding="utf-8")
            source_frame.write_bytes(b"second generation")
            summary.write_text("updated summary", encoding="utf-8")
            observed_frames: set[bytes] = set()
            observed_note = ""
            original_replace = Path.replace

            def inspect_precommit_then_fail(path: Path, target: Path):
                nonlocal observed_frames, observed_note
                if target == note:
                    observed_note = note.read_text(encoding="utf-8")
                    observed_frames = {
                        frame.read_bytes()
                        for frame in asset_root.glob("v-*/frame_001.jpg")
                    }
                    self.assertEqual(
                        _linked_frame(note, vault).read_bytes(),
                        b"first generation",
                    )
                    raise OSError("simulated note commit failure")
                return original_replace(path, target)

            with patch(
                "obsidian_export.Path.replace",
                new=inspect_precommit_then_fail,
            ):
                with self.assertRaisesRegex(OSError, "simulated note commit"):
                    export_to_vault(summary, metadata, vault)

            self.assertEqual(note.read_text(encoding="utf-8"), original_note)
            self.assertEqual(observed_note, original_note)
            self.assertEqual(
                observed_frames,
                {b"first generation", b"second generation"},
            )
            self.assertEqual(old_frame.read_bytes(), b"first generation")
            self.assertEqual(set(asset_root.iterdir()), {old_generation})

    def test_forced_exit_before_note_commit_leaves_only_an_orphan_generation(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            frames = run_dir / "frames"
            frames.mkdir(parents=True)
            summary = run_dir / "summary.md"
            summary.write_text("original summary", encoding="utf-8")
            source_frame = frames / "frame_001.jpg"
            source_frame.write_bytes(b"first generation")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )
            note = export_to_vault(summary, metadata, vault)
            old_frame = _linked_frame(note, vault)
            asset_root = old_frame.parent.parent
            original_note = note.read_text(encoding="utf-8")
            source_frame.write_bytes(b"second generation")
            summary.write_text("updated summary", encoding="utf-8")

            process = multiprocessing.get_context("spawn").Process(
                target=_crash_before_note_commit,
                args=(summary, metadata, vault, note),
            )
            process.start()
            process.join(10)
            if process.is_alive():
                process.terminate()
                process.join(2)
                self.fail("crash simulation process did not exit")

            self.assertEqual(process.exitcode, 73)
            self.assertEqual(note.read_text(encoding="utf-8"), original_note)
            self.assertEqual(_linked_frame(note, vault).read_bytes(), b"first generation")
            self.assertEqual(
                {
                    frame.read_bytes()
                    for frame in asset_root.glob("v-*/frame_001.jpg")
                },
                {b"first generation", b"second generation"},
            )

            export_to_vault(summary, metadata, vault)

            committed_frame = _linked_frame(note, vault)
            self.assertEqual(committed_frame.read_bytes(), b"second generation")
            self.assertEqual(set(asset_root.iterdir()), {committed_frame.parent})

    def test_postcommit_cleanup_failure_does_not_invalidate_new_note(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            frames = run_dir / "frames"
            frames.mkdir(parents=True)
            summary = run_dir / "summary.md"
            summary.write_text("original summary", encoding="utf-8")
            source_frame = frames / "frame_001.jpg"
            source_frame.write_bytes(b"first generation")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )
            note = export_to_vault(summary, metadata, vault)
            old_frame = _linked_frame(note, vault)
            old_generation = old_frame.parent
            source_frame.write_bytes(b"second generation")
            summary.write_text("updated summary", encoding="utf-8")
            original_remove_tree = obsidian_export._remove_tree

            def failing_old_generation_cleanup(path: Path) -> None:
                if path == old_generation:
                    raise PermissionError("simulated cleanup failure")
                original_remove_tree(path)

            with patch(
                "obsidian_export._remove_tree",
                side_effect=failing_old_generation_cleanup,
            ):
                export_to_vault(summary, metadata, vault)

            committed_frame = _linked_frame(note, vault)
            self.assertIn("updated summary", note.read_text(encoding="utf-8"))
            self.assertEqual(committed_frame.read_bytes(), b"second generation")
            self.assertEqual(old_frame.read_bytes(), b"first generation")

    def test_export_without_new_frames_preserves_existing_attachments(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            frames = run_dir / "frames"
            frames.mkdir(parents=True)
            summary = run_dir / "summary.md"
            summary.write_text("original summary", encoding="utf-8")
            source_frame = frames / "frame_001.jpg"
            source_frame.write_bytes(b"existing generation")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )
            note = export_to_vault(summary, metadata, vault)
            old_frame = _linked_frame(note, vault)
            source_frame.unlink()
            summary.write_text("audio-only update", encoding="utf-8")

            export_to_vault(summary, metadata, vault)

            content = note.read_text(encoding="utf-8")
            self.assertIn("audio-only update", content)
            self.assertNotIn("## 关键帧", content)
            self.assertEqual(old_frame.read_bytes(), b"existing generation")

    def test_user_annotation_link_keeps_its_old_attachment_generation(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            frames = run_dir / "frames"
            frames.mkdir(parents=True)
            summary = run_dir / "summary.md"
            summary.write_text("original summary", encoding="utf-8")
            source_frame = frames / "frame_001.jpg"
            source_frame.write_bytes(b"annotated generation")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )
            note = export_to_vault(summary, metadata, vault)
            old_frame = _linked_frame(note, vault)
            old_link = old_frame.relative_to(vault).as_posix()
            note.write_text(
                note.read_text(encoding="utf-8")
                + f"\n## 我的截图批注\n![[{old_link}]]\n",
                encoding="utf-8",
            )
            source_frame.write_bytes(b"new generation")
            summary.write_text("updated summary", encoding="utf-8")

            export_to_vault(summary, metadata, vault)

            committed_frame = _linked_frame(note, vault)
            content = note.read_text(encoding="utf-8")
            self.assertIn(f"![[{old_link}]]", content)
            self.assertEqual(committed_frame.read_bytes(), b"new generation")
            self.assertEqual(old_frame.read_bytes(), b"annotated generation")
            self.assertEqual(
                set(old_frame.parent.parent.iterdir()),
                {old_frame.parent, committed_frame.parent},
            )

    def test_legacy_fixed_attachment_path_is_kept_until_note_commit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            run_dir = root / "run"
            frames = run_dir / "frames"
            frames.mkdir(parents=True)
            summary = run_dir / "summary.md"
            summary.write_text("original summary", encoding="utf-8")
            source_frame = frames / "frame_001.jpg"
            source_frame.write_bytes(b"legacy generation")
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )
            note = export_to_vault(summary, metadata, vault)
            versioned_frame = _linked_frame(note, vault)
            asset_root = versioned_frame.parent.parent
            legacy_frame = asset_root / versioned_frame.name
            legacy_frame.write_bytes(versioned_frame.read_bytes())
            user_asset = asset_root / "keep.txt"
            user_asset.write_text("user-managed", encoding="utf-8")
            versioned_relative = versioned_frame.relative_to(vault).as_posix()
            legacy_relative = legacy_frame.relative_to(vault).as_posix()
            legacy_note = note.read_text(encoding="utf-8").replace(
                versioned_relative,
                legacy_relative,
            )
            note.write_text(legacy_note, encoding="utf-8")
            versioned_frame.unlink()
            versioned_frame.parent.rmdir()

            source_frame.write_bytes(b"new generation")
            summary.write_text("updated summary", encoding="utf-8")
            original_replace = Path.replace

            def failing_replace(path: Path, target: Path):
                if target == note:
                    self.assertEqual(note.read_text(encoding="utf-8"), legacy_note)
                    self.assertEqual(legacy_frame.read_bytes(), b"legacy generation")
                    raise OSError("simulated note commit failure")
                return original_replace(path, target)

            with patch("obsidian_export.Path.replace", new=failing_replace):
                with self.assertRaisesRegex(OSError, "simulated note commit"):
                    export_to_vault(summary, metadata, vault)

            self.assertEqual(note.read_text(encoding="utf-8"), legacy_note)
            self.assertEqual(legacy_frame.read_bytes(), b"legacy generation")

            export_to_vault(summary, metadata, vault)

            committed_frame = _linked_frame(note, vault)
            self.assertEqual(committed_frame.read_bytes(), b"new generation")
            self.assertEqual(committed_frame.parent.parent, asset_root)
            self.assertFalse(legacy_frame.exists())
            self.assertEqual(user_asset.read_text(encoding="utf-8"), "user-managed")
            self.assertEqual(
                set(asset_root.iterdir()),
                {committed_frame.parent, user_asset},
            )

    def test_concurrent_exports_keep_note_and_attachments_from_same_commit(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            vault = root / "vault"
            vault.mkdir()
            metadata = DownloadResult(
                video_path=None,
                audio_path=None,
                title="Course",
                duration=10,
                webpage_url="https://example.test/course",
                description="",
                uploader="Teacher",
            )
            summaries: list[Path] = []
            for label in ("A", "B"):
                run = root / f"run-{label}"
                frames = run / "frames"
                frames.mkdir(parents=True)
                summary = run / "summary.md"
                summary.write_text(f"SUMMARY_{label}", encoding="utf-8")
                (frames / "frame_001.jpg").write_bytes(f"FRAME_{label}".encode())
                summaries.append(summary)

            original_export = obsidian_export._export_to_vault_locked
            counter_lock = threading.Lock()
            active = 0
            max_active = 0

            def observed_export(*args, **kwargs):  # noqa: ANN002, ANN003
                nonlocal active, max_active
                with counter_lock:
                    active += 1
                    max_active = max(max_active, active)
                try:
                    time.sleep(0.05)
                    return original_export(*args, **kwargs)
                finally:
                    with counter_lock:
                        active -= 1

            barrier = threading.Barrier(3)
            results: list[Path] = []
            errors: list[BaseException] = []

            def run_export(summary: Path) -> None:
                try:
                    barrier.wait()
                    results.append(export_to_vault(summary, metadata, vault))
                except BaseException as error:
                    errors.append(error)

            with patch(
                "obsidian_export._export_to_vault_locked",
                side_effect=observed_export,
            ):
                workers = [
                    threading.Thread(target=run_export, args=(summary,))
                    for summary in summaries
                ]
                for worker in workers:
                    worker.start()
                barrier.wait()
                for worker in workers:
                    worker.join(2)

            self.assertFalse(errors)
            self.assertTrue(all(not worker.is_alive() for worker in workers))
            self.assertEqual(max_active, 1)
            self.assertEqual(len(results), 2)
            note = results[-1]
            content = note.read_text(encoding="utf-8")
            frame = _linked_frame(note, vault)
            self.assertEqual(
                list((note.parent / "assets").rglob("frame_001.jpg")),
                [frame],
            )
            if "SUMMARY_A" in content:
                self.assertEqual(frame.read_bytes(), b"FRAME_A")
            else:
                self.assertIn("SUMMARY_B", content)
                self.assertEqual(frame.read_bytes(), b"FRAME_B")


if __name__ == "__main__":
    unittest.main()
