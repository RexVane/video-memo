from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import transcribe  # noqa: E402


def _successful_model():
    model = MagicMock()
    model.transcribe.return_value = (
        iter([SimpleNamespace(start=0.0, end=1.0, text=" Hello ")]),
        SimpleNamespace(language="en"),
    )
    return model


class TranscribeTests(unittest.TestCase):
    def test_default_model_dir_is_inside_project(self) -> None:
        with patch.dict(os.environ, {"WHISPER_MODEL_DIR": ""}):
            model_dir = transcribe.get_whisper_model_dir()

        self.assertEqual(
            model_dir,
            transcribe.PROJECT_ROOT / "models" / "faster-whisper",
        )

    def test_relative_model_dir_override_is_resolved_from_project(self) -> None:
        with patch.dict(
            os.environ,
            {"WHISPER_MODEL_DIR": "models/custom-whisper"},
        ):
            model_dir = transcribe.get_whisper_model_dir()

        self.assertEqual(
            model_dir,
            transcribe.PROJECT_ROOT / "models" / "custom-whisper",
        )

    def test_cuda_probe_error_is_treated_as_unavailable(self) -> None:
        fake_module = SimpleNamespace(
            get_cuda_device_count=MagicMock(
                side_effect=RuntimeError("CUDA driver is unavailable")
            )
        )

        with patch.dict(sys.modules, {"ctranslate2": fake_module}):
            ready, reason = transcribe._cuda_runtime_status()

        self.assertFalse(ready)
        self.assertIn("CUDA driver is unavailable", reason or "")

    def test_auto_uses_cpu_when_cuda_runtime_is_incomplete(self) -> None:
        model = _successful_model()
        factory = MagicMock(return_value=model)
        fake_module = SimpleNamespace(WhisperModel=factory)
        statuses: list[str] = []

        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            model_dir = Path(tmp) / "models"
            audio.write_bytes(b"audio")
            with patch.dict(sys.modules, {"faster_whisper": fake_module}), patch.object(
                transcribe,
                "_cuda_runtime_status",
                return_value=(False, "缺少 cublas64_12.dll"),
            ), patch.object(
                transcribe,
                "get_whisper_model_dir",
                return_value=model_dir,
            ):
                result = transcribe.transcribe(audio, on_status=statuses.append)

        factory.assert_called_once_with(
            "base",
            device="cpu",
            compute_type="int8",
            download_root=str(model_dir),
        )
        self.assertEqual(result.text, "[00:00] Hello")
        self.assertIn("cublas64_12.dll", statuses[0])

    def test_auto_retries_on_cpu_when_cuda_inference_fails(self) -> None:
        cuda_model = MagicMock()
        cuda_model.transcribe.side_effect = RuntimeError(
            "Library cublas64_12.dll is not found or cannot be loaded"
        )
        cpu_model = _successful_model()
        factory = MagicMock(side_effect=[cuda_model, cpu_model])
        fake_module = SimpleNamespace(WhisperModel=factory)
        statuses: list[str] = []

        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            model_dir = Path(tmp) / "models"
            audio.write_bytes(b"audio")
            with patch.dict(sys.modules, {"faster_whisper": fake_module}), patch.object(
                transcribe,
                "_cuda_runtime_status",
                return_value=(True, None),
            ), patch.object(
                transcribe,
                "get_whisper_model_dir",
                return_value=model_dir,
            ):
                result = transcribe.transcribe(audio, on_status=statuses.append)

        self.assertEqual(factory.call_count, 2)
        self.assertEqual(factory.call_args_list[0].kwargs["device"], "cuda")
        self.assertEqual(factory.call_args_list[1].kwargs["device"], "cpu")
        self.assertEqual(
            factory.call_args_list[0].kwargs["download_root"],
            str(model_dir),
        )
        self.assertEqual(
            factory.call_args_list[1].kwargs["download_root"],
            str(model_dir),
        )
        self.assertEqual(result.language, "en")
        self.assertTrue(any("自动切换 CPU" in status for status in statuses))


if __name__ == "__main__":
    unittest.main()
