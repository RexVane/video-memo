from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import httpx

SRC_DIR = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC_DIR))

import summarize  # noqa: E402


def _status_error(status_code: int) -> summarize.APIStatusError:
    request = httpx.Request("POST", "https://api.test/v1/chat/completions")
    response = httpx.Response(status_code=status_code, request=request)
    return summarize.APIStatusError("boom", response=response, body=None)


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

    @patch("summarize._b64_image", side_effect=lambda path: path.stem)
    @patch("summarize._chat_completion")
    @patch("summarize._client")
    def test_summary_uploads_all_requested_frames(
        self,
        client_factory,
        chat_mock,
        _b64_mock,
    ) -> None:
        client_factory.return_value = MagicMock()
        chat_mock.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="summary"))]
        )

        with tempfile.TemporaryDirectory() as tmp:
            frames = [Path(tmp) / f"frame_{index:03d}.jpg" for index in range(13)]
            result = summarize.summarize(
                title="Course",
                url="https://example.test/course",
                uploader="Teacher",
                description="",
                transcript="",
                frame_paths=frames,
                model="test-model",
            )

        self.assertEqual(result, "summary")
        content = chat_mock.call_args.kwargs["messages"][1]["content"]
        self.assertEqual(len(content), 14)
        self.assertEqual(
            [item["type"] for item in content[1:]],
            ["image_url"] * 13,
        )

    def test_timestamp_bounds_supports_short_and_hour_timestamps(self) -> None:
        self.assertEqual(
            summarize._timestamp_bounds("[00:10] A\n[01:02:03] B"),
            ("00:10", "01:02:03"),
        )

    def test_chapter_callout_is_collapsed_and_preserves_markdown(self) -> None:
        note = (
            "### 00:00–03:20｜工作区与仓库\n"
            "#### 关键结论\n"
            "- 工作区的改动需要先暂存。\n\n"
            "#### 边界与易错点\n"
            "不要混淆暂存和提交。"
        )

        callout = summarize._chapter_callout(note)

        self.assertTrue(callout.startswith("> [!note]- 00:00–03:20｜工作区与仓库"))
        self.assertIn("> #### 关键结论", callout)
        self.assertIn("> - 工作区的改动需要先暂存。", callout)
        self.assertIn("\n>\n", callout)

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

    def test_chat_completion_retries_transient_errors_then_succeeds(self) -> None:
        client = MagicMock()
        success = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="ok"))]
        )
        client.chat.completions.create.side_effect = [
            _status_error(503),
            _status_error(429),
            success,
        ]

        with patch.dict(os.environ, {"LLM_API_FORMAT": ""}), patch.object(
            summarize, "RETRY_DELAYS", (0.0,)
        ):
            response = summarize._chat_completion(client, model="m", messages=[])

        self.assertIs(response, success)
        self.assertEqual(client.chat.completions.create.call_count, 3)

    def test_chat_completion_maps_exhausted_rate_limit_to_friendly_error(self) -> None:
        client = MagicMock()
        client.chat.completions.create.side_effect = _status_error(429)

        with patch.dict(os.environ, {"LLM_API_FORMAT": ""}), patch.object(
            summarize, "RETRY_DELAYS", (0.0,)
        ):
            with self.assertRaisesRegex(RuntimeError, "速率限制"):
                summarize._chat_completion(client, model="m", messages=[])

        self.assertEqual(
            client.chat.completions.create.call_count,
            summarize.MAX_API_ATTEMPTS,
        )

    def test_chat_completion_does_not_retry_auth_errors(self) -> None:
        client = MagicMock()
        client.chat.completions.create.side_effect = _status_error(401)

        with patch.dict(os.environ, {"LLM_API_FORMAT": ""}):
            with self.assertRaisesRegex(RuntimeError, "认证失败"):
                summarize._chat_completion(client, model="m", messages=[])

        self.assertEqual(client.chat.completions.create.call_count, 1)

    def test_chat_completion_retries_connection_errors(self) -> None:
        request = httpx.Request("POST", "https://api.test/v1/chat/completions")
        client = MagicMock()
        client.chat.completions.create.side_effect = summarize.APIConnectionError(
            request=request
        )

        with patch.dict(os.environ, {"LLM_API_FORMAT": ""}), patch.object(
            summarize, "RETRY_DELAYS", (0.0,)
        ):
            with self.assertRaisesRegex(RuntimeError, "无法连接"):
                summarize._chat_completion(client, model="m", messages=[])

        self.assertEqual(
            client.chat.completions.create.call_count,
            summarize.MAX_API_ATTEMPTS,
        )

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
        prompt = client.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        self.assertIn("#### 关键结论", prompt)
        self.assertNotIn("#### 本章检查清单", prompt)

    @patch("summarize._generate_chapter_notes")
    @patch("summarize._client")
    def test_final_note_is_scan_first_and_supports_mermaid(
        self,
        client_factory,
        generate_chapters,
    ) -> None:
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content="## 一眼看懂\n精华"))]
        )
        client_factory.return_value = client
        generate_chapters.return_value = [
            "### 00:00–01:00｜基础概念\n#### 关键结论\n- 核心事实"
        ]

        with patch.dict(os.environ, {"LLM_API_FORMAT": ""}):
            result = summarize.summarize(
                title="Course",
                url="https://example.test/course",
                uploader="Teacher",
                description="Description",
                transcript="[00:00] transcript",
                model="test-model",
            )

        request = client.chat.completions.create.call_args.kwargs
        prompt = request["messages"][1]["content"][0]["text"]
        expected_sections = [
            "## 一眼看懂",
            "## 知识脉络",
            "## 核心知识精讲",
            "## 实际怎么做",
            "## 对比与选择",
            "## 易错点与边界",
            "## 画面中的关键信息",
            "## 最后记住",
        ]
        positions = [prompt.index(section) for section in expected_sections]
        self.assertEqual(positions, sorted(positions))
        self.assertIn("~~~mermaid", prompt)
        self.assertNotIn("## 分阶段学习与练习", prompt)
        self.assertNotIn("## 复习清单", prompt)
        self.assertIn("## 逐章参考笔记", result)
        self.assertIn("> [!note]- 00:00–01:00｜基础概念", result)

if __name__ == "__main__":
    unittest.main()
