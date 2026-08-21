"""End-to-end: URL -> download -> ASR -> frames -> AI summary."""

from __future__ import annotations

import argparse
import itertools
import json
import os
import re
import shutil
import sys
import uuid
from contextlib import ExitStack, contextmanager
from datetime import datetime
from pathlib import Path
from typing import Callable, Iterator
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import url2pathname

from cancellation import CancellationRequested, CancellationSignal, check_cancelled
from download import (
    BrowserCookieError,
    DownloadResult,
    VideoMetadata,
    _yt_dlp_command,
    cleanup_media_files,
    download,
    import_local_media,
    load_download_result,
    probe,
)
from frames import extract_frames
from llm_config import LLMConfig, default_model, resolve_llm_config
from obsidian_export import export_to_vault
from project_paths import project_root
from subtitles import transcript_from_vtt
from summarize import summarize
from transcribe import Transcript, save_transcript, transcribe
from version import VERSION

ProgressCb = Callable[[str, float], None]
JSON_EVENT_PREFIX = "@@VIDEOMEMO@@"
REGENERATE_LOCK_NAME = ".regenerate.lock"
RUN_RECOVERY_NAME = ".run.recovery"
RUN_RECOVERY_COMMITTED_PREFIX = ".run.recovery.committed."
RUN_RECOVERY_PATHS = ("info.json", "transcript.txt", "summary.md", "frames")


class _RunBusyError(RuntimeError):
    """Raised when another process owns a run directory's operation lock."""


def _emit_json_event(event: dict) -> None:
    print(
        JSON_EVENT_PREFIX + json.dumps(event, ensure_ascii=False),
        flush=True,
    )


def _json_progress(message: str, fraction: float) -> None:
    if message.startswith("OBSIDIAN_NOTE="):
        _emit_json_event(
            {
                "type": "artifact",
                "kind": "obsidian_note",
                "path": message.partition("=")[2],
            }
        )
        return
    _emit_json_event(
        {
            "type": "progress",
            "message": message,
            "progress": max(0.0, min(1.0, float(fraction))),
        }
    )


def _work_dir(base: Path, title_hint: str = "run") -> Path:
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    safe = re.sub(r"[^\w\u4e00-\u9fff\-]+", "_", title_hint)
    safe = re.sub(r"_+", "_", safe).strip("_")[:60] or "run"
    base.mkdir(parents=True, exist_ok=True)

    for index in itertools.count(1):
        suffix = "" if index == 1 else f"_{index}"
        candidate = base / f"{ts}_{safe}{suffix}"
        try:
            candidate.mkdir(exist_ok=False)
            return candidate
        except FileExistsError:
            continue


def _positive_int(value: str) -> int:
    try:
        parsed = int(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("必须是整数") from exc
    if parsed < 1:
        raise argparse.ArgumentTypeError("必须大于 0")
    return parsed


def local_media_path(source: str) -> Path | None:
    """Return the file path when source points at an existing local media file."""
    text = source.strip().strip('"').strip("'")
    if not text:
        return None
    if text.lower().startswith("file://"):
        candidate = Path(url2pathname(urlsplit(text).path))
    elif re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*://", text):
        return None
    else:
        candidate = Path(text)
    candidate = candidate.expanduser()
    return candidate.resolve() if candidate.is_file() else None


def _preflight(
    url: str,
    max_frames: int,
    llm_model: str,
    api_key: str | None = None,
    api_base_url: str | None = None,
    *,
    require_downloader: bool = True,
) -> LLMConfig:
    if not url.strip():
        raise ValueError("视频链接不能为空")
    if max_frames < 1:
        raise ValueError("关键帧数量必须大于 0")
    if not llm_model.strip():
        raise ValueError("AI 模型名不能为空")
    if require_downloader:
        try:
            _yt_dlp_command()
        except FileNotFoundError as exc:
            raise RuntimeError("未找到 yt-dlp，请先安装并加入 PATH") from exc
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("未找到 ffmpeg，请先安装并加入 PATH")
    return resolve_llm_config(
        llm_model,
        api_key=api_key,
        base_url=api_base_url,
    )


def _probe_video(
    url: str,
    *,
    cookies_from_browser: str | None,
    cookies_file: Path | None,
    progress: ProgressCb,
    language: str | None = None,
    cancel_event: CancellationSignal | None = None,
) -> tuple[VideoMetadata, str | None]:
    check_cancelled(cancel_event)
    probe_kwargs = {"preferred_language": language} if language else {}
    if cancel_event is not None:
        probe_kwargs["cancel_event"] = cancel_event
    if not cookies_from_browser or cookies_file:
        return (
            probe(
                url,
                cookies_from_browser=cookies_from_browser,
                cookies_file=cookies_file,
                **probe_kwargs,
            ),
            cookies_from_browser,
        )

    try:
        metadata = probe(url, **probe_kwargs)
    except CancellationRequested:
        raise
    except Exception as anonymous_error:
        progress("  匿名访问失败，尝试读取浏览器 Cookie…", 0.03)
        try:
            metadata = probe(
                url,
                cookies_from_browser=cookies_from_browser,
                **probe_kwargs,
            )
        except BrowserCookieError as cookie_error:
            raise BrowserCookieError(
                f"{cookie_error}\n\n匿名访问也未成功:\n{str(anonymous_error)[-1200:]}"
            ) from cookie_error
        return metadata, cookies_from_browser

    progress("  该视频无需登录，已跳过浏览器 Cookie", 0.03)
    return metadata, None


def _url_identity(url: str) -> str:
    parsed = urlsplit(url.strip())
    query = urlencode(
        sorted(
            (key, value)
            for key, value in parse_qsl(parsed.query, keep_blank_values=True)
            if key not in {"spm_id_from", "from_spmid", "vd_source"}
            and not key.startswith("utm_")
        )
    )
    return urlunsplit(
        (
            parsed.scheme.lower(),
            parsed.netloc.lower(),
            parsed.path.rstrip("/"),
            query,
            "",
        )
    )


def _find_reusable_download(
    out_root: Path,
    webpage_url: str,
    *,
    local_source: Path | None = None,
    whisper_model: str | None = None,
    language: str | None = None,
    require_vision: bool = False,
    max_frames: int = 8,
) -> tuple[Path, DownloadResult] | None:
    if not out_root.is_dir():
        return None
    target_url = _url_identity(webpage_url)
    info_files = sorted(
        out_root.glob("*/info.json"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    for info_path in info_files:
        work_dir = info_path.parent
        result = _matching_reusable_download(
            work_dir,
            target_url,
            local_source=local_source,
            whisper_model=whisper_model,
            language=language,
            require_vision=require_vision,
            max_frames=max_frames,
        )
        if result is None:
            continue
        return work_dir, result
    return None


def _matching_reusable_download(
    work_dir: Path,
    target_url: str,
    *,
    local_source: Path | None,
    whisper_model: str | None,
    language: str | None,
    require_vision: bool,
    max_frames: int,
) -> DownloadResult | None:
    info = _read_run_info(work_dir)
    if not _run_is_complete(work_dir, info):
        return None
    result = load_download_result(work_dir)
    if not result or _url_identity(result.webpage_url) != target_url:
        return None
    if local_source and not _local_source_matches(info, local_source):
        return None
    if whisper_model is not None and not _transcript_cache_compatible(
        work_dir,
        info,
        whisper_model=whisper_model,
        language=language,
    ):
        if not result.audio_path:
            return None
    if require_vision and not _vision_cache_compatible(
        work_dir,
        info,
        result,
        max_frames=max_frames,
    ):
        return None
    return result


def _claim_reusable_download(
    out_root: Path,
    webpage_url: str,
    *,
    local_source: Path | None = None,
    whisper_model: str | None = None,
    language: str | None = None,
    require_vision: bool = False,
    max_frames: int = 8,
) -> tuple[Path, DownloadResult, _RunOperationLock] | None:
    """Find, recover, snapshot and lock a reusable run until caller release."""
    if not out_root.is_dir():
        return None
    target_url = _url_identity(webpage_url)
    try:
        info_files = sorted(
            out_root.glob("*/info.json"),
            key=lambda path: path.stat().st_mtime,
            reverse=True,
        )
    except OSError:
        return None
    for info_path in info_files:
        work_dir = info_path.parent
        lock = _RunOperationLock(work_dir)
        try:
            lock.acquire()
        except (_RunBusyError, FileNotFoundError):
            continue
        try:
            _recover_abandoned_run(work_dir)
            result = _matching_reusable_download(
                work_dir,
                target_url,
                local_source=local_source,
                whisper_model=whisper_model,
                language=language,
                require_vision=require_vision,
                max_frames=max_frames,
            )
            if result is None:
                lock.release()
                continue
            _prepare_run_recovery(work_dir)
            _update_run_info(work_dir, "run_status", "running")
            return work_dir, result, lock
        except BaseException:
            lock.release()
            raise
    return None


def _read_run_info(work_dir: Path) -> dict:
    try:
        value = json.loads((work_dir / "info.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _run_is_complete(work_dir: Path, info: dict) -> bool:
    """Only reuse runs whose final report was written successfully.

    Older output directories have no status field, so a non-empty report is
    accepted as the legacy completion marker. New runs use an explicit status
    to keep an in-progress directory out of cache discovery.
    """
    has_summary = _has_summary(work_dir)
    status = info.get("run_status")
    if status == "complete":
        return has_summary
    return status is None and has_summary


def _has_summary(work_dir: Path) -> bool:
    summary_path = work_dir / "summary.md"
    try:
        return summary_path.is_file() and summary_path.stat().st_size > 0
    except OSError:
        return False


def _update_run_info(work_dir: Path, key: str, value: object) -> None:
    info_path = work_dir / "info.json"
    info = _read_run_info(work_dir)
    if not info:
        return
    info[key] = value
    temporary = info_path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(info, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    temporary.replace(info_path)


def _begin_run_status_recovery(
    state: dict[str, object] | None,
    work_dir: Path,
    *,
    restore_complete: bool = False,
) -> None:
    """Remember the status that must be restored if this attempt aborts."""
    if state is None or "work_dir" in state:
        return
    info = _read_run_info(work_dir)
    state.update(
        {
            "work_dir": work_dir,
            "previous_status": info.get("run_status"),
            "restore_complete": restore_complete or _run_is_complete(work_dir, info),
        }
    )


def _mark_report_committed(state: dict[str, object] | None, work_dir: Path) -> None:
    if state is not None and state.get("work_dir") == work_dir:
        state["report_committed"] = True


def _restore_run_status_after_error(
    state: dict[str, object],
    error: BaseException,
) -> None:
    """Restore reused artifacts and never leave a caught failure as running."""
    work_dir = state.get("work_dir")
    if not isinstance(work_dir, Path):
        return
    recovery_error: BaseException | None = None
    try:
        _restore_run_recovery(work_dir)
    except BaseException as caught:
        recovery_error = caught
    # A report may have been committed just before a progress/export callback
    # raised. Preserve that valid cache even though the outer operation failed.
    current_info = _read_run_info(work_dir)
    if _run_is_complete(work_dir, current_info):
        restored_status = "complete"
    elif recovery_error is None and state.get("report_committed"):
        restored_status = "complete"
    elif recovery_error is None and state.get("restore_complete"):
        restored_status = "complete"
    elif isinstance(error, (CancellationRequested, KeyboardInterrupt)):
        restored_status = "cancelled"
    else:
        restored_status = "failed"
    try:
        _update_run_info(work_dir, "run_status", restored_status)
    except BaseException as caught:
        if recovery_error is None:
            recovery_error = caught
    if recovery_error is not None:
        try:
            error.add_note(f"运行目录恢复失败: {recovery_error}")
        except AttributeError:
            pass


class _RunOperationLock:
    """Crash-safe, non-blocking OS lock for one mutable run directory."""

    def __init__(self, work_dir: Path) -> None:
        self.work_dir = work_dir
        self.handle = None

    def acquire(self) -> None:
        if self.handle is not None:
            return
        if not self.work_dir.is_dir():
            raise RuntimeError(f"运行目录不存在: {self.work_dir}")
        lock_path = self.work_dir / REGENERATE_LOCK_NAME
        handle = lock_path.open("a+b")
        try:
            try:
                # Windows byte-range locks need byte 0 to exist. Initialization
                # can itself collide with an older owner that temporarily
                # truncated the marker, so translate that race as "busy" too.
                handle.seek(0, os.SEEK_END)
                if handle.tell() == 0:
                    handle.write(b"\0")
                    handle.flush()
                handle.seek(0)
                if os.name == "nt":
                    import msvcrt

                    msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl

                    fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise _RunBusyError(
                    f"该运行目录正在处理中，请等待当前任务完成: {self.work_dir}"
                ) from error
            handle.seek(0)
            handle.write(b"\0")
            handle.seek(1)
            handle.truncate()
            handle.write(f"{os.getpid()}\n".encode("ascii"))
            handle.flush()
        except BaseException:
            handle.close()
            raise
        self.handle = handle

    def release(self) -> None:
        handle, self.handle = self.handle, None
        if handle is not None:
            # Closing releases msvcrt.locking/flock. Do not unlink the marker:
            # another process may already have opened the same inode.
            handle.close()


def _remove_recovery_path(path: Path) -> None:
    if path.is_dir() and not path.is_symlink():
        shutil.rmtree(path)
    else:
        path.unlink(missing_ok=True)


def _restore_recovery_file(snapshot: Path, live: Path) -> None:
    if not snapshot.is_file():
        live.unlink(missing_ok=True)
        return
    temporary = live.with_name(f".{live.name}.{uuid.uuid4().hex}.restore")
    try:
        shutil.copy2(snapshot, temporary)
        os.replace(temporary, live)
    finally:
        temporary.unlink(missing_ok=True)


def _restore_recovery_directory(snapshot: Path, live: Path) -> None:
    if not snapshot.is_dir():
        _remove_recovery_path(live)
        return
    staged = live.with_name(f".{live.name}.{uuid.uuid4().hex}.restore")
    discarded: Path | None = None
    try:
        shutil.copytree(snapshot, staged)
        if live.exists():
            discarded = live.with_name(f".{live.name}.{uuid.uuid4().hex}.discard")
            os.replace(live, discarded)
        try:
            os.replace(staged, live)
        except BaseException:
            if discarded is not None and discarded.exists() and not live.exists():
                os.replace(discarded, live)
                discarded = None
            raise
    finally:
        if staged.exists():
            _remove_recovery_path(staged)
        if discarded is not None and discarded.exists():
            _remove_recovery_path(discarded)


def _discard_run_recovery(work_dir: Path, recovery: Path) -> None:
    """Atomically retire a snapshot before best-effort recursive cleanup."""
    committed = work_dir / f"{RUN_RECOVERY_COMMITTED_PREFIX}{uuid.uuid4().hex}"
    os.replace(recovery, committed)
    try:
        _remove_recovery_path(committed)
    except OSError:
        # A partially deleted tombstone is never replayed as a recovery source.
        # The next owner will retry its cleanup without touching live artifacts.
        pass


def _restore_run_recovery(work_dir: Path) -> bool:
    """Restore an interrupted cache mutation; return whether one was found."""
    recovery = work_dir / RUN_RECOVERY_NAME
    if not recovery.exists():
        return False
    if not recovery.is_dir():
        raise RuntimeError(f"运行恢复路径不是目录: {recovery}")
    if (recovery / ".committed").is_file():
        _discard_run_recovery(work_dir, recovery)
        return True

    # ``summary.md`` is atomically replaced before the status is set complete.
    # If termination lands just before the recovery directory is renamed to its
    # committed tombstone, the complete status proves the new generation won.
    current_info = _read_run_info(work_dir)
    if current_info.get("run_status") == "complete" and _run_is_complete(
        work_dir, current_info
    ):
        _discard_run_recovery(work_dir, recovery)
        return True

    # Restore info last so a crash during recovery cannot expose a complete
    # status before transcript/report/frames are back to the same generation.
    for name in ("transcript.txt", "summary.md"):
        _restore_recovery_file(recovery / name, work_dir / name)
    _restore_recovery_directory(recovery / "frames", work_dir / "frames")
    _restore_recovery_file(recovery / "info.json", work_dir / "info.json")
    _discard_run_recovery(work_dir, recovery)
    return True


def _repair_abandoned_run_status(work_dir: Path) -> None:
    info = _read_run_info(work_dir)
    if info.get("run_status") != "running":
        return
    has_summary = _has_summary(work_dir)
    _update_run_info(work_dir, "run_status", "complete" if has_summary else "failed")


def _recover_abandoned_run(work_dir: Path) -> None:
    """Recover state left after a process was terminated without ``finally``."""
    _restore_run_recovery(work_dir)
    for stale in work_dir.glob(f"{RUN_RECOVERY_NAME}.*.tmp"):
        try:
            _remove_recovery_path(stale)
        except OSError:
            pass
    for committed in work_dir.glob(f"{RUN_RECOVERY_COMMITTED_PREFIX}*"):
        try:
            _remove_recovery_path(committed)
        except OSError:
            pass
    _repair_abandoned_run_status(work_dir)


def _prepare_run_recovery(work_dir: Path) -> None:
    """Snapshot mutable completed artifacts before reusing their directory."""
    recovery = work_dir / RUN_RECOVERY_NAME
    if recovery.exists():
        raise RuntimeError(f"运行目录仍有未处理的恢复快照: {recovery}")
    staged = work_dir / f"{RUN_RECOVERY_NAME}.{uuid.uuid4().hex}.tmp"
    staged.mkdir()
    try:
        for name in RUN_RECOVERY_PATHS:
            source = work_dir / name
            target = staged / name
            if source.is_dir() and not source.is_symlink():
                shutil.copytree(source, target)
            elif source.is_file():
                shutil.copy2(source, target)
        os.replace(staged, recovery)
    finally:
        if staged.exists():
            _remove_recovery_path(staged)


def _commit_run_recovery(work_dir: Path) -> None:
    """Commit reused artifacts before optional exports or cleanup callbacks."""
    recovery = work_dir / RUN_RECOVERY_NAME
    if not recovery.is_dir():
        return
    # Retiring the snapshot is the commit point. A rename failure reaches the
    # outer wrapper and restores the previous generation.
    _discard_run_recovery(work_dir, recovery)


@contextmanager
def _regenerate_lock(work_dir: Path) -> Iterator[None]:
    """Hold the shared per-run operation lock for report regeneration."""
    lock = _RunOperationLock(work_dir)
    try:
        lock.acquire()
    except _RunBusyError as error:
        raise RuntimeError(
            f"该运行目录正在重新生成或处理，请等待当前任务完成: {work_dir}"
        ) from error
    try:
        yield
    finally:
        lock.release()


def _language_matches(stored: object, requested: str | None) -> bool:
    if requested is None:
        return True
    if not isinstance(stored, str) or not stored.strip():
        return False
    left = stored.strip().lower().replace("_", "-")
    right = requested.strip().lower().replace("_", "-")
    return (
        left == right
        or left.startswith(right + "-")
        or right.startswith(left + "-")
    )


def _transcript_cache_compatible(
    work_dir: Path,
    info: dict,
    *,
    whisper_model: str,
    language: str | None,
) -> bool:
    transcript_path = work_dir / "transcript.txt"
    if not transcript_path.is_file() or transcript_path.stat().st_size == 0:
        return False
    metadata = info.get("transcript")
    if not isinstance(metadata, dict):
        return language is None and whisper_model == "base"
    source = metadata.get("source")
    if source == "platform":
        return _language_matches(metadata.get("language"), language)
    if source != "whisper" or metadata.get("model") != whisper_model:
        return False
    requested_language = metadata.get("requested_language")
    actual_language = metadata.get("language")
    return _language_matches(requested_language or actual_language, language)


def _local_source_matches(info: dict, source: Path) -> bool:
    fingerprint = info.get("source_fingerprint")
    if not isinstance(fingerprint, dict):
        return False
    try:
        stat = source.stat()
        return (
            int(fingerprint.get("size")) == stat.st_size
            and int(fingerprint.get("mtime_ns")) == stat.st_mtime_ns
        )
    except (OSError, TypeError, ValueError):
        return False


def _vision_cache_compatible(
    work_dir: Path,
    info: dict,
    result: DownloadResult,
    *,
    max_frames: int,
) -> bool:
    has_video = info.get("media_has_video")
    if not isinstance(has_video, bool):
        has_video = bool(info.get("video_path"))
    if not has_video:
        return True
    if result.video_path and result.video_path.is_file():
        return True
    frames = list((work_dir / "frames").glob("frame_*.jpg"))
    if not frames:
        return False
    vision = info.get("vision")
    if isinstance(vision, dict):
        try:
            return int(vision.get("requested_max_frames")) >= max_frames
        except (TypeError, ValueError):
            return False
    return len(frames) >= max_frames


def _write_reports(
    work: Path,
    dl: DownloadResult,
    summary: str,
) -> Path:
    header = (
        f"# {dl.title}\n\n"
        f"- 链接: {dl.webpage_url}\n"
        f"- 作者: {dl.uploader or '未知'}\n"
        f"- 生成时间: {datetime.now().isoformat(timespec='seconds')}\n\n"
        "---\n\n"
    )
    summary_path = work / "summary.md"
    temporary = summary_path.with_suffix(".md.tmp")
    temporary.write_text(header + summary + "\n", encoding="utf-8")
    temporary.replace(summary_path)
    return summary_path


def regenerate_report(
    work_dir: Path,
    *,
    llm_model: str | None = None,
    api_key: str | None = None,
    api_base_url: str | None = None,
    obsidian_vault: Path | None = None,
    obsidian_folder: str = "",
    on_progress: ProgressCb | None = None,
    cancel_event: CancellationSignal | None = None,
) -> Path:
    status_recovery: dict[str, object] = {}
    with _regenerate_lock(work_dir):
        _recover_abandoned_run(work_dir)
        info = _read_run_info(work_dir)
        restore_complete = _run_is_complete(work_dir, info)
        _begin_run_status_recovery(
            status_recovery,
            work_dir,
            restore_complete=restore_complete,
        )
        # A failed directory may still contain an older report. Snapshot every
        # regeneration attempt so failure or taskkill cannot promote that stale
        # file to the current attempt's result.
        _prepare_run_recovery(work_dir)
        try:
            return _regenerate_report(
                work_dir,
                llm_model=llm_model,
                api_key=api_key,
                api_base_url=api_base_url,
                obsidian_vault=obsidian_vault,
                obsidian_folder=obsidian_folder,
                on_progress=on_progress,
                cancel_event=cancel_event,
                _status_recovery=status_recovery,
            )
        except BaseException as error:
            try:
                _restore_run_status_after_error(status_recovery, error)
            except BaseException as restore_error:
                try:
                    error.add_note(f"运行目录恢复失败: {restore_error}")
                except AttributeError:
                    pass
            raise


def _regenerate_report(
    work_dir: Path,
    *,
    llm_model: str | None = None,
    api_key: str | None = None,
    api_base_url: str | None = None,
    obsidian_vault: Path | None = None,
    obsidian_folder: str = "",
    on_progress: ProgressCb | None = None,
    cancel_event: CancellationSignal | None = None,
    _status_recovery: dict[str, object] | None = None,
) -> Path:
    check_cancelled(cancel_event)
    dl = load_download_result(work_dir)
    if not dl:
        raise RuntimeError(f"运行目录缺少完整的下载信息: {work_dir}")
    transcript_path = work_dir / "transcript.txt"
    if not transcript_path.is_file() or transcript_path.stat().st_size == 0:
        raise RuntimeError(f"运行目录缺少转写文件: {transcript_path}")
    _update_run_info(work_dir, "run_status", "running")

    model = (llm_model or default_model()).strip()
    config = resolve_llm_config(model, api_key=api_key, base_url=api_base_url)
    check_cancelled(cancel_event)
    transcript = Transcript(
        language=None,
        text=transcript_path.read_text(encoding="utf-8"),
        segments=[],
    )
    frames = sorted((work_dir / "frames").glob("frame_*.jpg"))

    def progress(message: str, fraction: float) -> None:
        print(message, flush=True)
        if on_progress:
            on_progress(message, fraction)

    progress("重新生成详细学习报告", 0.0)
    summary = summarize(
        title=dl.title,
        url=dl.webpage_url,
        uploader=dl.uploader,
        description=dl.description,
        transcript=transcript.text,
        frame_paths=frames,
        model=model,
        api_key=config.api_key,
        base_url=config.base_url,
        on_progress=progress,
        cancel_event=cancel_event,
    )
    summary_path = _write_reports(work_dir, dl, summary.body)
    # ``run_status`` tracks whether the reusable local report is complete.
    # Optional exports may still fail and surface to the caller, but must not
    # poison a report that was already committed successfully.
    _commit_run_recovery(work_dir)
    _mark_report_committed(_status_recovery, work_dir)
    _update_run_info(work_dir, "run_status", "complete")
    if obsidian_vault:
        note_path = export_to_vault(
            summary_path,
            dl,
            obsidian_vault,
            folder=obsidian_folder,
            note_title=summary.note_title,
            topic=summary.topic,
        )
        progress(f"OBSIDIAN_NOTE={note_path}", 0.98)
    progress(f"报告已保存: {summary_path}", 1.0)
    return summary_path


def run(
    url: str,
    *,
    out_root: Path,
    whisper_model: str = "base",
    language: str | None = None,
    max_frames: int = 8,
    no_vision: bool = False,
    llm_model: str | None = None,
    api_key: str | None = None,
    api_base_url: str | None = None,
    cookies_from_browser: str | None = None,
    cookies_file: Path | None = None,
    cleanup_media: bool = False,
    obsidian_vault: Path | None = None,
    obsidian_folder: str = "",
    on_progress: ProgressCb | None = None,
    cancel_event: CancellationSignal | None = None,
    _status_recovery: dict[str, object] | None = None,
) -> Path:
    status_recovery: dict[str, object] = {}
    operation_stack = ExitStack()
    try:
        return _run(
            url,
            out_root=out_root,
            whisper_model=whisper_model,
            language=language,
            max_frames=max_frames,
            no_vision=no_vision,
            llm_model=llm_model,
            api_key=api_key,
            api_base_url=api_base_url,
            cookies_from_browser=cookies_from_browser,
            cookies_file=cookies_file,
            cleanup_media=cleanup_media,
            obsidian_vault=obsidian_vault,
            obsidian_folder=obsidian_folder,
            on_progress=on_progress,
            cancel_event=cancel_event,
            _status_recovery=status_recovery,
            _operation_stack=operation_stack,
        )
    except BaseException as error:
        try:
            _restore_run_status_after_error(status_recovery, error)
        except BaseException as restore_error:
            # Recovery must never hide the original pipeline exception. Keep a
            # diagnostic note when the runtime supports it.
            try:
                error.add_note(f"运行目录恢复失败: {restore_error}")
            except AttributeError:
                pass
        raise
    finally:
        operation_stack.close()


def _run(*args, _operation_stack: ExitStack | None = None, **kwargs) -> Path:
    """Run one pipeline attempt and release its operation lock on direct calls."""
    own_stack = _operation_stack is None
    stack = _operation_stack or ExitStack()
    try:
        return _run_impl(*args, _operation_stack=stack, **kwargs)
    finally:
        if own_stack:
            stack.close()


def _run_impl(
    url: str,
    *,
    out_root: Path,
    whisper_model: str = "base",
    language: str | None = None,
    max_frames: int = 8,
    no_vision: bool = False,
    llm_model: str | None = None,
    api_key: str | None = None,
    api_base_url: str | None = None,
    cookies_from_browser: str | None = None,
    cookies_file: Path | None = None,
    cleanup_media: bool = False,
    obsidian_vault: Path | None = None,
    obsidian_folder: str = "",
    on_progress: ProgressCb | None = None,
    cancel_event: CancellationSignal | None = None,
    _status_recovery: dict[str, object] | None = None,
    _operation_stack: ExitStack | None = None,
) -> Path:
    if _operation_stack is None:
        _operation_stack = ExitStack()

    def acquire_operation_lock(work_dir: Path) -> _RunOperationLock:
        lock = _RunOperationLock(work_dir)
        lock.acquire()
        _operation_stack.callback(lock.release)
        return lock

    def progress(msg: str, pct: float) -> None:
        print(msg)
        if on_progress:
            on_progress(msg, pct)

    check_cancelled(cancel_event)
    url = url.strip()
    out_root = out_root.expanduser().resolve()
    local_source = local_media_path(url)
    llm_model = (llm_model or default_model()).strip()
    llm_config = _preflight(
        url,
        max_frames,
        llm_model,
        api_key=api_key,
        api_base_url=api_base_url,
        require_downloader=local_source is None,
    )
    check_cancelled(cancel_event)

    if local_source:
        progress(f"[1/4] 使用本地文件: {local_source}", 0.02)
        reusable = _claim_reusable_download(
            out_root,
            local_source.as_uri(),
            local_source=local_source,
            whisper_model=whisper_model,
            language=language,
            require_vision=not no_vision,
            max_frames=max_frames,
        )
        if reusable:
            work, dl, lock = reusable
            _operation_stack.callback(lock.release)
            _begin_run_status_recovery(
                _status_recovery,
                work,
                restore_complete=True,
            )
            progress(f"[1/4] 复用已有处理结果\n  工作目录: {work}", 0.25)
        else:
            work = _work_dir(out_root, local_source.stem)
            acquire_operation_lock(work)
            _begin_run_status_recovery(_status_recovery, work)
            progress(f"[1/4] 提取音轨…\n  工作目录: {work}", 0.05)
            import_kwargs = (
                {"cancel_event": cancel_event} if cancel_event is not None else {}
            )
            dl = import_local_media(local_source, work, **import_kwargs)
    else:
        progress("[1/4] 获取视频信息…", 0.02)
        metadata, effective_browser_cookies = _probe_video(
            url,
            cookies_from_browser=cookies_from_browser,
            cookies_file=cookies_file,
            progress=progress,
            language=language,
            cancel_event=cancel_event,
        )
        reusable = _claim_reusable_download(
            out_root,
            metadata.webpage_url,
            whisper_model=whisper_model,
            language=language,
            require_vision=not no_vision,
            max_frames=max_frames,
        )
        if reusable:
            work, dl, lock = reusable
            _operation_stack.callback(lock.release)
            _begin_run_status_recovery(
                _status_recovery,
                work,
                restore_complete=True,
            )
            progress(f"[1/4] 复用已有处理结果\n  工作目录: {work}", 0.25)
        else:
            work = _work_dir(out_root, metadata.title)
            acquire_operation_lock(work)
            _begin_run_status_recovery(_status_recovery, work)
            progress(f"[1/4] 下载视频…\n  工作目录: {work}", 0.05)
            dl = download(
                url,
                work,
                metadata=metadata,
                cookies_from_browser=effective_browser_cookies,
                cookies_file=cookies_file,
                **(
                    {"cancel_event": cancel_event}
                    if cancel_event is not None
                    else {}
                ),
            )
    _begin_run_status_recovery(_status_recovery, work)
    check_cancelled(cancel_event)
    _update_run_info(work, "run_status", "running")
    progress(f"  标题: {dl.title}", 0.25)
    if dl.duration:
        progress(f"  时长: {dl.duration:.0f}s", 0.28)

    transcript_path = work / "transcript.txt"
    run_info = _read_run_info(work)
    if _transcript_cache_compatible(
        work,
        run_info,
        whisper_model=whisper_model,
        language=language,
    ):
        check_cancelled(cancel_event)
        progress("[2/4] 复用已有语音转写", 0.55)
        tr = Transcript(
            language=language,
            text=transcript_path.read_text(encoding="utf-8"),
            segments=[],
        )
    elif (
        dl.subtitle_path
        and dl.subtitle_path.is_file()
        and _language_matches(dl.subtitle_language, language)
    ):
        progress(
            f"[2/4] 使用平台字幕 ({dl.subtitle_language or '语言未知'})",
            0.42,
        )
        try:
            tr = transcript_from_vtt(
                dl.subtitle_path,
                language=dl.subtitle_language or language,
            )
            save_transcript(tr, transcript_path)
            _update_run_info(
                work,
                "transcript",
                {
                    "source": "platform",
                    "language": tr.language,
                    "requested_language": language,
                },
            )
            progress("  已跳过 Whisper 转写", 0.55)
        except Exception as error:
            progress(f"  平台字幕不可用，回退 Whisper: {error}", 0.32)
            if not dl.audio_path:
                raise RuntimeError(
                    "平台字幕不可用，且运行目录缺少可回退转写的音轨"
                ) from error
            tr = transcribe(
                dl.audio_path,
                model_size=whisper_model,
                language=language,
                on_status=lambda message: progress(f"  {message}", 0.32),
                on_progress=lambda fraction: progress(
                    f"  转写进度: {fraction:.0%}",
                    0.32 + (fraction * 0.22),
                ),
                **(
                    {"cancel_event": cancel_event}
                    if cancel_event is not None
                    else {}
                ),
            )
            save_transcript(tr, transcript_path)
            _update_run_info(
                work,
                "transcript",
                {
                    "source": "whisper",
                    "model": whisper_model,
                    "language": tr.language,
                    "requested_language": language,
                },
            )
    else:
        check_cancelled(cancel_event)
        progress(f"[2/4] 语音转写 (Whisper {whisper_model})…", 0.30)
        if not dl.audio_path:
            raise RuntimeError("运行目录缺少可用音轨，无法进行 Whisper 转写")
        tr = transcribe(
            dl.audio_path,
            model_size=whisper_model,
            language=language,
            on_status=lambda message: progress(f"  {message}", 0.32),
            on_progress=lambda fraction: progress(
                f"  转写进度: {fraction:.0%}",
                0.32 + (fraction * 0.22),
            ),
            **(
                {"cancel_event": cancel_event}
                if cancel_event is not None
                else {}
            ),
        )
        save_transcript(tr, transcript_path)
        _update_run_info(
            work,
            "transcript",
            {
                "source": "whisper",
                "model": whisper_model,
                "language": tr.language,
                "requested_language": language,
            },
        )
    progress(f"  语言: {tr.language or 'auto'} | 字数约: {len(tr.text)}", 0.55)
    check_cancelled(cancel_event)

    frame_paths: list[Path] = []
    vision_capacity: int | None = None
    existing_frames = sorted((work / "frames").glob("frame_*.jpg"))
    if not no_vision and dl.video_path and dl.video_path.exists():
        progress(f"[3/4] 抽取关键帧 (最多 {max_frames} 张)…", 0.60)
        try:
            frame_paths = extract_frames(
                dl.video_path,
                work / "frames",
                max_frames=max_frames,
                duration=dl.duration,
                **(
                    {"cancel_event": cancel_event}
                    if cancel_event is not None
                    else {}
                ),
            )
            if frame_paths:
                vision_capacity = max_frames
            progress(f"  得到 {len(frame_paths)} 帧", 0.70)
        except Exception as e:
            check_cancelled(cancel_event)
            progress(f"  抽帧跳过: {e}", 0.70)
            frame_paths = [path for path in existing_frames if path.is_file()][
                :max_frames
            ]
    elif not no_vision and existing_frames:
        frame_paths = existing_frames[:max_frames]
        existing_vision = run_info.get("vision")
        if isinstance(existing_vision, dict):
            try:
                vision_capacity = int(existing_vision.get("requested_max_frames"))
            except (TypeError, ValueError):
                vision_capacity = len(existing_frames)
        else:
            vision_capacity = len(existing_frames)
        progress(f"[3/4] 复用已有关键帧 ({len(frame_paths)} 张)", 0.70)
    else:
        progress("[3/4] 跳过画面分析", 0.70)
    check_cancelled(cancel_event)
    if not no_vision and frame_paths and vision_capacity is not None:
        _update_run_info(
            work,
            "vision",
            {
                "requested_max_frames": vision_capacity,
                "frame_count": len(frame_paths),
            },
        )

    progress(
        f"[4/4] AI 总结 ({llm_model})…\n  API: {llm_config.base_url}",
        0.75,
    )
    summary = summarize(
        title=dl.title,
        url=dl.webpage_url,
        uploader=dl.uploader,
        description=dl.description,
        transcript=tr.text,
        frame_paths=frame_paths,
        model=llm_model,
        api_key=llm_config.api_key,
        base_url=llm_config.base_url,
        on_progress=lambda message, fraction: progress(
            f"  {message}",
            0.76 + (fraction * 0.18),
        ),
        cancel_event=cancel_event,
    )
    check_cancelled(cancel_event)
    summary_path = _write_reports(work, dl, summary.body)
    _commit_run_recovery(work)
    _mark_report_committed(_status_recovery, work)
    _update_run_info(work, "run_status", "complete")
    if obsidian_vault:
        note_path = export_to_vault(
            summary_path,
            dl,
            obsidian_vault,
            folder=obsidian_folder,
            note_title=summary.note_title,
            topic=summary.topic,
        )
        progress(f"OBSIDIAN_NOTE={note_path}", 0.95)
    if cleanup_media:
        removed_count, removed_bytes = cleanup_media_files(work, dl)
        progress(
            f"已清理 {removed_count} 个媒体文件，释放 "
            f"{removed_bytes / (1024 * 1024):.1f} MB",
            0.96,
        )
    progress("\n" + "=" * 60, 0.97)
    progress("=" * 60, 0.98)
    progress(f"\n详细总结: {summary_path}", 1.0)
    progress(f"转写:   {transcript_path}", 1.0)
    return summary_path


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(
        description="视频链接或本地音视频文件 → (下载) → 听写 → 看画面 → AI 总结",
    )
    p.add_argument(
        "url",
        nargs="?",
        metavar="URL_OR_FILE",
        help="视频链接（YouTube / B站 等 yt-dlp 支持的站点），或本地视频/录音文件路径",
    )
    p.add_argument(
        "--version",
        action="version",
        version=VERSION,
    )
    p.add_argument(
        "--regenerate",
        type=Path,
        metavar="RUN_DIR",
        help="使用已有运行目录中的转写和关键帧重新生成报告",
    )
    p.add_argument(
        "-o",
        "--output",
        type=Path,
        default=project_root() / "output",
        help="输出根目录",
    )
    p.add_argument(
        "-m",
        "--whisper-model",
        default="base",
        choices=["tiny", "base", "small", "medium", "large-v3"],
        help="Whisper 模型大小（越大越准越慢，默认 base）",
    )
    p.add_argument(
        "-l",
        "--language",
        default=None,
        help="语音语言代码，如 zh / en；默认自动检测",
    )
    p.add_argument(
        "--max-frames",
        type=_positive_int,
        default=8,
        help="最多抽取多少帧给视觉模型（默认 8）",
    )
    p.add_argument(
        "--no-vision",
        action="store_true",
        help="只根据音频转写总结，不看画面",
    )
    p.add_argument(
        "--cleanup-media",
        action="store_true",
        help="报告成功后删除输出目录中的下载媒体和 audio.wav",
    )
    p.add_argument(
        "--obsidian-vault",
        type=Path,
        help="将报告和关键帧导出到指定 Obsidian Vault",
    )
    p.add_argument(
        "--obsidian-folder",
        default="",
        help="Vault 内的目标文件夹；留空则根据视频内容自动创建主题子目录（默认留空）",
    )
    p.add_argument(
        "--json-progress",
        action="store_true",
        help=argparse.SUPPRESS,
    )
    p.add_argument(
        "--llm-model",
        default=default_model(),
        help="OpenAI 兼容模型名（默认读取 LLM_MODEL 或 grok-4.5）",
    )
    p.add_argument(
        "--api-base-url",
        default=None,
        help="OpenAI 兼容 API 根地址；默认读取环境变量或本机 Grok 配置",
    )
    cookie_group = p.add_mutually_exclusive_group()
    cookie_group.add_argument(
        "--cookies-from-browser",
        default=None,
        help="从浏览器读取 Cookie，如 chrome / edge / firefox",
    )
    cookie_group.add_argument(
        "--cookies",
        type=Path,
        default=None,
        help="cookies.txt 路径",
    )
    args = p.parse_args(argv)

    if bool(args.url) == bool(args.regenerate):
        p.error("请提供 URL_OR_FILE，或使用 --regenerate RUN_DIR（二者选一）")

    try:
        progress_callback = _json_progress if args.json_progress else None
        if args.regenerate:
            result_path = regenerate_report(
                args.regenerate.expanduser().resolve(),
                llm_model=args.llm_model,
                api_base_url=args.api_base_url,
                obsidian_vault=args.obsidian_vault,
                obsidian_folder=args.obsidian_folder,
                on_progress=progress_callback,
            )
        else:
            result_path = run(
                args.url,
                out_root=args.output,
                whisper_model=args.whisper_model,
                language=args.language,
                max_frames=args.max_frames,
                no_vision=args.no_vision,
                llm_model=args.llm_model,
                api_base_url=args.api_base_url,
                cookies_from_browser=args.cookies_from_browser,
                cookies_file=args.cookies,
                cleanup_media=args.cleanup_media,
                obsidian_vault=args.obsidian_vault,
                obsidian_folder=args.obsidian_folder,
                on_progress=progress_callback,
            )
        if args.json_progress:
            _emit_json_event(
                {
                    "type": "result",
                    "summary_path": str(result_path.resolve()),
                }
            )
    except KeyboardInterrupt:
        print("\n已取消", file=sys.stderr)
        return 130
    except Exception as e:
        print(f"\n错误: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
