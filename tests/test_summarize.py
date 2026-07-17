from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import summarize  # noqa: E402


class SummarizeTests(unittest.TestCase):
    @patch("summarize.OpenAI")
    def test_client_uses_custom_openai_compatible_endpoint(self, openai_mock) -> None:
        summarize._client(
            "custom-model",
            api_key="custom-key",
            base_url="https://gateway.example.test/v1",
        )

        openai_mock.assert_called_once_with(
            api_key="custom-key",
            base_url="https://gateway.example.test/v1",
        )

    def test_split_transcript_preserves_content(self) -> None:
        text = "[00:00] First line\n" + "x" * 25 + "\n[00:10] Last line"
        chunks = summarize._split_transcript(text, max_chars=10)

        self.assertEqual("".join(chunks), text)
        self.assertTrue(all(len(chunk) <= 10 for chunk in chunks))

    def test_timestamp_bounds_supports_short_and_hour_timestamps(self) -> None:
        self.assertEqual(
            summarize._timestamp_bounds("[00:10] A\n[01:02:03] B"),
            ("00:10", "01:02:03"),
        )

    def test_responses_api_converts_multimodal_messages(self) -> None:
        client = MagicMock()
        client.responses.create.return_value = SimpleNamespace(output_text="result")
        messages = [
            {"role": "system", "content": "System prompt"},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Transcript"},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": "data:image/jpeg;base64,abc",
                            "detail": "high",
                        },
                    },
                ],
            },
        ]

        with patch.dict(os.environ, {"LLM_API_FORMAT": "openai_responses"}):
            response = summarize._chat_completion(
                client,
                model="test-model",
                messages=messages,
                temperature=0.2,
                max_tokens=100,
            )

        self.assertEqual(response, "result")
        request = client.responses.create.call_args.kwargs
        self.assertEqual(request["instructions"], "System prompt")
        self.assertEqual(request["max_output_tokens"], 100)
        self.assertEqual(request["input"][0]["content"][0]["type"], "input_text")
        self.assertEqual(request["input"][0]["content"][1]["type"], "input_image")
        self.assertNotIn("temperature", request)

    def test_detailed_notes_cover_every_chunk(self) -> None:
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="chapter notes"))]
        )
        with patch.object(summarize, "DETAILED_CHUNK_SIZE", 20):
            notes = summarize._generate_chapter_notes(
                client,
                title="Course",
                transcript="[00:00] " + "a" * 45,
                model="test-model",
            )

        self.assertEqual(len(notes), 3)
        self.assertEqual(client.chat.completions.create.call_count, 3)

if __name__ == "__main__":
    unittest.main()
