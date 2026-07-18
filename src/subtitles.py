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


def _rolling_overlap(previous: str, current: str) -> int:
    previous_folded = previous.casefold()
    current_folded = current.casefold()
    if previous_folded == current_folded:
        return len(current)
    if current_folded.startswith(previous_folded):
        return len(previous)
    if previous_folded.startswith(current_folded):
        return len(current)

    for size in range(min(len(previous), len(current)), 2, -1):
        if previous_folded[-size:] != current_folded[:size]:
            continue
        if previous.isascii() and current.isascii():
            previous_boundary = len(previous) == size or not previous[-size - 1].isalnum()
            current_boundary = len(current) == size or not current[size].isalnum()
            if not previous_boundary or not current_boundary:
                continue
        return size
    return 0


def transcript_from_vtt(
    path: Path,
    *,
    language: str | None = None,
) -> Transcript:
    if not path.is_file():
        raise FileNotFoundError(f"字幕文件不存在: {path}")

    segments: list[TranscriptSegment] = []
    previous_text = ""
    previous_end = -1.0
    active_segment = -1
    for caption in webvtt.read(str(path)):
        text = _clean_caption(caption.text)
        if not text:
            continue
        start = _timestamp_seconds(caption.start)
        end = _timestamp_seconds(caption.end)
        overlap = (
            _rolling_overlap(previous_text, text)
            if previous_text and start < previous_end
            else 0
        )
        if overlap and active_segment >= 0:
            novel_text = text[overlap:]
            if novel_text:
                segments[active_segment].text = (
                    segments[active_segment].text + novel_text
                ).strip()
            segments[active_segment].end = max(segments[active_segment].end, end)
        else:
            segments.append(TranscriptSegment(start=start, end=end, text=text))
            active_segment = len(segments) - 1
        previous_text = text
        previous_end = end

    if not segments:
        raise RuntimeError(f"字幕文件没有可用文本: {path}")
    lines = [
        f"[{_display_timestamp(segment.start)}] {segment.text}"
        for segment in segments
    ]
    return Transcript(language=language, text="\n".join(lines), segments=segments)
