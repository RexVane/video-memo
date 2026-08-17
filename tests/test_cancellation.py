from __future__ import annotations

import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import cancellation  # noqa: E402
import frames  # noqa: E402


class CheckCancelledTests(unittest.TestCase):
    def test_none_signal_is_ignored(self) -> None:
        cancellation.check_cancelled(None)

    def test_unset_signal_is_ignored(self) -> None:
        cancellation.check_cancelled(threading.Event())

    def test_set_signal_raises(self) -> None:
        event = threading.Event()
        event.set()
        with self.assertRaises(cancellation.CancellationRequested):
            cancellation.check_cancelled(event)


class RunCommandTests(unittest.TestCase):
    def test_without_cancel_event_delegates_to_runner(self) -> None:
        calls = []

        def fake_run(command, **kwargs):
            calls.append((command, kwargs))
            return SimpleNamespace(returncode=0)

        result = cancellation.run_command(
            ["echo", "hi"], cancel_event=None, run=fake_run, capture_output=True
        )

        self.assertEqual(result.returncode, 0)
        self.assertEqual(calls, [(["echo", "hi"], {"capture_output": True})])

    def test_pre_set_event_raises_before_running(self) -> None:
        event = threading.Event()
        event.set()
        with self.assertRaises(cancellation.CancellationRequested):
            cancellation.run_command(
                [sys.executable, "-c", "print('hi')"],
                cancel_event=event,
                run=subprocess.run,
            )

    def test_supervised_command_completes_and_captures_output(self) -> None:
        result = cancellation.run_command(
            [sys.executable, "-c", "print('ok')"],
            cancel_event=threading.Event(),
            run=subprocess.run,
            capture_output=True,
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn(b"ok", result.stdout)

    def test_set_event_kills_running_command(self) -> None:
        event = threading.Event()
        timer = threading.Timer(0.3, event.set)
        timer.start()
        try:
            started = time.monotonic()
            with self.assertRaises(cancellation.CancellationRequested):
                cancellation.run_command(
                    [sys.executable, "-c", "import time; time.sleep(5)"],
                    cancel_event=event,
                    run=subprocess.run,
                    capture_output=True,
                )
            self.assertLess(time.monotonic() - started, 4)
        finally:
            timer.cancel()


class FramesCancellationTests(unittest.TestCase):
    def test_cancel_event_is_passed_to_run_command(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "source.mp4"
            video.write_bytes(b"video")
            event = threading.Event()

            def fake_run_command(command, *, cancel_event, run, **kwargs):
                self.assertIs(cancel_event, event)
                pattern = Path(command[-1])
                (pattern.parent / "frame_001.jpg").write_bytes(b"frame")
                return SimpleNamespace(returncode=0, stderr="")

            with patch("frames.run_command", side_effect=fake_run_command):
                result = frames.extract_frames(video, root / "frames", cancel_event=event)
            self.assertEqual(result, [root / "frames" / "frame_001.jpg"])

    def test_set_cancel_event_aborts_before_subprocess(self) -> None:
        event = threading.Event()
        event.set()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            video = root / "source.mp4"
            video.write_bytes(b"video")
            with patch("frames.subprocess.run") as run_mock:
                with self.assertRaises(cancellation.CancellationRequested):
                    frames.extract_frames(video, root / "frames", cancel_event=event)
            run_mock.assert_not_called()


if __name__ == "__main__":
    unittest.main()
