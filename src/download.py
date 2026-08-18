"""Download video / audio from a URL via yt-dlp."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import uuid
from dataclasses import dataclass, field
from importlib import import_module
from pathlib import Path
from types import MappingProxyType
from typing import Mapping
from urllib.parse import urlsplit

import fast_download
from cancellation import (
    CancellationRequested,
    CancellationSignal,
    check_cancelled,
    run_command,
)


FORMAT_SELECTOR = "bv*[height<=1080]+ba/bv*+ba/b"

VIDEO_EXTS = {
    ".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv",
    ".m4v", ".ts", ".mpg", ".mpeg", ".wmv", ".3gp",
    ".3g2", ".f4v", ".ogv",
}
AUDIO_EXTS = {
    ".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg",
    ".opus", ".wma", ".amr", ".aiff", ".mka", ".oga",
    ".weba", ".mpga",
}
MEDIA_EXTS = VIDEO_EXTS | AUDIO_EXTS
_TRANSFER_EXTS = {ext.removeprefix(".") for ext in MEDIA_EXTS}
_DIRECT_PROTOCOLS = {"http", "https"}
_FAST_PREFIX = ".fast-download-"


def _yt_dlp_command() -> list[str]:
    """Resolve yt-dlp in this Python environment, then fall back to PATH."""
    try:
        import_module("yt_dlp")
    except ImportError:
        if shutil.which("yt-dlp"):
            return ["yt-dlp"]
        raise FileNotFoundError(
            "无法导入当前 Python 环境中的 yt_dlp，且 PATH 中未找到 yt-dlp"
        )
    return [sys.executable, "-m", "yt_dlp"]


class BrowserCookieError(RuntimeError):
    """Raised when yt-dlp cannot read a browser cookie database."""


@dataclass(frozen=True)
class MediaPart:
    url: str
    ext: str
    protocol: str
    vcodec: str
    acodec: str
    http_headers: Mapping[str, str] = field(default_factory=dict)

    def __post_init__(self) -> None:
        object.__setattr__(
            self,
            "http_headers",
            MappingProxyType(dict(self.http_headers)),
        )


@dataclass(frozen=True)
class MediaTransferPlan:
    video: MediaPart | None = None
    audio: MediaPart | None = None
    progressive: MediaPart | None = None


@dataclass(frozen=True)
class VideoMetadata:
    title: str
    duration: float | None
    webpage_url: str
    description: str
    uploader: str
    subtitle_language: str | None = None
    subtitle_automatic: bool = False
    transfer_plan: MediaTransferPlan | None = field(
        default=None,
        compare=False,
        repr=False,
    )


@dataclass
class DownloadResult:
    video_path: Path | None
    audio_path: Path | None
    title: str
    duration: float | None
    webpage_url: str
    description: str
    uploader: str
    subtitle_path: Path | None = None
    subtitle_language: str | None = None


def load_download_result(work_dir: Path) -> DownloadResult | None:
    """Load a reusable run with either an audio track or saved transcript."""
    info_path = work_dir / "info.json"
    if not info_path.is_file():
        return None
    try:
        info = json.loads(info_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None

    def stored_path(value: str | None) -> Path | None:
        if not value or not isinstance(value, str):
            return None
        try:
            path = Path(value)
        except (TypeError, ValueError):
            return None
        return path if path.is_absolute() else work_dir / path

    audio_path = stored_path(info.get("audio_path"))
    video_path = stored_path(info.get("video_path"))
    subtitle_path = stored_path(info.get("subtitle_path"))
    if audio_path and (
        not audio_path.is_file() or audio_path.stat().st_size < 44
    ):
        audio_path = None
    if video_path and not video_path.is_file():
        video_path = None
    if subtitle_path and not subtitle_path.is_file():
        subtitle_path = None

    transcript_path = work_dir / "transcript.txt"
    if not audio_path and not (
        transcript_path.is_file() and transcript_path.stat().st_size > 0
    ):
        return None

    duration_value = info.get("duration")
    try:
        duration = float(duration_value) if duration_value is not None else None
    except (TypeError, ValueError):
        duration = None
    return DownloadResult(
        video_path=video_path,
        audio_path=audio_path,
        title=info.get("title") or "untitled",
        duration=duration,
        webpage_url=info.get("webpage_url") or "",
        description=info.get("description") or "",
        uploader=info.get("uploader") or "",
        subtitle_path=subtitle_path,
        subtitle_language=info.get("subtitle_language") or None,
    )


def cleanup_media_files(
    work_dir: Path,
    result: DownloadResult,
) -> tuple[int, int]:
    """Delete generated/downloaded media inside one run directory only."""
    root = work_dir.resolve()
    candidates = {
        path
        for path in (result.audio_path, result.video_path)
        if path is not None
    }
    candidates.update(
        path for path in work_dir.glob("source.*") if path.suffix.lower() in MEDIA_EXTS
    )

    removed_count = 0
    removed_bytes = 0
    for candidate in candidates:
        try:
            resolved = candidate.resolve()
            if not resolved.is_relative_to(root) or not resolved.is_file():
                continue
            size = resolved.stat().st_size
            resolved.unlink()
            removed_count += 1
            removed_bytes += size
        except FileNotFoundError:
            continue
    return removed_count, removed_bytes


def _language_matches(code: str, preferred: str) -> bool:
    normalized_code = code.strip().lower().replace("_", "-")
    normalized_preferred = preferred.strip().lower().replace("_", "-")
    return (
        normalized_code == normalized_preferred
        or normalized_code.startswith(normalized_preferred + "-")
        or normalized_preferred.startswith(normalized_code + "-")
    )


def _select_subtitle_track(
    info: dict,
    preferred_language: str | None = None,
) -> tuple[str, bool] | None:
    """Choose one manual subtitle, then one automatic caption as fallback."""

    def available(table_name: str) -> list[str]:
        table = info.get(table_name)
        if not isinstance(table, dict):
            return []
        return [
            code
            for code, tracks in table.items()
            if code != "live_chat" and isinstance(tracks, list) and tracks
        ]

    manual_codes = available("subtitles")
    automatic_codes = available("automatic_captions")

    def matching(codes: list[str], preferred: str) -> str | None:
        matches = [code for code in codes if _language_matches(code, preferred)]
        return sorted(matches, key=str.casefold)[0] if matches else None

    preferences = [preferred_language, info.get("language")]
    seen_preferences: set[str] = set()
    for value in preferences:
        if not value:
            continue
        preferred = str(value)
        normalized = preferred.lower().replace("_", "-")
        if normalized in seen_preferences:
            continue
        seen_preferences.add(normalized)
        manual = matching(manual_codes, preferred)
        if manual:
            return manual, False
        automatic = matching(automatic_codes, preferred)
        if automatic:
            return automatic, True

    if manual_codes:
        return sorted(manual_codes, key=str.casefold)[0], False
    if automatic_codes:
        return sorted(automatic_codes, key=str.casefold)[0], True
    return None


def _media_part(format_info: object) -> MediaPart | None:
    if not isinstance(format_info, dict):
        return None
    url = format_info.get("url")
    protocol = str(format_info.get("protocol") or "").strip().casefold()
    ext = str(format_info.get("ext") or "").strip().casefold().removeprefix(".")
    vcodec = str(format_info.get("vcodec") or "none").strip()
    acodec = str(format_info.get("acodec") or "none").strip()
    try:
        parsed_url = urlsplit(url) if isinstance(url, str) else None
        port = parsed_url.port if parsed_url is not None else None
    except ValueError:
        return None
    if (
        not isinstance(url, str)
        or url != url.strip()
        or parsed_url is None
        or parsed_url.scheme.casefold() not in _DIRECT_PROTOCOLS
        or not parsed_url.hostname
        or parsed_url.username is not None
        or parsed_url.password is not None
        or protocol not in _DIRECT_PROTOCOLS
        or ext not in _TRANSFER_EXTS
    ):
        return None
    del port  # Access validates malformed port values.

    raw_headers = format_info.get("http_headers")
    headers: dict[str, str] = {}
    if isinstance(raw_headers, dict):
        headers = {
            name: value
            for name, value in raw_headers.items()
            if isinstance(name, str) and isinstance(value, str)
        }
    return MediaPart(
        url=url,
        ext=ext,
        protocol=protocol,
        vcodec=vcodec,
        acodec=acodec,
        http_headers=headers,
    )


def _build_transfer_plan(info: object) -> MediaTransferPlan | None:
    """Build a conservative direct-HTTP plan from yt-dlp's selected formats."""
    if not isinstance(info, dict):
        return None
    requested = info.get("requested_formats")
    if requested is not None:
        if not isinstance(requested, list) or len(requested) != 2:
            return None
        parts = [_media_part(value) for value in requested]
        if any(part is None for part in parts):
            return None
        video_parts = [
            part
            for part in parts
            if part is not None
            and part.vcodec.casefold() != "none"
            and part.acodec.casefold() == "none"
        ]
        audio_parts = [
            part
            for part in parts
            if part is not None
            and part.acodec.casefold() != "none"
            and part.vcodec.casefold() == "none"
        ]
        if len(video_parts) != 1 or len(audio_parts) != 1:
            return None
        return MediaTransferPlan(video=video_parts[0], audio=audio_parts[0])

    progressive = _media_part(info)
    if progressive is None or progressive.acodec.casefold() == "none":
        return None
    return MediaTransferPlan(progressive=progressive)


def _cookie_args(
    cookies_from_browser: str | None = None,
    cookies_file: Path | None = None,
) -> list[str]:
    if cookies_from_browser and cookies_file:
        raise ValueError("浏览器 Cookie 和 cookies.txt 只能选择一种")
    if cookies_file:
        if not cookies_file.is_file():
            raise FileNotFoundError(f"Cookie 文件不存在: {cookies_file}")
        return ["--cookies", str(cookies_file)]
    if cookies_from_browser:
        return ["--cookies-from-browser", cookies_from_browser]
    return []


def _raise_cookie_error_if_needed(error: str, browser: str | None) -> None:
    lowered = error.lower()
    if browser and "cookie database" in lowered and (
        "could not copy" in lowered or "failed to copy" in lowered
    ):
        raise BrowserCookieError(
            f"无法读取 {browser} Cookie 数据库。请完全退出浏览器及其后台进程后重试，"
            "或在界面中选择『不使用』/其它浏览器。也可以通过命令行 --cookies "
            f"使用导出的 cookies.txt。\n\n原始错误:\n{error.strip()[-1200:]}"
        )


def probe(
    url: str,
    *,
    cookies_from_browser: str | None = None,
    cookies_file: Path | None = None,
    preferred_language: str | None = None,
    cancel_event: CancellationSignal | None = None,
) -> VideoMetadata:
    """Fetch video metadata without downloading the media."""
    if not url.strip():
        raise ValueError("视频链接不能为空")

    cookie = _cookie_args(cookies_from_browser, cookies_file)
    meta_cmd = [
        *_yt_dlp_command(),
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        "-f",
        FORMAT_SELECTOR,
        *cookie,
        url,
    ]
    meta = run_command(
        meta_cmd,
        cancel_event=cancel_event,
        run=subprocess.run,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if meta.returncode != 0:
        err = meta.stderr or meta.stdout
        _raise_cookie_error_if_needed(err, cookies_from_browser)
        hint = ""
        if "Sign in" in err or "bot" in err.lower() or "cookies" in err.lower():
            hint = (
                "\n\n提示: 该站点需要登录或反机器人验证。"
                "请在桌面程序里选择『从浏览器读取 Cookie』，"
                "或使用已登录该网站的浏览器后再试。"
            )
        raise RuntimeError(f"无法获取视频信息:\n{err}{hint}")

    try:
        info = json.loads(meta.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("yt-dlp 返回了无效的视频信息") from exc

    duration = info.get("duration")
    subtitle = _select_subtitle_track(info, preferred_language)
    return VideoMetadata(
        title=info.get("title") or "untitled",
        duration=float(duration) if duration is not None else None,
        webpage_url=info.get("webpage_url") or url,
        description=(info.get("description") or "")[:2000],
        uploader=info.get("uploader") or info.get("channel") or "",
        subtitle_language=subtitle[0] if subtitle else None,
        subtitle_automatic=subtitle[1] if subtitle else False,
        transfer_plan=_build_transfer_plan(info),
    )


def _extract_wav(
    source: Path,
    audio_path: Path,
    *,
    cancel_event: CancellationSignal | None = None,
) -> None:
    """Extract mono 16k wav for ASR."""
    ff = run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "wav",
            str(audio_path),
        ],
        cancel_event=cancel_event,
        run=subprocess.run,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if ff.returncode != 0 or not audio_path.exists():
        raise RuntimeError(f"提取音频失败:\n{(ff.stderr or '')[-2000:]}")


def probe_media_duration(
    path: Path,
    *,
    cancel_event: CancellationSignal | None = None,
) -> float | None:
    """Read media duration in seconds via ffprobe; None when unavailable."""
    try:
        proc = run_command(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
                str(path),
            ],
            cancel_event=cancel_event,
            run=subprocess.run,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except FileNotFoundError:
        return None
    if proc.returncode != 0:
        return None
    try:
        duration = float(proc.stdout.strip())
    except ValueError:
        return None
    return duration if duration > 0 else None


def import_local_media(
    source: Path,
    work_dir: Path,
    *,
    cancel_event: CancellationSignal | None = None,
) -> DownloadResult:
    """Use a local video/audio file as pipeline source without copying it."""
    source = source.expanduser().resolve()
    if not source.is_file():
        raise FileNotFoundError(f"本地文件不存在: {source}")
    ext = source.suffix.lower()
    if ext not in MEDIA_EXTS:
        supported = " ".join(sorted(MEDIA_EXTS))
        raise ValueError(f"不支持的媒体格式: {source.name}\n支持的扩展名: {supported}")

    work_dir.mkdir(parents=True, exist_ok=True)
    source_stat = source.stat()
    duration = probe_media_duration(source, cancel_event=cancel_event)
    video_path = source if ext in VIDEO_EXTS else None
    audio_path = work_dir / "audio.wav"
    _extract_wav(source, audio_path, cancel_event=cancel_event)

    (work_dir / "info.json").write_text(
        json.dumps(
            {
                "title": source.stem,
                "duration": duration,
                "webpage_url": source.as_uri(),
                "description": "",
                "uploader": "本地文件",
                "video_path": str(video_path) if video_path else None,
                "audio_path": str(audio_path),
                "subtitle_path": None,
                "subtitle_language": None,
                "media_has_video": video_path is not None,
                "source_fingerprint": {
                    "size": source_stat.st_size,
                    "mtime_ns": source_stat.st_mtime_ns,
                },
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return DownloadResult(
        video_path=video_path,
        audio_path=audio_path,
        title=source.stem,
        duration=duration,
        webpage_url=source.as_uri(),
        description="",
        uploader="本地文件",
        subtitle_path=None,
        subtitle_language=None,
    )


def _subtitle_args(video_info: VideoMetadata) -> list[str]:
    if not video_info.subtitle_language:
        return []
    return [
        "--write-auto-subs" if video_info.subtitle_automatic else "--write-subs",
        "--sub-langs",
        video_info.subtitle_language,
        "--sub-format",
        "vtt/best",
        "--convert-subs",
        "vtt",
    ]


def _run_yt_dlp(
    command: list[str],
    *,
    cookies_from_browser: str | None,
    cancel_event: CancellationSignal | None,
) -> subprocess.CompletedProcess:
    result = run_command(
        command,
        cancel_event=cancel_event,
        run=subprocess.run,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode != 0:
        error = result.stderr or result.stdout
        _raise_cookie_error_if_needed(error, cookies_from_browser)
        raise RuntimeError(f"下载失败:\n{error}")
    return result


def _full_download_command(
    url: str,
    out_tmpl: str,
    subtitle_args: list[str],
    cookie: list[str],
) -> list[str]:
    # Key frames are downscaled before upload, so prefer at most 1080p.
    return [
        *_yt_dlp_command(),
        "--no-playlist",
        "--no-warnings",
        "-f",
        FORMAT_SELECTOR,
        "--merge-output-format",
        "mp4",
        "--concurrent-fragments",
        "4",
        "-o",
        out_tmpl,
        "--write-info-json",
        "--print",
        "after_move:filepath",
        *subtitle_args,
        *cookie,
        url,
    ]


def _subtitle_download_command(
    url: str,
    out_tmpl: str,
    subtitle_args: list[str],
    cookie: list[str],
) -> list[str]:
    return [
        *_yt_dlp_command(),
        "--no-playlist",
        "--no-warnings",
        "--skip-download",
        "-o",
        out_tmpl,
        *subtitle_args,
        *cookie,
        url,
    ]


def _remove_fast_paths(paths: list[Path]) -> None:
    for path in paths:
        try:
            path.unlink()
        except FileNotFoundError:
            pass
        try:
            Path(f"{path}.part").unlink()
        except FileNotFoundError:
            pass


def _snapshot_source_files(work_dir: Path) -> dict[Path, tuple[int, int]]:
    snapshot: dict[Path, tuple[int, int]] = {}
    for path in work_dir.glob("source*"):
        if not path.is_file():
            continue
        stat = path.stat()
        snapshot[path.resolve()] = (stat.st_mtime_ns, stat.st_size)
    return snapshot


def _changed_source_files(
    work_dir: Path,
    before: dict[Path, tuple[int, int]],
    pattern: str,
) -> list[Path]:
    changed: list[Path] = []
    for path in work_dir.glob(pattern):
        if not path.is_file():
            continue
        stat = path.stat()
        if before.get(path.resolve()) != (stat.st_mtime_ns, stat.st_size):
            changed.append(path)
    return changed


def _new_source_files(
    work_dir: Path,
    before: dict[Path, tuple[int, int]],
    pattern: str,
) -> list[Path]:
    return [
        path
        for path in work_dir.glob(pattern)
        if path.is_file() and path.resolve() not in before
    ]


def _checked_fast_destination(work_dir: Path, name: str) -> Path:
    path = work_dir / name
    if path.parent.resolve() != work_dir.resolve():
        raise RuntimeError("高速下载输出路径无效")
    return path


def _commit_progressive(
    part: MediaPart,
    work_dir: Path,
    created_paths: list[Path],
    *,
    cancel_event: CancellationSignal | None,
) -> Path:
    staged = _checked_fast_destination(
        work_dir,
        f"{_FAST_PREFIX}{uuid.uuid4().hex}.{part.ext}",
    )
    final = _checked_fast_destination(work_dir, f"source.{part.ext}")
    created_paths.append(staged)
    fast_download.download_http(
        part.url,
        staged,
        headers=part.http_headers,
        cancel_event=cancel_event,
    )
    check_cancelled(cancel_event)
    if not staged.is_file() or staged.stat().st_size <= 0:
        raise RuntimeError("高速下载完成但媒体文件为空")
    if final.exists():
        raise FileExistsError(f"目标媒体文件已存在: {final}")
    os.replace(staged, final)
    created_paths.append(final)
    if not final.is_file() or final.stat().st_size <= 0:
        raise RuntimeError("高速下载完成但未找到媒体文件")
    return final


def _commit_separate(
    plan: MediaTransferPlan,
    work_dir: Path,
    created_paths: list[Path],
    *,
    cancel_event: CancellationSignal | None,
) -> Path:
    if plan.video is None or plan.audio is None:
        raise RuntimeError("高速下载计划缺少音视频流")
    token = uuid.uuid4().hex
    video = _checked_fast_destination(
        work_dir,
        f"{_FAST_PREFIX}{token}-video.{plan.video.ext}",
    )
    audio = _checked_fast_destination(
        work_dir,
        f"{_FAST_PREFIX}{token}-audio.{plan.audio.ext}",
    )
    merged = _checked_fast_destination(
        work_dir,
        f"{_FAST_PREFIX}{token}-merged.mp4",
    )
    final = _checked_fast_destination(work_dir, "source.mp4")
    created_paths.extend([video, audio, merged])
    fast_download.download_http(
        plan.video.url,
        video,
        headers=plan.video.http_headers,
        cancel_event=cancel_event,
    )
    fast_download.download_http(
        plan.audio.url,
        audio,
        headers=plan.audio.http_headers,
        cancel_event=cancel_event,
    )
    merge = run_command(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(video),
            "-i",
            str(audio),
            "-c",
            "copy",
            str(merged),
        ],
        cancel_event=cancel_event,
        run=subprocess.run,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if merge.returncode != 0 or not merged.is_file() or merged.stat().st_size <= 0:
        raise RuntimeError(f"合并音视频失败:\n{(merge.stderr or '')[-2000:]}")
    check_cancelled(cancel_event)
    if final.exists():
        raise FileExistsError(f"目标媒体文件已存在: {final}")
    os.replace(merged, final)
    created_paths.append(final)
    if not final.is_file() or final.stat().st_size <= 0:
        raise RuntimeError("高速下载完成但未找到媒体文件")
    _remove_fast_paths([video, audio])
    return final


def _fast_download_media(
    plan: MediaTransferPlan,
    work_dir: Path,
    created_paths: list[Path],
    *,
    cancel_event: CancellationSignal | None,
) -> Path:
    if plan.progressive is not None and plan.video is None and plan.audio is None:
        return _commit_progressive(
            plan.progressive,
            work_dir,
            created_paths,
            cancel_event=cancel_event,
        )
    if plan.progressive is None and plan.video is not None and plan.audio is not None:
        return _commit_separate(
            plan,
            work_dir,
            created_paths,
            cancel_event=cancel_event,
        )
    raise RuntimeError("高速下载计划无效")


def _stdout_media_path(stdout: str, work_dir: Path) -> Path | None:
    root = work_dir.resolve()
    for line in reversed(stdout.splitlines()):
        value = line.strip()
        if not value:
            continue
        try:
            candidate = Path(value)
            candidate = candidate if candidate.is_absolute() else work_dir / candidate
            resolved = candidate.resolve()
        except (OSError, ValueError):
            continue
        if (
            resolved.is_relative_to(root)
            and resolved.is_file()
            and resolved.stat().st_size > 0
            and resolved.suffix.lower() in MEDIA_EXTS
            and not resolved.name.startswith(_FAST_PREFIX)
        ):
            return resolved
    return None


def _locate_downloaded_media(work_dir: Path, stdout: str = "") -> Path:
    printed = _stdout_media_path(stdout, work_dir)
    if printed is not None:
        return printed
    candidates = sorted(
        [
            path
            for path in work_dir.iterdir()
            if path.is_file()
            and path.name != "audio.wav"
            and not path.name.startswith(_FAST_PREFIX)
            and path.suffix.lower() in MEDIA_EXTS
        ],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise RuntimeError("下载完成但未找到媒体文件")
    return candidates[0]


def download(
    url: str,
    work_dir: Path,
    *,
    metadata: VideoMetadata | None = None,
    cookies_from_browser: str | None = None,
    cookies_file: Path | None = None,
    cancel_event: CancellationSignal | None = None,
) -> DownloadResult:
    """Download best media + extract wav audio into work_dir."""
    work_dir.mkdir(parents=True, exist_ok=True)
    info_json = work_dir / "info.json"
    out_tmpl = str(work_dir / "source.%(ext)s")
    cookie = _cookie_args(cookies_from_browser, cookies_file)
    video_info = metadata or probe(
        url,
        cookies_from_browser=cookies_from_browser,
        cookies_file=cookies_file,
        cancel_event=cancel_event,
    )
    subtitle_args = _subtitle_args(video_info)

    source: Path | None = None
    download_backend = "yt-dlp"
    fast_paths: list[Path] = []
    can_use_fast = not cookie and video_info.transfer_plan is not None
    if can_use_fast:
        try:
            source = _fast_download_media(
                video_info.transfer_plan,
                work_dir,
                fast_paths,
                cancel_event=cancel_event,
            )
            if subtitle_args:
                previous_subtitles = _snapshot_source_files(work_dir)
                subtitle_command = _subtitle_download_command(
                    url,
                    out_tmpl,
                    subtitle_args,
                    cookie,
                )
                try:
                    _run_yt_dlp(
                        subtitle_command,
                        cookies_from_browser=cookies_from_browser,
                        cancel_event=cancel_event,
                    )
                finally:
                    fast_paths.extend(
                        _new_source_files(
                            work_dir,
                            previous_subtitles,
                            "source*.vtt",
                        )
                    )
            download_backend = "range"
        except CancellationRequested:
            _remove_fast_paths(fast_paths)
            raise
        except Exception:
            _remove_fast_paths(fast_paths)
            source = None

    if source is None:
        existing_sources = _snapshot_source_files(work_dir)
        full_command = _full_download_command(
            url,
            out_tmpl,
            subtitle_args,
            cookie,
        )
        full_result = _run_yt_dlp(
            full_command,
            cookies_from_browser=cookies_from_browser,
            cancel_event=cancel_event,
        )
        source = _stdout_media_path(full_result.stdout or "", work_dir)
        if source is None:
            new_media = [
                path
                for path in _changed_source_files(
                    work_dir,
                    existing_sources,
                    "source.*",
                )
                if path.name != "audio.wav"
                and not path.name.startswith(_FAST_PREFIX)
                and path.suffix.lower() in MEDIA_EXTS
            ]
            if new_media:
                source = max(new_media, key=lambda path: path.stat().st_mtime)
            else:
                source = _locate_downloaded_media(work_dir)

    if not source.is_file() or source.stat().st_size <= 0:
        raise RuntimeError("下载完成但媒体文件为空")
    video_path = source if source.suffix.lower() in VIDEO_EXTS else None

    # Audio extraction happens after the selected download backend has succeeded.
    # Its failure must not trigger a second media download.
    audio_path = work_dir / "audio.wav"
    if not (source.suffix.lower() == ".wav" and source.name == "audio.wav"):
        _extract_wav(source, audio_path, cancel_event=cancel_event)

    subtitle_candidates = sorted(
        [path for path in work_dir.glob("source*.vtt") if path.is_file()],
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    subtitle_path = subtitle_candidates[0] if subtitle_candidates else None

    info_json.write_text(
        json.dumps(
            {
                "title": video_info.title,
                "duration": video_info.duration,
                "webpage_url": video_info.webpage_url,
                "description": video_info.description,
                "uploader": video_info.uploader,
                "video_path": str(video_path) if video_path else None,
                "audio_path": str(audio_path),
                "subtitle_path": str(subtitle_path) if subtitle_path else None,
                "subtitle_language": (
                    video_info.subtitle_language if subtitle_path else None
                ),
                "media_has_video": video_path is not None,
                "download_backend": download_backend,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    return DownloadResult(
        video_path=video_path,
        audio_path=audio_path,
        title=video_info.title,
        duration=video_info.duration,
        webpage_url=video_info.webpage_url,
        description=video_info.description,
        uploader=video_info.uploader,
        subtitle_path=subtitle_path,
        subtitle_language=video_info.subtitle_language if subtitle_path else None,
    )
