"""Export generated reports and key frames into an Obsidian vault."""

from __future__ import annotations

import hashlib
import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from urllib.parse import unquote, urlparse

from download import AUDIO_EXTS, VIDEO_EXTS, DownloadResult


def _safe_name(value: str, limit: int = 80) -> str:
    cleaned = re.sub(r"[^\w\u4e00-\u9fff\- ]+", "_", value)
    cleaned = re.sub(r"[ _]+", "_", cleaned).strip("_.")
    return cleaned[:limit] or "video_summary"


def _vault_folder(vault: Path, folder: str) -> Path:
    relative = Path(folder.strip() or "Video Summaries")
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Obsidian 目标文件夹必须是 Vault 内的相对路径")
    target = (vault / relative).resolve()
    if not target.is_relative_to(vault):
        raise ValueError("Obsidian 目标文件夹不能超出 Vault")
    return target


def _media_type(metadata: DownloadResult, has_frames: bool) -> str:
    source_path = unquote(urlparse(metadata.webpage_url).path)
    source_suffix = Path(source_path).suffix.lower()
    if source_suffix in AUDIO_EXTS:
        return "audio"
    if metadata.video_path or has_frames or source_suffix in VIDEO_EXTS:
        return "video"
    is_remote = metadata.webpage_url.startswith(("http://", "https://"))
    return "video" if is_remote else "audio"


def export_to_vault(
    summary_path: Path,
    metadata: DownloadResult,
    vault_path: Path,
    *,
    folder: str = "Video Summaries",
) -> Path:
    vault = vault_path.expanduser().resolve()
    if not vault.is_dir():
        raise FileNotFoundError(f"Obsidian Vault 不存在: {vault}")
    if not summary_path.is_file():
        raise FileNotFoundError(f"总结文件不存在: {summary_path}")

    destination = _vault_folder(vault, folder)
    destination.mkdir(parents=True, exist_ok=True)
    source_id = hashlib.sha256(metadata.webpage_url.encode("utf-8")).hexdigest()[:8]
    note_stem = f"{_safe_name(metadata.title)}_{source_id}"
    preferred_note_path = destination / f"{note_stem}.md"
    existing_notes = sorted(
        destination.glob(f"*_{source_id}.md"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    note_path = (
        preferred_note_path
        if preferred_note_path.is_file() or not existing_notes
        else existing_notes[0]
    )
    note_stem = note_path.stem

    frame_links: list[str] = []
    source_frames = sorted(summary_path.parent.glob("frames/frame_*.jpg"))
    if source_frames:
        asset_dir = destination / "assets" / note_stem
        asset_dir.mkdir(parents=True, exist_ok=True)
        for stale in asset_dir.glob("frame_*.jpg"):
            stale.unlink()
        for frame in source_frames:
            copied = asset_dir / frame.name
            shutil.copy2(frame, copied)
            vault_relative = copied.relative_to(vault).as_posix()
            frame_links.append(f"![[{vault_relative}]]")

    media_type = _media_type(metadata, bool(source_frames))
    duration = (
        json.dumps(metadata.duration, ensure_ascii=False)
        if metadata.duration is not None
        else "null"
    )
    frontmatter = "\n".join(
        [
            "---",
            f"title: {json.dumps(metadata.title, ensure_ascii=False)}",
            'type: "learning-note"',
            f"media: {media_type}",
            f"duration_seconds: {duration}",
            f"source: {json.dumps(metadata.webpage_url, ensure_ascii=False)}",
            f"author: {json.dumps(metadata.uploader or '未知', ensure_ascii=False)}",
            f"created: {json.dumps(datetime.now().isoformat(timespec='seconds'))}",
            "tags:",
            "  - learning-note",
            "  - media-summary",
            f"  - {media_type}-summary",
            "---",
            "",
        ]
    )
    body = summary_path.read_text(encoding="utf-8").strip()
    frames_section = ""
    if frame_links:
        frames_section = "\n\n## 关键帧\n\n" + "\n\n".join(frame_links)
    note_path.write_text(
        frontmatter + body + frames_section + "\n",
        encoding="utf-8",
    )
    return note_path
