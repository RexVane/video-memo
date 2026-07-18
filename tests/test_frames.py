from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import frames  # noqa: E402


class FrameTests(unittest.TestCase):
    def test_rejects_non_positive_frame_count(self) -> None:
        with self.assertRaisesRegex(ValueError, "max_frames"):
            frames.extract_frames(Path("missing.mp4"), Path("frames"), max_frames=0)

    @patch("frames.subprocess.run")
    def test_builds_scaled_ffmpeg_filter_and_cleans_stale_frames(self, run_mock) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "source.mp4"
            video.write_bytes(b"video")
            output = root / "frames"
            output.mkdir()
            stale = output / "frame_999.jpg"
            stale.write_bytes(b"stale")

            def fake_run(command, **kwargs):
                pattern = Path(command[-1])
                (pattern.parent / "frame_001.jpg").write_bytes(b"frame")
                return SimpleNamespace(returncode=0, stderr="")

            run_mock.side_effect = fake_run
            result = frames.extract_frames(video, output, max_frames=4, duration=120)

            command = run_mock.call_args.args[0]
            video_filter = command[command.index("-vf") + 1]
            self.assertIn("fps=1/30.0000", video_filter)
            self.assertIn("min(1280,iw)", video_filter)
            self.assertFalse(stale.exists())
            self.assertEqual(result, [output / "frame_001.jpg"])

    @patch("frames.subprocess.run")
    def test_failed_refresh_preserves_existing_frames(self, run_mock) -> None:
        run_mock.return_value = SimpleNamespace(returncode=1, stderr="temporary failure")
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "source.mp4"
            video.write_bytes(b"video")
            output = root / "frames"
            output.mkdir()
            existing = output / "frame_001.jpg"
            existing.write_bytes(b"existing")

            with self.assertRaisesRegex(RuntimeError, "temporary failure"):
                frames.extract_frames(video, output)

            self.assertEqual(existing.read_bytes(), b"existing")

    @unittest.skipUnless(shutil.which("ffmpeg"), "ffmpeg is required")
    def test_extracts_frames_with_real_ffmpeg(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "source.mp4"
            subprocess.run(
                [
                    "ffmpeg",
                    "-loglevel",
                    "error",
                    "-f",
                    "lavfi",
                    "-i",
                    "color=c=red:s=640x360:d=2",
                    "-c:v",
                    "mpeg4",
                    "-y",
                    str(video),
                ],
                check=True,
                capture_output=True,
            )

            result = frames.extract_frames(
                video,
                root / "frames",
                max_frames=2,
                duration=2,
                max_edge=320,
            )

            self.assertEqual(len(result), 2)
            self.assertTrue(all(frame.stat().st_size > 0 for frame in result))


if __name__ == "__main__":
    unittest.main()
