from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

from subtitles import transcript_from_vtt  # noqa: E402


class SubtitleTests(unittest.TestCase):
    def test_converts_vtt_to_timestamped_transcript(self) -> None:
        content = """WEBVTT

00:00:01.000 --> 00:00:03.000
Hello <c.colorE5E5E5>world</c>

00:00:03.000 --> 00:00:05.000
Second line

00:00:05.000 --> 00:00:06.000
Second line
"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "source.en.vtt"
            path.write_text(content, encoding="utf-8")

            result = transcript_from_vtt(path, language="en")

        self.assertEqual(result.language, "en")
        self.assertEqual(len(result.segments), 2)
        self.assertEqual(result.text, "[00:01] Hello world\n[00:03] Second line")


if __name__ == "__main__":
    unittest.main()
