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
