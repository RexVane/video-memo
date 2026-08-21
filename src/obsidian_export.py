"""Export generated reports and key frames into an Obsidian vault."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import time
import uuid
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from typing import Iterator
from urllib.parse import unquote, urlparse

from download import AUDIO_EXTS, VIDEO_EXTS, DownloadResult

_GENERATED_START = "<!-- videomemo:generated:start -->"
_GENERATED_END = "<!-- videomemo:generated:end -->"
_SOURCE_MARKER = "<!-- videomemo:source:{source_id} -->"
_HEAD_SCAN_BYTES = 8 * 1024
_ASSET_GENERATION_NAME = re.compile(r"v-[0-9a-f]{32}\Z")
_ASSET_STAGING_NAME = re.compile(r"\.v-[0-9a-f]{32}\.[0-9a-f]{32}\.tmp\Z")


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


def _remove_tree(path: Path) -> None:
    """Remove a staged/backup path whether it is a directory or a file."""
    try:
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()
    except FileNotFoundError:
        pass


def _stage_frames(source_frames: list[Path], generation_dir: Path) -> Path:
    """Build one immutable attachment generation beside its final path."""
    parent = generation_dir.parent
    parent.mkdir(parents=True, exist_ok=True)
    staged = parent / f".{generation_dir.name}.{uuid.uuid4().hex}.tmp"
    staged.mkdir()
    try:
        for frame in source_frames:
            shutil.copy2(frame, staged / frame.name)
        return staged
    except BaseException:
        try:
            _remove_tree(staged)
        except OSError:
            pass
        raise


def _publish_frames(staged: Path, generation_dir: Path) -> None:
    """Publish a complete, uniquely named generation without touching the old one."""
    os.replace(staged, generation_dir)


def _note_matches(path: Path, expected: str) -> bool | None:
    """Return whether the note is committed, or None when it cannot be inspected."""
    try:
        return path.read_text(encoding="utf-8") == expected
    except FileNotFoundError:
        return False
    except OSError:
        # An uncertain result must retain the new generation.  An orphan is
        # harmless, while deleting a generation referenced by a committed note
        # would corrupt the export.
        return None


def _cleanup_obsolete_frames(
    asset_root: Path,
    keep_entries: set[str] | None,
) -> None:
    """Best-effort cleanup after the note has atomically selected a generation."""
    if keep_entries is None:
        # A report without frames does not establish a new attachment state.
        # Keep existing/legacy files because user annotations or older notes
        # may still reference them.
        return
    try:
        entries = list(asset_root.iterdir())
    except FileNotFoundError:
        return
    except OSError:
        return
    for entry in entries:
        if entry.name in keep_entries:
            continue
        is_generation = _ASSET_GENERATION_NAME.fullmatch(entry.name) is not None
        is_staging = _ASSET_STAGING_NAME.fullmatch(entry.name) is not None
        is_legacy_frame = entry.match("frame_*.jpg")
        if not (is_generation or is_staging or is_legacy_frame):
            continue
        try:
            _remove_tree(entry)
        except OSError:
            # Cleanup is deliberately post-commit.  Leaving an obsolete or
            # crash-orphaned generation must not turn a valid export into a
            # reported failure.
            pass


def _referenced_asset_entries(
    note_text: str,
    asset_root: Path,
    vault: Path,
) -> set[str]:
    relative_root = asset_root.relative_to(vault).as_posix() + "/"
    referenced: set[str] = set()
    for target in re.findall(r"!\[\[([^\]|#]+)", note_text):
        if not target.startswith(relative_root):
            continue
        first_part = target.removeprefix(relative_root).split("/", 1)[0]
        is_generation = _ASSET_GENERATION_NAME.fullmatch(first_part) is not None
        is_legacy_frame = Path(first_part).match("frame_*.jpg")
        if is_generation or is_legacy_frame:
            referenced.add(first_part)
    return referenced


@contextmanager
def _source_export_lock(destination: Path, source_id: str) -> Iterator[None]:
    """Serialize one source's note and attachment transaction across processes."""
    lock_path = destination / f".videomemo-{source_id}.export.lock"
    lock_handle = lock_path.open("a+b")
    try:
        lock_handle.seek(0)
        if os.name == "nt":
            import msvcrt

            # Export callers should wait rather than fail when two completed
            # tasks target the same source at nearly the same time.  LK_LOCK
            # itself gives up after a small fixed retry count, so poll the
            # non-blocking form until the owning process closes its handle.
            while True:
                lock_handle.seek(0)
                try:
                    msvcrt.locking(lock_handle.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    time.sleep(0.05)
        else:
            import fcntl

            fcntl.flock(lock_handle.fileno(), fcntl.LOCK_EX)
        lock_handle.seek(0)
        lock_handle.truncate()
        lock_handle.write(f"{os.getpid()}\n".encode("ascii"))
        lock_handle.flush()
        yield
    finally:
        lock_handle.close()


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
    with _source_export_lock(destination, source_id):
        return _export_to_vault_locked(
            summary_path,
            metadata,
            vault,
            destination,
            source_id,
            note_title=note_title,
        )


def _export_to_vault_locked(
    summary_path: Path,
    metadata: DownloadResult,
    vault: Path,
    destination: Path,
    source_id: str,
    *,
    note_title: str | None,
) -> Path:
    name_source = note_title.strip() if note_title and note_title.strip() else metadata.title
    note_stem = _safe_name(name_source)
    preferred_note_path = destination / f"{note_stem}.md"
    note_path = _note_for_source(destination, preferred_note_path, source_id)

    frame_links: list[str] = []
    source_frames = sorted(summary_path.parent.glob("frames/frame_*.jpg"))
    asset_root = destination / "assets" / source_id
    generation_dir: Path | None = None
    staged_frames: Path | None = None
    if source_frames:
        # The source id keeps the root stable across title changes.  Each export
        # writes a new immutable child directory so the old note can continue
        # to reference the old frames until its atomic replace commits.
        generation_dir = asset_root / f"v-{uuid.uuid4().hex}"
        for frame in source_frames:
            copied = generation_dir / frame.name
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
    legacy_backup_path: Path | None = None
    needs_legacy_backup = False
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
            needs_legacy_backup = True
    temporary = note_path.with_name(f".{note_path.name}.{uuid.uuid4().hex}.tmp")
    generation_published = False
    try:
        temporary.write_text(final_text, encoding="utf-8")
        if source_frames and generation_dir is not None:
            staged_frames = _stage_frames(source_frames, generation_dir)
            _publish_frames(staged_frames, generation_dir)
            staged_frames = None
            generation_published = True
        if needs_legacy_backup:
            stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
            legacy_backup_path = note_path.with_name(
                f"{note_path.stem}.backup-{stamp}.md"
            )
            shutil.copy2(note_path, legacy_backup_path)
        temporary.replace(note_path)
    except BaseException:
        commit_state = _note_matches(note_path, final_text)
        if generation_published and generation_dir is not None:
            # Delete only when the old note can be positively identified.  If
            # inspection fails, retaining an unreferenced generation is safer
            # than deleting one that an already-committed note may reference.
            if commit_state is False:
                try:
                    _remove_tree(generation_dir)
                except OSError:
                    pass
        if legacy_backup_path is not None and commit_state is False:
            try:
                legacy_backup_path.unlink(missing_ok=True)
            except OSError:
                pass
        raise
    finally:
        try:
            temporary.unlink(missing_ok=True)
        except OSError:
            pass
        if staged_frames is not None:
            try:
                _remove_tree(staged_frames)
            except OSError:
                pass
    # The note is the sole commit point.  Cleanup happens only after its atomic
    # replacement, so a crash before this line can leave at worst an orphaned
    # generation while the old note and old frames remain a coherent pair.
    keep_entries: set[str] | None = None
    if generation_dir is not None:
        keep_entries = _referenced_asset_entries(final_text, asset_root, vault)
        keep_entries.add(generation_dir.name)
    _cleanup_obsolete_frames(asset_root, keep_entries)
    return note_path
