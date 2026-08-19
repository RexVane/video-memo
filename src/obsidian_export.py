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

_GENERATED_START = "<!-- videomemo:generated:start -->"
_GENERATED_END = "<!-- videomemo:generated:end -->"
_SOURCE_MARKER = "<!-- videomemo:source:{source_id} -->"
_HEAD_SCAN_BYTES = 8 * 1024


def _safe_name(value: str, limit: int = 80) -> str:
    cleaned = re.sub(r"[^\w\u4e00-\u9fff\- ]+", "_", value)
    cleaned = re.sub(r"[ _]+", " ", cleaned).strip(" .")
    return cleaned[:limit] or "videomemo"


def _vault_folder(vault: Path, folder: str) -> Path:
    relative = Path(folder.strip() or ".")
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError("Obsidian 目标文件夹必须是 Vault 内的相对路径")
    target = (vault / relative).resolve()
    if not target.is_relative_to(vault):
        raise ValueError("Obsidian 目标文件夹不能超出 Vault")
    return target


def _topic_folder_name(topic: str | None) -> str:
    """Sanitize the AI-derived topic into a vault-relative folder name."""
    value = (topic or "").strip()
    if not value:
        return ""
    cleaned = _safe_name(value, limit=40)
    return "" if cleaned == "videomemo" else cleaned


def _resolve_destination(
    vault: Path,
    folder: str | None,
    topic: str | None,
) -> Path:
    """Pick the note folder: an explicit folder wins, then the content topic.

    With neither set, notes go directly under the vault root.
    """
    explicit = (folder or "").strip()
    if explicit:
        return _vault_folder(vault, explicit)
    topic_name = _topic_folder_name(topic)
    if topic_name:
        return _vault_folder(vault, topic_name)
    return vault


def _read_head(path: Path, size: int = _HEAD_SCAN_BYTES) -> str:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        return handle.read(size)


def _note_for_source(
    destination: Path,
    preferred: Path,
    source_id: str,
) -> Path:
    """Resolve which note file this export should (re)write.

    The preferred name is the AI-generated title. A file with that exact name
    that already carries our source marker is the same note (title unchanged).
    Otherwise a same-source note may live under an older AI title, so the
    destination is scanned for the marker; adopting it keeps user annotations
    in place. Only when the preferred name is taken by a foreign note do we
    fall back to a source-id-suffixed name so nothing is ever clobbered.
    """
    marker = _SOURCE_MARKER.format(source_id=source_id)
    if preferred.is_file():
        try:
            if marker in _read_head(preferred):
                return preferred
        except OSError:
            pass
    latest: Path | None = None
    latest_mtime = 0.0
    for candidate in destination.glob("*.md"):
        if candidate == preferred:
            continue
        try:
            if marker not in _read_head(candidate):
                continue
        except OSError:
            continue
        mtime = candidate.stat().st_mtime
        if latest is None or mtime > latest_mtime:
            latest = candidate
            latest_mtime = mtime
    if latest is not None:
        return latest
    if preferred.is_file():
        return preferred.with_name(f"{preferred.stem}_{source_id}.md")
    return preferred


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
    folder: str | None = None,
    note_title: str | None = None,
    topic: str | None = None,
) -> Path:
    vault = vault_path.expanduser().resolve()
    if not vault.is_dir():
        raise FileNotFoundError(f"Obsidian Vault 不存在: {vault}")
    if not summary_path.is_file():
        raise FileNotFoundError(f"总结文件不存在: {summary_path}")

    destination = _resolve_destination(vault, folder, topic)
    destination.mkdir(parents=True, exist_ok=True)
    source_id = hashlib.sha256(metadata.webpage_url.encode("utf-8")).hexdigest()[:8]
    name_source = note_title.strip() if note_title and note_title.strip() else metadata.title
    note_stem = _safe_name(name_source)
    preferred_note_path = destination / f"{note_stem}.md"
    note_path = _note_for_source(destination, preferred_note_path, source_id)

    frame_links: list[str] = []
    source_frames = sorted(summary_path.parent.glob("frames/frame_*.jpg"))
    if source_frames:
        # Use the fixed-length source id rather than the human title. Apart from
        # avoiding Windows MAX_PATH failures in deep vaults, attachments keep a
        # stable location when the AI-generated note title changes.
        asset_dir = destination / "assets" / source_id
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
    generated = body + frames_section + "\n"
    source_marker = _SOURCE_MARKER.format(source_id=source_id)
    wrapped = f"{_GENERATED_START}\n{source_marker}\n{generated}{_GENERATED_END}\n"
    final_text = frontmatter + wrapped
    if note_path.is_file():
        previous = note_path.read_text(encoding="utf-8")
        start = previous.find(_GENERATED_START)
        end = previous.find(_GENERATED_END)
        if start >= 0 and end >= start:
            end += len(_GENERATED_END)
            final_text = previous[:start] + wrapped.rstrip("\n") + previous[end:]
        else:
            # A legacy VideoMemo note may contain user annotations with no
            # generated-region markers. Preserve it as a timestamped backup
            # before the one-time migration instead of silently clobbering it.
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            backup = note_path.with_name(f"{note_path.stem}.backup-{stamp}.md")
            shutil.copy2(note_path, backup)
    temporary = note_path.with_suffix(".md.tmp")
    temporary.write_text(final_text, encoding="utf-8")
    temporary.replace(note_path)
    return note_path
