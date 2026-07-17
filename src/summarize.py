"""Summarize transcript and optional frames with an OpenAI-compatible API."""

from __future__ import annotations

import base64
import math
import os
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Callable

from openai import APIStatusError, OpenAI

from llm_config import resolve_llm_config

MAX_IMAGE_BYTES = 8 * 1024 * 1024
DETAILED_CHUNK_SIZE = 6_500
MAX_DETAILED_CHUNKS = 12
SummaryProgressCb = Callable[[str, float], None]


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
    return OpenAI(api_key=config.api_key, base_url=config.base_url)


def _b64_image(path: Path) -> str:
    if not path.is_file():
        raise FileNotFoundError(f"关键帧不存在: {path}")
    if path.stat().st_size > MAX_IMAGE_BYTES:
        raise ValueError(f"关键帧超过 8 MB，请先压缩: {path}")
    data = path.read_bytes()
    return base64.standard_b64encode(data).decode("ascii")


def _split_transcript(text: str, max_chars: int) -> list[str]:
    """Split on transcript lines while keeping every character in order."""
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
    else:
        text = response.choices[0].message.content or ""
    if not isinstance(text, str) or not text.strip():
        raise RuntimeError("AI 服务返回了空内容")
    return text.strip()


def _uses_responses_api() -> bool:
    value = os.environ.get("LLM_API_FORMAT", "").strip().lower().replace("-", "_")
    return value in {"responses", "openai_responses", "response"}


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
    return getattr(response, "output_text", "") or ""


def _chat_completion(client: OpenAI, **kwargs):
    try:
        if _uses_responses_api():
            return _responses_completion(client, **kwargs)
        return client.chat.completions.create(**kwargs)
    except APIStatusError as error:
        messages = {
            401: "API 认证失败，请检查 API Key 是否与 Base URL 匹配。",
            402: (
                "API 额度不足或订阅不可用。完整转写已经保留；充值、升级订阅或切换"
                "其它 OpenAI 兼容 API 后，可直接重新生成报告。"
            ),
            429: "API 请求过于频繁或已达到速率限制，请稍后重试。",
        }
        message = messages.get(error.status_code)
        if message:
            raise RuntimeError(message) from error
        raise


def _timestamp_bounds(chunk: str) -> tuple[str, str]:
    timestamps = re.findall(r"\[(\d{2}:\d{2}(?::\d{2})?)\]", chunk)
    if not timestamps:
        return "未知", "未知"
    return timestamps[0], timestamps[-1]


def _generate_chapter_notes(
    client: OpenAI,
    *,
    title: str,
    transcript: str,
    model: str,
    on_progress: SummaryProgressCb | None = None,
) -> list[str]:
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
        "你是资深课程讲师，负责把视频逐字稿整理成可以真正学习和复习的章节笔记。"
        "必须覆盖片段中的每一个实质主题、概念、操作步骤、示例、对比、限制和警告，"
        "不能只写大纲或几条摘要。可以纠正上下文明确的 ASR 同音错误（例如把 Gate 纠正为 Git），"
        "但不得补充原文没有的事实。保留重要时间戳和命令名。"
    )
    def generate_one(index: int, chunk: str) -> tuple[int, str]:
        start, end = _timestamp_bounds(chunk)
        response = _chat_completion(
            client,
            model=notes_model,
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": f"""课程标题：{title}
这是连续转写的第 {index}/{len(chunks)} 段，时间范围约 {start}–{end}。

请输出 Markdown，严格使用以下结构：
### {start}–{end}｜根据内容拟定章节标题
#### 本章目标
说明学完本章应该理解或会做什么。
#### 详细知识点
逐项讲清楚“是什么、为什么、怎么做、何时使用”，不要省略转写中的独立知识点。
#### 操作与示例
还原讲者给出的流程、界面操作、命令、案例和因果关系。
#### 注意事项与易错点
保留所有限制、风险、例外和协作建议。
#### 本章检查清单
列出可用于复习的具体问题或动作。

内容充足时写成 1200–1800 字的学习笔记，不要用一句话带过多个概念。

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
        for future in as_completed(futures):
            note_index, note = future.result()
            notes[note_index] = note
            completed += 1
            if on_progress:
                on_progress(
                    f"详细章节已完成 {completed}/{len(chunks)}",
                    completed / (len(chunks) + 1),
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
    model: str = "grok-4.5",
    language: str = "zh",
    api_key: str | None = None,
    base_url: str | None = None,
    on_progress: SummaryProgressCb | None = None,
) -> str:
    """
    Build comprehensive study notes from transcript and optional key frames.
    """
    client = _client(model, api_key=api_key, base_url=base_url)
    frames = frame_paths or []
    chapter_notes = _generate_chapter_notes(
        client,
        title=title,
        transcript=transcript,
        model=model,
        on_progress=on_progress,
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
        "你是资深课程设计师。请把全部章节笔记整合成一份可以替代观看视频进行学习的教程。"
        "忠于材料，不编造；不得为了简短而遗漏章节中的实质知识。每个核心概念都解释"
        "是什么、为什么、怎么做、适用场景、风险和例子。若画面与旁白不一致则分别说明。"
        f"使用{output_language}输出。"
    )

    user_text = f"""请基于以下逐章笔记，制作完整课程学习指南。

# 元信息
- 标题: {title}
- 链接: {url}
- 作者/频道: {uploader or "未知"}
- 简介(可能截断): {description or "无"}

# 已逐段覆盖的详细章节笔记
{detailed_material}

# 输出格式（Markdown）
## 课程定位与学习成果
说明课程解决什么问题，学完具体能做什么。

## 完整知识地图
按依赖关系组织全部概念，不限制条目数量。

## 核心概念深讲
逐个解释重要术语的定义、原理、用途、示例及相互区别。

## 从零到一实战操作手册
按实际执行顺序写出完整流程、操作位置、命令意图、结果和检查方法。

## 关键概念对比表
把容易混淆的概念放入 Markdown 表格，列出行为、适用场景、风险和协作影响。

## 常见错误、风险与恢复方法
覆盖材料中提到的全部限制和警告，并给出对应处理方式。

## 画面与演示细节
结合截图和章节笔记解释界面、图示、代码或字幕；没有证据时明确说明。

## 分阶段学习与练习
提供由浅入深的动手练习，每项写清目标、步骤和验收标准。

## 复习清单
给出足够覆盖全课程的自测问题，不限制为 3–8 条。

材料充足时，以上综合指南不少于 4000 个中文字符。不要重复粘贴逐章笔记，
而要补充跨章节关系、实战顺序和对比；逐章原始学习笔记会作为后续章节单独附上。
"""

    if on_progress:
        on_progress("整合知识地图、操作手册和练习", 0.86)

    content: list[dict] = [{"type": "text", "text": user_text}]
    for fp in frames[:12]:
        b64 = _b64_image(fp)
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{b64}", "detail": "high"},
            }
        )

    resp = _chat_completion(
        client,
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
        on_progress("详细学习笔记生成完成", 1.0)
    if not chapter_notes:
        return overview
    return f"{overview}\n\n## 逐章完整学习笔记\n\n" + "\n\n".join(chapter_notes)
