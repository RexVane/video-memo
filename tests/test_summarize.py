from __future__ import annotations

import json
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
from llm_config import LLMConfig  # noqa: E402


def _fake_resolve_llm_config(
    model: str | None = None,
    *,
    api_key: str | None = None,
    base_url: str | None = None,
    grok_config_path: Path | None = None,
) -> LLMConfig:
    """Stand in for the real resolver while honouring explicit arguments.

    ``summarize()`` resolves the LLM config itself, so without this stub every
    test that calls it would depend on ambient ``LLM_*``/``XAI_*`` environment
    variables or a local ``~/.grok/config.toml``.
    """
    return LLMConfig(
        api_key=api_key or "test-key",
        base_url=(base_url or "https://api.test/v1").rstrip("/"),
        source="test stub",
    )


def _status_error(status_code: int) -> summarize.APIStatusError:
    request = httpx.Request("POST", "https://api.test/v1/chat/completions")
    response = httpx.Response(status_code=status_code, request=request)
    return summarize.APIStatusError("boom", response=response, body=None)


class SummarizeTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch(
            "summarize.resolve_llm_config",
            side_effect=_fake_resolve_llm_config,
        )
        self.resolve_config_mock = patcher.start()
        self.addCleanup(patcher.stop)

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
            timeout=summarize.DEFAULT_LLM_TIMEOUT,
            max_retries=0,
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

        self.assertEqual(result.body, "summary")
        self.assertEqual(result.note_title, "Course")
        content = chat_mock.call_args.kwargs["messages"][1]["content"]
        self.assertEqual(len(content), 14)
        self.assertEqual(
            [item["type"] for item in content[1:]],
            ["image_url"] * 13,
        )

    def test_response_text_marks_length_truncation(self) -> None:
        response = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(content="partial result"),
                    finish_reason="length",
                )
            ]
        )
        text = summarize._response_text(response)
        self.assertIn("partial result", text)
        self.assertIn("输出达到模型长度上限被截断", text)

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
        self.assertIn("## 逐章参考笔记", result.body)
        self.assertIn("> [!note]- 00:00–01:00｜基础概念", result.body)

    @patch("summarize._generate_chapter_notes")
    @patch("summarize._client")
    def test_note_title_extracted_from_tag(self, client_factory, generate_chapters) -> None:
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=(
                            "<<<TITLE>>>Git版本控制核心概念<<<END>>>"
                            "\n## 一眼看懂\n精华"
                        )
                    )
                )
            ]
        )
        client_factory.return_value = client
        generate_chapters.return_value = []

        with patch.dict(os.environ, {"LLM_API_FORMAT": ""}):
            result = summarize.summarize(
                title="原始视频标题",
                url="https://example.test",
                uploader="",
                description="",
                transcript="transcript",
                model="test-model",
            )

        self.assertEqual(result.note_title, "Git版本控制核心概念")
        self.assertNotIn("<<<TITLE>>>", result.body)
        self.assertTrue(result.body.startswith("## 一眼看懂"))

    def test_split_title_falls_back_when_tag_missing(self) -> None:
        body, title = summarize._split_title("plain content", "Fallback")
        self.assertEqual(body, "plain content")
        self.assertEqual(title, "Fallback")

    def test_split_title_handles_multiline_body(self) -> None:
        raw = "<<<TITLE>>>短标题<<<END>>>\n\n## section\ncontent"
        body, title = summarize._split_title(raw, "Fallback")
        self.assertEqual(title, "短标题")
        self.assertTrue(body.startswith("## section"))
        self.assertNotIn("<<<TITLE>>>", body)

    def test_split_front_tags_extracts_topic_and_title(self) -> None:
        raw = (
            "<<<TOPIC>>>Git<<<END>>>\n"
            "<<<TITLE>>>版本控制核心概念<<<END>>>\n\n## 一眼看懂\ncontent"
        )
        body, title, topic = summarize._split_front_tags(raw, "Fallback")
        self.assertEqual(title, "版本控制核心概念")
        self.assertEqual(topic, "Git")
        self.assertTrue(body.startswith("## 一眼看懂"))
        self.assertNotIn("<<<TITLE>>>", body)
        self.assertNotIn("<<<TOPIC>>>", body)

    def test_split_front_tags_handles_reversed_order(self) -> None:
        raw = "<<<TITLE>>>标题甲<<<END>>>\n<<<TOPIC>>>Python<<<END>>>\n正文"
        body, title, topic = summarize._split_front_tags(raw, "Fallback")
        self.assertEqual(title, "标题甲")
        self.assertEqual(topic, "Python")
        self.assertTrue(body.startswith("正文"))

    @patch("summarize._generate_chapter_notes")
    @patch("summarize._client")
    def test_topic_extracted_from_tag(self, client_factory, generate_chapters) -> None:
        client = MagicMock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[
                SimpleNamespace(
                    message=SimpleNamespace(
                        content=(
                            "<<<TOPIC>>>Git<<<END>>>\n"
                            "<<<TITLE>>>版本控制核心概念<<<END>>>\n"
                            "## 一眼看懂\n精华"
                        )
                    )
                )
            ]
        )
        client_factory.return_value = client
        generate_chapters.return_value = []

        with patch.dict(os.environ, {"LLM_API_FORMAT": ""}):
            result = summarize.summarize(
                title="原始视频标题",
                url="https://example.test",
                uploader="",
                description="",
                transcript="transcript",
                model="test-model",
            )

        self.assertEqual(result.topic, "Git")
        self.assertEqual(result.note_title, "版本控制核心概念")
        self.assertTrue(result.body.startswith("## 一眼看懂"))

    def test_uses_anthropic_messages_aliases(self) -> None:
        for value in ("anthropic_messages", "anthropic", "messages", "anthropic-messages"):
            with patch.dict(os.environ, {"LLM_API_FORMAT": value}):
                self.assertTrue(summarize._uses_anthropic_messages())

    def test_anthropic_messages_url(self) -> None:
        self.assertEqual(
            summarize._anthropic_messages_url("https://api.anthropic.com/v1"),
            "https://api.anthropic.com/v1/messages",
        )
        self.assertEqual(
            summarize._anthropic_messages_url("https://api.anthropic.com/v1/"),
            "https://api.anthropic.com/v1/messages",
        )
        self.assertEqual(
            summarize._anthropic_messages_url("https://api.anthropic.com"),
            "https://api.anthropic.com/v1/messages",
        )
        self.assertEqual(
            summarize._anthropic_messages_url("https://proxy.example.test/x/v1"),
            "https://proxy.example.test/x/v1/messages",
        )

    def test_anthropic_content_blocks_converts_text_and_image(self) -> None:
        blocks = summarize._anthropic_content_blocks("plain text")
        self.assertEqual(blocks, [{"type": "text", "text": "plain text"}])

        content = [
            {"type": "text", "text": "hello"},
            {
                "type": "image_url",
                "image_url": {
                    "url": "data:image/jpeg;base64,AAAA",
                    "detail": "high",
                },
            },
        ]
        converted = summarize._anthropic_content_blocks(content)
        self.assertEqual(converted[0], {"type": "text", "text": "hello"})
        self.assertEqual(
            converted[1],
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/jpeg",
                    "data": "AAAA",
                },
            },
        )

    def test_anthropic_content_blocks_rejects_non_data_uri(self) -> None:
        content = [{"type": "image_url", "image_url": {"url": "https://example.test/x.jpg"}}]
        with self.assertRaisesRegex(ValueError, "base64 data URI"):
            summarize._anthropic_content_blocks(content)

    def test_anthropic_completion_sends_messages_request(self) -> None:
        client = httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                json={
                    "content": [{"type": "text", "text": "pong"}],
                },
            )
        ))
        config = SimpleNamespace(api_key="secret-key", base_url="https://api.anthropic.com/v1")
        result = summarize._anthropic_completion(
            client,
            config,
            model="claude-sonnet",
            messages=[
                {"role": "system", "content": "You are helpful"},
                {"role": "user", "content": "ping"},
            ],
            max_tokens=16,
        )
        self.assertEqual(result, "pong")

    def test_anthropic_completion_sends_x_api_key_header(self) -> None:
        captured: dict = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["headers"] = dict(request.headers)
            captured["body"] = request.content
            return httpx.Response(200, json={"content": [{"type": "text", "text": "ok"}]})

        client = httpx.Client(transport=httpx.MockTransport(handler))
        config = SimpleNamespace(api_key="secret-key", base_url="https://api.anthropic.com/v1")
        summarize._anthropic_completion(
            client,
            config,
            model="claude-sonnet",
            messages=[{"role": "user", "content": "ping"}],
            max_tokens=8,
        )
        self.assertEqual(captured["url"], "https://api.anthropic.com/v1/messages")
        self.assertEqual(captured["headers"]["x-api-key"], "secret-key")
        self.assertEqual(captured["headers"]["anthropic-version"], "2023-06-01")
        self.assertNotIn("authorization", {k.lower() for k in captured["headers"]})
        body = json.loads(captured["body"])
        self.assertEqual(body["model"], "claude-sonnet")
        self.assertEqual(body["max_tokens"], 8)
        self.assertEqual(body["messages"][0]["role"], "user")

    def test_anthropic_completion_extracts_text_blocks_and_ignores_others(self) -> None:
        client = httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(
                200,
                json={
                    "content": [
                        {"type": "text", "text": "first"},
                        {"type": "tool_use", "id": "x"},
                        {"type": "text", "text": "second"},
                    ],
                },
            )
        ))
        config = SimpleNamespace(api_key="k", base_url="https://api.anthropic.com/v1")
        result = summarize._anthropic_completion(
            client,
            config,
            model="m",
            messages=[{"role": "user", "content": "ping"}],
        )
        self.assertEqual(result, "first\nsecond")

    def test_anthropic_completion_raises_on_http_error_with_detail(self) -> None:
        client = httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(
                403,
                json={"error": {"type": "forbidden_error", "message": "This account only allows Codex official clients"}},
            )
        ))
        config = SimpleNamespace(api_key="k", base_url="https://api.anthropic.com/v1")
        with self.assertRaises(summarize._AnthropicHttpError) as ctx:
            summarize._anthropic_completion(
                client,
                config,
                model="m",
                messages=[{"role": "user", "content": "ping"}],
            )
        self.assertEqual(ctx.exception.status_code, 403)
        self.assertIn("Codex", ctx.exception.detail)

    def test_anthropic_chat_completion_retries_transient_then_succeeds(self) -> None:
        responses = [
            httpx.Response(503, json={"error": {"message": "busy"}}),
            httpx.Response(429, json={"error": {"message": "rate"}}),
            httpx.Response(200, json={"content": [{"type": "text", "text": "ok"}]}),
        ]
        client = httpx.Client(transport=httpx.MockTransport(lambda request: responses.pop(0)))
        config = SimpleNamespace(api_key="k", base_url="https://api.anthropic.com/v1")
        with patch.object(summarize, "RETRY_DELAYS", (0.0,)):
            result = summarize._anthropic_chat_completion(
                client,
                config,
                model="m",
                messages=[{"role": "user", "content": "ping"}],
            )
        self.assertEqual(result, "ok")

    def test_anthropic_chat_completion_maps_rate_limit(self) -> None:
        client = httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(429, json={"error": {"message": "rate"}})
        ))
        config = SimpleNamespace(api_key="k", base_url="https://api.anthropic.com/v1")
        with patch.object(summarize, "RETRY_DELAYS", (0.0,)):
            with self.assertRaisesRegex(RuntimeError, "速率限制"):
                summarize._anthropic_chat_completion(
                    client,
                    config,
                    model="m",
                    messages=[{"role": "user", "content": "ping"}],
                )

    def test_anthropic_chat_completion_does_not_retry_401(self) -> None:
        client = httpx.Client(transport=httpx.MockTransport(
            lambda request: httpx.Response(401, json={"error": {"message": "invalid x-api-key"}})
        ))
        config = SimpleNamespace(api_key="k", base_url="https://api.anthropic.com/v1")
        with self.assertRaisesRegex(RuntimeError, "认证失败"):
            summarize._anthropic_chat_completion(
                client,
                config,
                model="m",
                messages=[{"role": "user", "content": "ping"}],
            )

    def test_anthropic_chat_completion_retries_connection_errors(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("boom", request=request)

        client = httpx.Client(transport=httpx.MockTransport(handler))
        config = SimpleNamespace(api_key="k", base_url="https://api.anthropic.com/v1")
        with patch.object(summarize, "RETRY_DELAYS", (0.0,)):
            with self.assertRaisesRegex(RuntimeError, "无法连接"):
                summarize._anthropic_chat_completion(
                    client,
                    config,
                    model="m",
                    messages=[{"role": "user", "content": "ping"}],
                )

if __name__ == "__main__":
    unittest.main()
