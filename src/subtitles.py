"""Convert downloaded WebVTT subtitles to the pipeline transcript format."""

from __future__ import annotations

import html
import re
from pathlib import Path

import webvtt

from transcribe import Transcript, TranscriptSegment

_TAG_RE = re.compile(r"<[^>]+>")


def _timestamp_seconds(value: str) -> float:
    parts = value.replace(",", ".").split(":")
    if len(parts) == 2:
        minutes, seconds = parts
        return (int(minutes) * 60) + float(seconds)
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return (int(hours) * 3600) + (int(minutes) * 60) + float(seconds)
    raise ValueError(f"无效字幕时间戳: {value}")


def _display_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _clean_caption(value: str) -> str:
    without_tags = _TAG_RE.sub("", value)
    return " ".join(html.unescape(without_tags).split())


def transcript_from_vtt(
    path: Path,
    *,
    language: str | None = None,
) -> Transcript:
    if not path.is_file():
        raise FileNotFoundError(f"字幕文件不存在: {path}")

    segments: list[TranscriptSegment] = []
    lines: list[str] = []
    previous_text = ""
    for caption in webvtt.read(str(path)):
        text = _clean_caption(caption.text)
        if not text or text == previous_text:
            continue
        start = _timestamp_seconds(caption.start)
        end = _timestamp_seconds(caption.end)
        segments.append(TranscriptSegment(start=start, end=end, text=text))
        lines.append(f"[{_display_timestamp(start)}] {text}")
        previous_text = text

    if not segments:
        raise RuntimeError(f"字幕文件没有可用文本: {path}")
    return Transcript(language=language, text="\n".join(lines), segments=segments)
