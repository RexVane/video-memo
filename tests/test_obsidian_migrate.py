from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))
TOOLS_DIR = Path(__file__).resolve().parents[1] / "tools"
sys.path.insert(0, str(TOOLS_DIR))

from migrate_obsidian_notes import (  # noqa: E402
    apply_plan,
    extract_source_id,
    generated_region,
    plan_migration,
    stamp_source_marker,
    title_from_stem,
)

GENERATED = (
    "<!-- videomemo:generated:start -->\n"
    "## 一眼看懂\n内容\n"
    "<!-- videomemo:generated:end -->\n"
)


def _note_content(title: str, url: str, source_id: str) -> str:
    return (
        "---\n"
        f'title: "{title}"\n'
        'type: "learning-note"\n'
        f'source: "{url}"\n'
        "---\n"
        + GENERATED
        + f"<!-- videomemo:source:{source_id} -->\n"
    )


class MigrationSourceIdTests(unittest.TestCase):
    def test_extracts_id_from_filename_suffix(self) -> None:
        self.assertEqual(
            extract_source_id(Path("Git入门_1a2b3c4d.md"), "whatever"),
            "1a2b3c4d",
        )

    def test_extracts_id_from_inline_marker(self) -> None:
        content = "text\n<!-- videomemo:source:deadbeef -->\nmore"
        self.assertEqual(extract_source_id(Path("No suffix.md"), content), "deadbeef")

    def test_recomputes_id_from_frontmatter_url(self) -> None:
        import hashlib

        url = "https://example.test/video/42"
        expected = hashlib.sha256(url.encode("utf-8")).hexdigest()[:8]
        content = '---\nsource: "https://example.test/video/42"\n---\nbody'
        self.assertEqual(extract_source_id(Path("plain.md"), content), expected)

    def test_returns_none_when_unidentifiable(self) -> None:
        self.assertIsNone(extract_source_id(Path("plain.md"), "no markers here"))


class MigrationTitleTests(unittest.TestCase):
    def test_strips_suffix_and_restores_spaces(self) -> None:
        self.assertEqual(
            title_from_stem(Path("Git_版本控制核心概念_1a2b3c4d.md"), "x"),
            "Git 版本控制核心概念",
        )

    def test_falls_back_to_frontmatter_title(self) -> None:
        content = '---\ntitle: "视频原始标题"\n---\nbody'
        self.assertEqual(title_from_stem(Path("videomemo_1a2b3c4d.md"), content), "视频原始标题")


class MigrationMarkerTests(unittest.TestCase):
    def test_stamps_marker_into_generated_region(self) -> None:
        stamped = stamp_source_marker(GENERATED, "deadbeef")
        self.assertIn(
            "<!-- videomemo:generated:start -->\n<!-- videomemo:source:deadbeef -->",
            stamped,
        )

    def test_stamps_marker_after_frontmatter(self) -> None:
        content = "---\ntitle: x\n---\nbody"
        stamped = stamp_source_marker(content, "deadbeef")
        self.assertTrue(stamped.startswith("---\ntitle: x\n---\n"))
        self.assertIn("<!-- videomemo:source:deadbeef -->", stamped)

    def test_stamps_marker_at_top_without_frontmatter(self) -> None:
        stamped = stamp_source_marker("plain body", "deadbeef")
        self.assertTrue(stamped.startswith("<!-- videomemo:source:deadbeef -->\nplain body"))

    def test_is_idempotent(self) -> None:
        content = "a <!-- videomemo:source:deadbeef --> b"
        self.assertEqual(stamp_source_marker(content, "deadbeef"), content)


class MigrationPlanTests(unittest.TestCase):
    def _build_legacy_vault(self, root: Path) -> Path:
        vault = (root / "vault").resolve()
        legacy = vault / "Video Memos"
        frames = legacy / "assets" / "1a2b3c4d"
        frames.mkdir(parents=True)
        (frames / "frame_001.jpg").write_bytes(b"image")
        note = legacy / "Git_版本控制核心概念_1a2b3c4d.md"
        note.write_text(_note_content("Git 课程", "https://example.test/git", "1a2b3c4d"), encoding="utf-8")
        backup = legacy / "Git_版本控制核心概念_1a2b3c4d.backup-20260101_120000.md"
        backup.write_text("legacy copy", encoding="utf-8")
        return vault

    def test_plans_move_note_into_topic_folder_and_skip_backups(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vault = self._build_legacy_vault(Path(tmp))
            plans = plan_migration(vault, classify=lambda _text: "Git")

            self.assertEqual(len(plans), 1)
            plan = plans[0]
            self.assertEqual(plan.target, vault / "Git" / "Git 版本控制核心概念.md")
            self.assertEqual(plan.topic, "Git")
            self.assertIsNotNone(plan.asset_dir)
            self.assertEqual(plan.target_asset_dir, vault / "Git" / "assets" / "1a2b3c4d")

    def test_apply_moves_files_rewrites_embeds_and_stamps_marker(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vault = self._build_legacy_vault(Path(tmp))
            note = vault / "Video Memos" / "Git_版本控制核心概念_1a2b3c4d.md"
            content = note.read_text(encoding="utf-8")
            content += "\n![[Video Memos/assets/1a2b3c4d/frame_001.jpg]]\n"
            note.write_text(content, encoding="utf-8")

            plans = plan_migration(vault, classify=lambda _text: "Git")
            apply_plan(plans[0], vault)

            target = vault / "Git" / "Git 版本控制核心概念.md"
            self.assertTrue(target.is_file())
            self.assertFalse(note.exists())
            moved = target.read_text(encoding="utf-8")
            self.assertIn("![[Git/assets/1a2b3c4d/frame_001.jpg]]", moved)
            self.assertIn("<!-- videomemo:source:1a2b3c4d -->", moved)
            self.assertTrue((vault / "Git" / "assets" / "1a2b3c4d" / "frame_001.jpg").is_file())
            # The backup file is left untouched in the legacy folder.
            self.assertTrue(
                (vault / "Video Memos" / "Git_版本控制核心概念_1a2b3c4d.backup-20260101_120000.md").is_file()
            )

    def test_title_collision_gets_source_id_suffix(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp).resolve()
            vault = root / "vault"
            legacy = vault / "Video Memos"
            legacy.mkdir(parents=True)
            for index, note_id in enumerate(("aaaa0001", "aaaa0002")):
                note = legacy / f"同名笔记_{note_id}.md"
                note.write_text(_note_content(f"视频 {index}", f"https://example.test/v{index}", note_id), encoding="utf-8")

            plans = plan_migration(vault, classify=lambda _text: "Git")

            self.assertEqual(len(plans), 2)
            self.assertEqual(plans[0].target, vault / "Git" / "同名笔记.md")
            self.assertEqual(plans[1].target, vault / "Git" / f"同名笔记_{plans[1].source_id}.md")

    def test_unidentifiable_notes_are_skipped(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vault = (Path(tmp) / "vault").resolve()
            legacy = vault / "Video Memos"
            legacy.mkdir(parents=True)
            (legacy / "plain note.md").write_text("no id anywhere", encoding="utf-8")

            plans = plan_migration(vault, classify=lambda _text: "Git")

            self.assertEqual(plans, [])

    def test_no_topic_places_note_at_vault_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            vault = self._build_legacy_vault(Path(tmp))
            plans = plan_migration(vault, topic_override="")

            self.assertEqual(len(plans), 1)
            self.assertEqual(plans[0].target, vault / "Git 版本控制核心概念.md")
            self.assertEqual(plans[0].topic, "")

    def test_generated_region_extraction(self) -> None:
        self.assertIn("## 一眼看懂", generated_region(_note_content("t", "u", "1a2b3c4d")))
        self.assertNotIn("videomemo:generated", generated_region(_note_content("t", "u", "1a2b3c4d")))
        self.assertEqual(generated_region("plain"), "plain")


if __name__ == "__main__":
    unittest.main()
