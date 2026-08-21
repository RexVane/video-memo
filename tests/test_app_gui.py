from __future__ import annotations

import queue
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import app_gui  # noqa: E402
from llm_config import LLMConfig  # noqa: E402


class FakeValue:
    def __init__(self, value=None) -> None:
        self.value = value

    def get(self):
        return self.value

    def set(self, value) -> None:
        self.value = value


class FakeWidget:
    def __init__(self) -> None:
        self.options: dict[str, object] = {}

    def configure(self, **kwargs) -> None:
        self.options.update(kwargs)


class FakeProgress:
    def __init__(self) -> None:
        self.value: float | None = None

    def set(self, value: float) -> None:
        self.value = value


def make_queue_app() -> app_gui.VideoMemoApp:
    app = object.__new__(app_gui.VideoMemoApp)
    app._msg_q = queue.Queue()
    app._worker = None
    app._cancel_event = threading.Event()
    app._last_summary_path = Path("old-run/summary.md")
    app._busy = True
    app._closing = False
    app._set_summary = Mock()
    app._log = Mock()
    app.progress = FakeProgress()
    app.status_var = FakeValue()
    app.start_btn = FakeWidget()
    app.regenerate_btn = FakeWidget()
    app.cancel_btn = FakeWidget()
    app.copy_btn = FakeWidget()
    app.after = Mock()
    return app


class AppGuiResultStateTests(unittest.TestCase):
    def test_start_clears_previous_result_before_worker_runs(self) -> None:
        app = make_queue_app()
        app._busy = False
        app.url_var = FakeValue("https://example.test/video")
        app.whisper_var = FakeValue("base")
        app.lang_var = FakeValue("自动检测")
        app.cookie_var = FakeValue("不使用")
        app.frames_var = FakeValue("8")
        app.no_vision_var = FakeValue(False)
        app.cleanup_media_var = FakeValue(False)
        app.llm_var = FakeValue("test-model")
        app.api_key_var = FakeValue("test-key")
        app.api_base_url_var = FakeValue("https://api.example.test/v1")
        app.obsidian_vault_var = FakeValue("")
        app._initial_api_base_url = "https://api.example.test/v1"

        worker = Mock()
        config = LLMConfig(
            api_key="test-key",
            base_url="https://api.example.test/v1",
            source="test",
        )
        with (
            patch.object(app_gui, "resolve_llm_config", return_value=config),
            patch.object(app_gui.threading, "Thread", return_value=worker),
        ):
            app._on_start()

        self.assertIsNone(app._last_summary_path)
        self.assertEqual(app.copy_btn.options["state"], "disabled")
        self.assertTrue(app._busy)
        worker.start.assert_called_once_with()

    def test_error_event_drops_stale_result_and_keeps_copy_disabled(self) -> None:
        app = make_queue_app()
        app._msg_q.put(("error", "request failed", "traceback"))

        app._drain_queue()

        self.assertIsNone(app._last_summary_path)
        self.assertFalse(app._busy)
        self.assertEqual(app.copy_btn.options["state"], "disabled")
        app._set_summary.assert_called_once_with("出错了：\n\nrequest failed\n")

    def test_regenerate_clears_previous_result_before_worker_runs(self) -> None:
        app = make_queue_app()
        app._busy = False
        app.llm_var = FakeValue("test-model")
        app.api_key_var = FakeValue("test-key")
        app.api_base_url_var = FakeValue("https://api.example.test/v1")
        app.obsidian_vault_var = FakeValue("")
        app._initial_api_base_url = "https://api.example.test/v1"

        worker = Mock()
        config = LLMConfig(
            api_key="test-key",
            base_url="https://api.example.test/v1",
            source="test",
        )
        with (
            patch.object(app_gui, "resolve_llm_config", return_value=config),
            patch.object(app_gui.threading, "Thread", return_value=worker),
        ):
            app._on_regenerate()

        self.assertIsNone(app._last_summary_path)
        self.assertEqual(app.copy_btn.options["state"], "disabled")
        self.assertTrue(app._busy)
        worker.start.assert_called_once_with()

    def test_done_event_publishes_only_the_new_result(self) -> None:
        app = make_queue_app()
        new_path = Path("new-run/summary.md")
        app._msg_q.put(("done", new_path, "new summary"))

        app._drain_queue()

        self.assertEqual(app._last_summary_path, new_path)
        self.assertFalse(app._busy)
        self.assertEqual(app.copy_btn.options["state"], "normal")
        app._set_summary.assert_called_once_with("new summary")


if __name__ == "__main__":
    unittest.main()
