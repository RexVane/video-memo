from __future__ import annotations

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
    def test_auto_uses_cpu_when_cuda_runtime_is_incomplete(self) -> None:
        model = _successful_model()
        factory = MagicMock(return_value=model)
        fake_module = SimpleNamespace(WhisperModel=factory)
        statuses: list[str] = []

        with tempfile.TemporaryDirectory() as tmp:
            audio = Path(tmp) / "audio.wav"
            audio.write_bytes(b"audio")
            with patch.dict(sys.modules, {"faster_whisper": fake_module}), patch.object(
                transcribe,
                "_cuda_runtime_status",
                return_value=(False, "缺少 cublas64_12.dll"),
            ):
                result = transcribe.transcribe(audio, on_status=statuses.append)

        factory.assert_called_once_with("base", device="cpu", compute_type="int8")
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
            audio.write_bytes(b"audio")
            with patch.dict(sys.modules, {"faster_whisper": fake_module}), patch.object(
                transcribe,
                "_cuda_runtime_status",
                return_value=(True, None),
            ):
                result = transcribe.transcribe(audio, on_status=statuses.append)

        self.assertEqual(factory.call_count, 2)
        self.assertEqual(factory.call_args_list[0].kwargs["device"], "cuda")
        self.assertEqual(factory.call_args_list[1].kwargs["device"], "cpu")
        self.assertEqual(result.language, "en")
        self.assertTrue(any("自动切换 CPU" in status for status in statuses))


if __name__ == "__main__":
    unittest.main()
