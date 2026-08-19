"""Summarize transcript and optional frames with an OpenAI-compatible API."""

from __future__ import annotations

import base64
import math
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import httpx
from openai import APIConnectionError, APIStatusError, OpenAI

from cancellation import CancellationRequested, CancellationSignal, check_cancelled
from llm_config import default_model, resolve_llm_config

MAX_IMAGE_BYTES = 8 * 1024 * 1024
MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024
DETAILED_CHUNK_SIZE = 6_500
MAX_DETAILED_CHUNKS = 12
MAX_API_ATTEMPTS = 3
RETRY_DELAYS = (2.0, 5.0)
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
DEFAULT_LLM_TIMEOUT = 300.0
CHAPTER_PHASE_CEILING = 0.80
TRUNCATION_WARNING = (
    "\n\n> [!warning] 本节输出达到模型长度上限被截断，内容可能不完整。"
)
API_ERROR_MESSAGES = {
    401: "API 认证失败，请检查 API Key 是否与 Base URL 匹配。",
    402: (
        "API 额度不足或订阅不可用。完整转写已经保留；充值、升级订阅或切换"
        "其它 OpenAI 兼容 API 后，可直接重新生成报告。"
    ),
    429: "API 请求过于频繁或已达到速率限制，请稍后重试。",
}
SummaryProgressCb = Callable[[str, float], None]

# Tokens that look like credentials must never reach a log, a note, or an
# exception message. Gateways frequently echo the Authorization header back in
# 4xx/5xx bodies, so every server-supplied string is scrubbed before reuse.
_SECRET_PATTERNS = (
    re.compile(r"\b(?:sk|xai|pk|rk|ak)-[A-Za-z0-9_\-]{8,}", re.IGNORECASE),
    re.compile(r"\bBearer\s+[A-Za-z0-9._\-]{8,}", re.IGNORECASE),
    re.compile(r"\b[A-Za-z0-9_\-]{32,}\b"),
)


def llm_timeout() -> float:
    """Per-request timeout in seconds; ``LLM_TIMEOUT`` overrides the default."""
    raw = os.environ.get("LLM_TIMEOUT", "").strip()
    if not raw:
        return DEFAULT_LLM_TIMEOUT
    try:
        value = float(raw)
    except ValueError:
        return DEFAULT_LLM_TIMEOUT
    return value if value > 0 else DEFAULT_LLM_TIMEOUT


def _redact(text: object, limit: int = 240) -> str:
    """Strip credential-looking tokens from server-supplied text."""
    value = str(text or "")
    for pattern in _SECRET_PATTERNS:
        value = pattern.sub("<redacted>", value)
    return value[:limit]

TITLE_TAG_OPEN = "<<<TITLE>>>"
TOPIC_TAG_OPEN = "<<<TOPIC>>>"
TITLE_TAG_CLOSE = "<<<END>>>"


@dataclass
class SummarizeResult:
    """Summary body plus short content-derived title and topic for note naming."""

    body: str
    note_title: str
    topic: str = ""


def _split_front_tags(
    raw: str,
    fallback_title: str,
    fallback_topic: str = "",
) -> tuple[str, str, str]:
    """Extract <<<TOPIC>>>/<<<TITLE>>> prefixes; return (body, title, topic).

    Each tag is matched independently and stripped from the body, so the model
    may emit them in either order without breaking extraction.
    """
    body = raw
    title = fallback_title
    topic = fallback_topic
    for tag, field in ((TOPIC_TAG_OPEN, "topic"), (TITLE_TAG_OPEN, "title")):
        match = re.search(
            re.escape(tag) + r"\s*(.+?)\s*" + re.escape(TITLE_TAG_CLOSE),
            body,
            flags=re.DOTALL,
        )
        if not match:
            continue
        value = match.group(1).strip()
        if field == "title":
            title = value or fallback_title
        else:
            topic = value or fallback_topic
        body = (body[: match.start()] + body[match.end():]).strip()
    return body, title, topic


def _split_title(raw: str, fallback: str) -> tuple[str, str]:
    """Extract a <<<TITLE>>>...<<<END>>> prefix; return (body, title)."""
    body, title, _ = _split_front_tags(raw, fallback)
    return body, title


def require_api_key(
    api_key: str | None = None,
    *,
    base_url: str | None = None,
    model: str | None = None,
) -> str:
    return resolve_llm_config(model, api_key=api_key, base_url=base_url).api_key


def _client(
    model: str,
    api_key: str | None = None,
    base_url: str | None = None,
) -> OpenAI:
    config = resolve_llm_config(model, api_key=api_key, base_url=base_url)
    # max_retries=0 keeps retry policy (and cancellation) in _chat_completion;
    # the SDK default of 2 would silently triple every attempt and ignore the
    # cancel event while sleeping.
    return OpenAI(
        api_key=config.api_key,
        base_url=config.base_url,
        timeout=llm_timeout(),
        max_retries=0,
    )


def _b64_image(path: Path) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"关键帧不存在: {path}")
    if path.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError(f"关键帧超过 8 MB，请先压缩: {path}")
    data = path.read_bytes()
    return base64.standard_b64encode(data).decode("ascii")


def _select_frames_within_budget(frames: list[Path]) -> tuple[list[Path], int]:
    """Keep frames in order until the total on-disk size hits the budget.

    Base64 inflates payloads by ~33% and the whole request is held in memory,
    so an unbounded frame list can blow up RAM well before the API rejects it.
    A frame whose size cannot be read is kept, not dropped: ``_b64_image`` will
    raise a precise error for it rather than the note silently losing a frame.
    """
    selected: list[Path] = []
    total = 0
    for frame in frames:
        try:
            size = frame.stat().st_size
        except OSError:
            size = 0
        if selected and total + size > MAX_TOTAL_IMAGE_BYTES:
            break
        selected.append(frame)
        total += size
    return selected, len(frames) - len(selected)


def _split_transcript(text: str, max_chars: int) -> list[str]:
    """Split on transcript lines while keeping every character in order."""
    if max_chars < 1:
        raise ValueError("max_chars 必须大于 0")
    chunks: list[str] = []
    current: list[str] = []
    current_size = 0

    for line in text.splitlines(keepends=True):
        while len(line) > max_chars:
            if current:
                chunks.append("".join(current))
                current = []
                current_size = 0
            chunks.append(line[:max_chars])
            line = line[max_chars:]

        if current and current_size + len(line) > max_chars:
            chunks.append("".join(current))
            current = []
            current_size = 0
        current.append(line)
        current_size += len(line)

    if current:
        chunks.append("".join(current))
    return [chunk for chunk in chunks if chunk]


def _response_text(response) -> str:
    if isinstance(response, str):
        text = response
        truncated = False
    else:
        choices = getattr(response, "choices", None)
        if not choices:
            # Some gateways answer 200 with an empty choices list when a
            # moderation filter fires; indexing would raise a bare IndexError.
            raise RuntimeError("AI 服务返回了空内容（没有候选回复）")
        text = choices[0].message.content or ""
        truncated = getattr(choices[0], "finish_reason", None) == "length"
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("AI 服务返回了空内容")
    text = text.strip()
    # Never hand back a silently cut note: the marker survives into the report
    # so the reader can tell the model ran out of output budget.
    if truncated and TRUNCATION_WARNING.strip() not in text:
        text += TRUNCATION_WARNING
    return text


def _uses_responses_api() -> bool:
    value = os.environ.get("LLM_API_FORMAT", "").strip().lower().replace("-", "_")
    return value in {"responses", "openai_responses", "response"}


def _uses_anthropic_messages() -> bool:
    value = os.environ.get("LLM_API_FORMAT", "").strip().lower().replace("-", "_")
    return value in {"anthropic_messages", "anthropic", "messages"}


def _anthropic_messages_url(base_url: str) -> str:
    """Append /messages to the API root, matching the plugin's endpoint logic."""
    url = base_url.rstrip("/")
    if url.endswith("/messages"):
        return url
    if url.endswith("/v1"):
        return f"{url}/messages"
    if "/v1/" in url:
        return f"{url}/messages"
    return f"{url}/v1/messages"


def _anthropic_content_blocks(content) -> list[dict]:
    """Convert OpenAI-style content to Anthropic content blocks."""
    if isinstance(content, str):
        return [{"type": "text", "text": content}]
    blocks: list[dict] = []
    for item in content or []:
        item_type = item.get("type")
        if item_type == "text":
            blocks.append({"type": "text", "text": item.get("text", "")})
        elif item_type == "image_url":
            image = item.get("image_url") or {}
            data_uri = image.get("url", "")
            # Parse data:image/jpeg;base64,<data>
            if not data_uri.startswith("data:"):
                raise ValueError("Anthropic 仅支持 base64 data URI 图片")
            header, _, b64data = data_uri.partition(",")
            media_type = "image/jpeg"
            if ";base64," in header:
                media_type = header[5:].split(";")[0] or media_type
            blocks.append(
                {
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": b64data,
                    },
                }
            )
    return blocks


def _responses_message_content(content) -> list[dict]:
    if isinstance(content, str):
        return [{"type": "input_text", "text": content}]
    converted: list[dict] = []
    for item in content or []:
        if item.get("type") == "text":
            converted.append({"type": "input_text", "text": item.get("text", "")})
        elif item.get("type") == "image_url":
            image = item.get("image_url") or {}
            converted.append(
                {
                    "type": "input_image",
                    "image_url": image.get("url", ""),
                    "detail": image.get("detail", "auto"),
                }
            )
    return converted


def _responses_completion(client: OpenAI, **kwargs) -> str:
    instructions: list[str] = []
    input_messages: list[dict] = []
    for message in kwargs.get("messages") or []:
        role = message.get("role", "user")
        content = message.get("content", "")
        if role == "system":
            if isinstance(content, str) and content.strip():
                instructions.append(content)
            continue
        input_messages.append(
            {
                "role": role,
                "content": _responses_message_content(content),
            }
        )

    request = {
        "model": kwargs["model"],
        "input": input_messages,
    }
    if instructions:
        request["instructions"] = "\n\n".join(instructions)
    if kwargs.get("max_tokens"):
        request["max_output_tokens"] = kwargs["max_tokens"]
    response = client.responses.create(**request)
    text = getattr(response, "output_text", "") or ""
    incomplete = getattr(response, "incomplete_details", None)
    reason = getattr(incomplete, "reason", None)
    if isinstance(incomplete, dict):
        reason = incomplete.get("reason")
    if (
        text
        and (
            getattr(response, "status", None) == "incomplete"
            or reason in {"max_output_tokens", "length"}
        )
    ):
        text += TRUNCATION_WARNING
    return text


def _wait_before_retry(
    attempt: int,
    cancel_event: CancellationSignal | None = None,
) -> None:
    delay = RETRY_DELAYS[min(attempt - 1, len(RETRY_DELAYS) - 1)]
    deadline = time.monotonic() + delay
    while time.monotonic() < deadline:
        check_cancelled(cancel_event)
        time.sleep(min(0.2, max(0.0, deadline - time.monotonic())))


class _AnthropicHttpError(Exception):
    """Wraps an httpx HTTPStatusError with a status code and detail."""

    def __init__(self, status_code: int, detail: str):
        self.status_code = status_code
        self.detail = detail
        super().__init__(f"HTTP {status_code}: {detail}")


def _anthropic_completion(
    http_client: httpx.Client,
    config,
    *,
    model: str,
    messages: list[dict],
    temperature: float = 0.2,
    max_tokens: int = 4_000,
) -> str:
    """Send a single native Anthropic Messages request via httpx."""
    system_parts: list[str] = []
    anthropic_messages: list[dict] = []
    for message in messages:
        role = message.get("role", "user")
        content = message.get("content", "")
        if role == "system":
            if isinstance(content, str) and content.strip():
                system_parts.append(content)
            continue
        anthropic_messages.append(
            {"role": role, "content": _anthropic_content_blocks(content)}
        )

    request_body: dict = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": anthropic_messages,
        "temperature": temperature,
    }
    if system_parts:
        request_body["system"] = "\n\n".join(system_parts)

    endpoint = _anthropic_messages_url(config.base_url)
    response = http_client.post(
        endpoint,
        json=request_body,
        headers={
            "x-api-key": config.api_key,
            "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    if response.status_code < 200 or response.status_code >= 300:
        detail = ""
        try:
            payload = response.json()
            error_obj = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(error_obj, dict):
                detail = _redact(error_obj.get("message", ""))
            elif isinstance(payload, dict) and payload.get("message"):
                detail = _redact(payload["message"])
        except Exception:
            detail = _redact(response.text)
        raise _AnthropicHttpError(response.status_code, detail)

    try:
        payload = response.json()
    except Exception as error:
        raise RuntimeError("AI 服务返回了无法解析的响应（非 JSON）") from error
    if not isinstance(payload, dict):
        raise RuntimeError("AI 服务返回了意外的响应结构")
    blocks = payload.get("content")
    if not isinstance(blocks, list):
        blocks = []
    text_parts = [
        block.get("text", "")
        for block in blocks
        if isinstance(block, dict) and block.get("type") == "text"
    ]
    text = "\n".join(part for part in text_parts if part)
    if payload.get("stop_reason") == "max_tokens" and text:
        text += TRUNCATION_WARNING
    return text


def _anthropic_chat_completion(
    http_client: httpx.Client | None,
    config,
    *,
    cancel_event: CancellationSignal | None = None,
    **kwargs,
) -> str:
    """Call Anthropic Messages API with the same retry semantics as Chat/Responses."""
    if http_client is None or config is None:
        raise RuntimeError("Anthropic Messages 模式需要 httpx 客户端和 LLM 配置")
    for attempt in range(1, MAX_API_ATTEMPTS + 1):
        check_cancelled(cancel_event)
        try:
            return _anthropic_completion(
                http_client,
                config,
                model=kwargs["model"],
                messages=kwargs.get("messages", []),
                temperature=kwargs.get("temperature", 0.2),
                max_tokens=kwargs.get("max_tokens", 4_000),
            )
        except httpx.RequestError:
            if attempt == MAX_API_ATTEMPTS:
                raise RuntimeError(
                    f"无法连接 AI 服务，已自动重试 {MAX_API_ATTEMPTS} 次仍失败。"
                    "请检查网络或 Base URL 后重试。"
                )
        except _AnthropicHttpError as error:
            retryable = error.status_code in RETRYABLE_STATUS_CODES
            if not retryable or attempt == MAX_API_ATTEMPTS:
                message = API_ERROR_MESSAGES.get(error.status_code)
                if message:
                    raise RuntimeError(message) from None
                if retryable:
                    raise RuntimeError(
                        f"AI 服务暂时不可用（HTTP {error.status_code}），"
                        f"已自动重试 {MAX_API_ATTEMPTS} 次仍失败，请稍后重试。"
                    ) from None
                detail = _redact(error.detail)
                raise RuntimeError(
                    f"Anthropic 请求失败（HTTP {error.status_code}）{('：' + detail) if detail else ''}"
                ) from None
        _wait_before_retry(attempt, cancel_event)
    raise RuntimeError("Anthropic 请求已耗尽重试次数")


def _chat_completion(
    client: OpenAI,
    *,
    cancel_event: CancellationSignal | None = None,
    http_client: httpx.Client | None = None,
    config=None,
    **kwargs,
):
    """Call the API, retrying transient failures (rate limits, 5xx, network)."""
    if _uses_anthropic_messages():
        return _anthropic_chat_completion(
            http_client,
            config,
            cancel_event=cancel_event,
            **kwargs,
        )
    for attempt in range(1, MAX_API_ATTEMPTS + 1):
        check_cancelled(cancel_event)
        try:
            if _uses_responses_api():
                return _responses_completion(client, **kwargs)
            return client.chat.completions.create(**kwargs)
        except APIConnectionError as error:
            if attempt == MAX_API_ATTEMPTS:
                raise RuntimeError(
                    f"无法连接 AI 服务，已自动重试 {MAX_API_ATTEMPTS} 次仍失败。"
                    "请检查网络或 Base URL 后重试。"
                ) from error
        except APIStatusError as error:
            retryable = error.status_code in RETRYABLE_STATUS_CODES
            if not retryable or attempt == MAX_API_ATTEMPTS:
                message = API_ERROR_MESSAGES.get(error.status_code)
                if message:
                    raise RuntimeError(message) from None
                if retryable:
                    raise RuntimeError(
                        f"AI 服务暂时不可用（HTTP {error.status_code}），"
                        f"已自动重试 {MAX_API_ATTEMPTS} 次仍失败，请稍后重试。"
                    ) from None
                # Never re-raise the SDK error verbatim: its message embeds the
                # whole response body, which many gateways fill with the
                # Authorization header we just sent.
                raise RuntimeError(
                    f"AI 请求失败（HTTP {error.status_code}）："
                    f"{_redact(getattr(error, 'message', '') or error)}"
                ) from None
        _wait_before_retry(attempt, cancel_event)


def _timestamp_bounds(chunk: str) -> tuple[str, str]:
    timestamps = re.findall(r"\[(\d{2}:\d{2}(?::\d{2})?)\]", chunk)
    if not timestamps:
        return "未知", "未知"
    return timestamps[0], timestamps[-1]


def _chapter_callout(note: str) -> str:
    """Wrap a chapter note in a collapsed Obsidian callout."""
    lines = note.strip().splitlines()
    if not lines:
        return ""

    heading = re.match(r"^###\s+(.+?)\s*$", lines[0])
    title = heading.group(1) if heading else "章节参考"
    body = lines[1:] if heading else lines
    quoted_body = "\n".join(f"> {line}" if line else ">" for line in body)
    if not quoted_body:
        return f"> [!note]- {title}"
    return f"> [!note]- {title}\n>\n{quoted_body}"


def _generate_chapter_notes(
    client: OpenAI,
    *,
    title: str,
    transcript: str,
    model: str,
    on_progress: SummaryProgressCb | None = None,
    cancel_event: CancellationSignal | None = None,
    http_client: httpx.Client | None = None,
    config=None,
) -> list[str]:
    check_cancelled(cancel_event)
    if not transcript.strip():
        return []

    chunk_size = max(
        DETAILED_CHUNK_SIZE,
        math.ceil(len(transcript) / MAX_DETAILED_CHUNKS),
    )
    chunks = _split_transcript(transcript, chunk_size)
    notes: list[str | None] = [None] * len(chunks)
    notes_model = os.environ.get("LLM_NOTES_MODEL", "").strip() or model
    system = (
        "你是严谨的知识编辑，负责从视频逐字稿中提取可验证的精华知识。"
        "必须覆盖片段中的每一个实质主题、概念、操作步骤、示例、对比、限制和警告，"
        "合并重复表述，删除寒暄、口头禅、广告和无信息量内容。可以纠正上下文明确的 ASR 同音错误"
        "（例如把 Gate 纠正为 Git），"
        "但不得补充原文没有的事实。保留重要时间戳和命令名。"
    )

    def generate_one(index: int, chunk: str) -> tuple[int, str]:
        check_cancelled(cancel_event)
        start, end = _timestamp_bounds(chunk)
        response = _chat_completion(
            client,
            cancel_event=cancel_event,
            http_client=http_client,
            config=config,
            model=notes_model,
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": f"""课程标题：{title}
这是连续转写的第 {index}/{len(chunks)} 段，时间范围约 {start}–{end}。

请输出 Markdown，严格使用以下结构：
### {start}–{end}｜根据内容拟定章节标题
#### 关键结论
用 1–3 条具体结论概括本段价值，不写“本章介绍了……”之类空话。
#### 知识与原理
按信息重要性解释“是什么、为什么、如何工作、何时使用”，保留必要例子与因果关系。
#### 操作与案例
仅在原文确有操作时，还原执行顺序、界面位置、命令意图、结果与判断方法。
#### 边界与易错点
仅列原文明确提及的限制、风险、例外和纠正方式。

详略随本段信息密度，不凑字数，不生成学习目标、练习题、自测题或复习任务。

转写原文：
{chunk}""",
                },
            ],
            temperature=0.2,
            max_tokens=2_600,
        )
        return index - 1, _response_text(response)

    workers = min(3, len(chunks))
    if on_progress:
        on_progress(
            f"并行整理 {len(chunks)} 个详细章节（模型 {notes_model}）",
            0.0,
        )
    with ThreadPoolExecutor(max_workers=workers) as executor:
        futures = [
            executor.submit(generate_one, index, chunk)
            for index, chunk in enumerate(chunks, start=1)
        ]
        completed = 0
        failures = 0
        first_error: Exception | None = None
        for future in as_completed(futures):
            check_cancelled(cancel_event)
            try:
                note_index, note = future.result()
            except CancellationRequested:
                raise
            except Exception as error:
                # One bad chunk must not discard the chapters that did succeed;
                # the gap is recorded in the note instead of failing the run.
                failures += 1
                if first_error is None:
                    first_error = error
                completed += 1
                if on_progress:
                    on_progress(
                        f"第 {completed}/{len(chunks)} 段整理失败，将跳过该段",
                        min(
                            CHAPTER_PHASE_CEILING,
                            completed / (len(chunks) + 1),
                        ),
                    )
                continue
            notes[note_index] = note
            completed += 1
            if on_progress:
                on_progress(
                    f"详细章节已完成 {completed}/{len(chunks)}",
                    min(CHAPTER_PHASE_CEILING, completed / (len(chunks) + 1)),
                )
    if failures and failures == len(chunks):
        raise RuntimeError(
            f"全部 {len(chunks)} 个章节均整理失败：{first_error}"
        ) from first_error
    if failures and on_progress:
        on_progress(
            f"注意：{failures}/{len(chunks)} 段未能整理，报告将缺少这些内容",
            CHAPTER_PHASE_CEILING,
        )
    return [note for note in notes if note]


def summarize(
    *,
    title: str,
    url: str,
    uploader: str,
    description: str,
    transcript: str,
    frame_paths: list[Path] | None = None,
    model: str | None = None,
    language: str = "zh",
    api_key: str | None = None,
    base_url: str | None = None,
    on_progress: SummaryProgressCb | None = None,
    cancel_event: CancellationSignal | None = None,
) -> SummarizeResult:
    """
    Build scan-first knowledge notes from transcript and optional key frames.
    """
    model = (model or default_model()).strip()
    config = resolve_llm_config(model, api_key=api_key, base_url=base_url)
    client = _client(model, api_key=api_key, base_url=base_url)
    http_client = (
        httpx.Client(timeout=httpx.Timeout(llm_timeout()))
        if _uses_anthropic_messages()
        else None
    )
    try:
        check_cancelled(cancel_event)
        frames, dropped_frames = _select_frames_within_budget(frame_paths or [])
        if dropped_frames and on_progress:
            on_progress(
                f"关键帧总体积超过上限，已只发送前 {len(frames)} 张"
                f"（跳过 {dropped_frames} 张）",
                0.0,
            )
        chapter_notes = _generate_chapter_notes(
            client,
            http_client=http_client,
            config=config,
            title=title,
            transcript=transcript,
            model=model,
            on_progress=on_progress,
            cancel_event=cancel_event,
        )
        detailed_material = (
            "\n\n".join(chapter_notes)
            if chapter_notes
            else "（无可用转写，可能是纯音乐、无对白或 ASR 失败）"
        )
        output_language = {
            "zh": "中文",
            "en": "英文",
            "ja": "日文",
            "ko": "韩文",
        }.get(language, language)

        system = (
            "你是资深知识编辑和可视化讲解者。请把全部章节材料提炼成一份"
            "先速学、后深挖的知识笔记，让读者不看原视频也能迅速理解最有价值的内容。"
            "忠于材料，不编造；合并重复信息，删除寒暄、推广和无信息量细节。"
            "核心概念要用通俗语言解释是什么、为什么、如何工作、何时使用及其边界。"
            "复杂流程、架构、依赖或因果关系适合时使用有效的 Mermaid 图，不为装饰而画图。"
            "不要生成练习题、自测题、学习任务或泛泛的课程评价。"
            "输出适合 Obsidian 阅读的 Markdown，不输出 YAML frontmatter、一级标题或重复的视频标题。"
            f"使用{output_language}输出。"
            "在回复最开头先用 <<<TOPIC>>> 和 <<<END>>> 包裹一个 2-6 字的主题分类词"
            "（如：Git、Python、Obsidian、效率工具、外语学习），用于 Obsidian 归档目录命名，"
            "必须具体准确、能代表整份材料；再紧接着用 <<<TITLE>>> 和 <<<END>>> 包裹一个 "
            "10-30 字的简短笔记标题，概括材料核心主题，不要包含'笔记'或'总结'字样。"
        )

        user_text = f"""请基于以下材料，提炼一份一眼能抓住精华、需要时又能继续深挖的知识笔记。

    【输入元信息】
    - 标题: {title}
    - 链接: {url}
    - 作者/频道: {uploader or "未知"}
    - 简介（可能截断）: {description or "无"}

    【已逐段覆盖的章节材料】
    {detailed_material}

    【编辑原则】
    1. 只保留能帮助读者理解、判断或执行的知识；同一事实只讲一次。
    2. 先给结论和全局关系，再解释原理与细节；术语首次出现时给出白话解释。
    3. 重要判断尽量附原视频时间戳，例如 `[12:34]`；无法从材料确认时明确说明，不猜测。
    4. 没有实质内容的可选章节直接省略，不用写“无”或硬凑篇幅。
    5. 不生成练习题、自测题、课后任务、学习目标清单或空泛感想。
    6. 不输出 YAML、一级标题或视频标题，必须从 `## 一眼看懂` 开始。

    【输出结构】
    ## 一眼看懂
    使用以下顺序控制在约 600–1000 个中文字符，让读者在首屏附近抓住内容：

    > [!abstract] 一句话结论
    > 用一句具体的话说清这份材料最重要的结论。

    ### 核心知识表
    使用 Markdown 表格，列为“知识｜通俗解释｜什么时候有用｜重要度”。重要度只使用“必懂、常用、补充”。

    > [!tip] 最短理解路径
    > 用 3–6 个带箭头的短步骤串起理解顺序；实操类内容则给出最短可执行路径。

    如果材料确有高风险误区，再添加：
    > [!warning] 最容易踩的坑
    > 只列会造成错误理解、失败或损失的关键问题。

    ## 知识脉络
    解释核心知识之间的依赖、流程或因果关系。遇到至少 3 个相互关联节点的复杂流程、系统架构、
    状态变化或决策分支时，优先生成 1 幅 Mermaid 图；简单内容使用列表，不要硬画图。
    Mermaid 必须能直接在 Obsidian 渲染：使用 `flowchart LR` 或 `flowchart TD`，节点文字放在引号中，
    标签简短，连线写明动作或关系，并用 `classDef` 的浅黄、浅绿、浅蓝、浅紫区分不同角色。
    样式参考（按实际知识改写，不要照抄节点）：

    ~~~mermaid
    flowchart LR
        A["输入"] ==>|关键动作| B["处理"]
        B --> C["结果"]
        classDef input fill:#fff3bf,stroke:#e67700,stroke-width:2px,color:#111827
        classDef process fill:#d3f9d8,stroke:#2f9e44,stroke-width:2px,color:#111827
        classDef result fill:#d0ebff,stroke:#1971c2,stroke-width:2px,color:#111827
        class A input
        class B process
        class C result
    ~~~

    ## 核心知识精讲
    按重要性排列，而不是机械照搬视频顺序。每个知识点使用三级标题，并包含：
    - **通俗理解**：先用日常语言讲明白。
    - **原理与价值**：解释为什么成立、解决什么问题。
    - **使用场景**：说明何时有用，何时不适用。
    - **例子或证据**：仅使用材料中的例子、命令、数据或画面证据。
    内容可按知识密度增减，不要为了统一格式重复同一句话。

    ## 实际怎么做
    仅在材料包含可执行流程时保留。按真实顺序写出步骤、操作位置或命令、预期结果和判断方法；
    命令及代码使用带语言标识的代码块。

    ## 对比与选择
    仅在存在容易混淆的概念或多种方案时保留。使用表格呈现差异、适用场景、优势、代价和选择依据。

    ## 易错点与边界
    只收录材料支持的重要限制。优先使用“现象｜原因｜正确做法”表格，区分事实、讲者建议和不确定信息。

    ## 画面中的关键信息
    仅在所附关键帧提供了旁白之外的有效信息时保留，解释界面、图表、代码或字幕具体说明了什么。

    ## 最后记住
    用 3–7 条高信息密度结论收尾，每条都应当在脱离上下文后仍然有意义。

    全文详略随材料的信息密度，不设固定总字数，不凑篇幅。综合跨章节关系并去重，
    不要复制粘贴逐章材料；逐章材料稍后会作为折叠的追溯区自动附在文末。
    """

        if on_progress:
            on_progress("提炼一眼看懂、知识脉络和核心知识", 0.86)
        check_cancelled(cancel_event)

        content: list[dict] = [{"type": "text", "text": user_text}]
        # The pipeline already limits this list to the requested max_frames.
        # Do not silently drop frames here: doing so made --max-frames misleading
        # and caused cache metadata to disagree with what the model received.
        for fp in frames:
            b64 = _b64_image(fp)
            content.append(
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"},
                }
            )

        resp = _chat_completion(
            client,
            cancel_event=cancel_event,
            http_client=http_client,
            config=config,
            model=model,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": content},
            ],
            temperature=0.2,
            max_tokens=6_000,
        )
        overview = _response_text(resp)
        if on_progress:
            on_progress("精华知识笔记生成完成", 1.0)
        overview, note_title, topic = _split_front_tags(overview, title)
        if not chapter_notes:
            return SummarizeResult(body=overview, note_title=note_title, topic=topic)
        chapter_callouts = [_chapter_callout(note) for note in chapter_notes]
        body = (
            f"{overview}\n\n## 逐章参考笔记\n\n"
            "> [!info] 如何使用\n"
            "> 以下内容按原视频时间顺序保留，用于追溯上下文；默认折叠，不影响精华阅读。\n\n"
            + "\n\n".join(callout for callout in chapter_callouts if callout)
        )
        return SummarizeResult(body=body, note_title=note_title, topic=topic)
    finally:
        if http_client:
            http_client.close()
