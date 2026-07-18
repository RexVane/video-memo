"""Download video / audio from a URL via yt-dlp."""

from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path


VIDEO_EXTS = {
    ".mp4", ".mkv", ".webm", ".mov", ".avi", ".flv",
    ".m4v", ".ts", ".mpg", ".mpeg", ".wmv",
}
AUDIO_EXTS = {
    ".mp3", ".wav", ".m4a", ".flac", ".aac", ".ogg",
    ".opus", ".wma", ".amr", ".aiff",
}
MEDIA_EXTS = VIDEO_EXTS | AUDIO_EXTS


class BrowserCookieError(RuntimeError):
    """Raised when yt-dlp cannot read a browser cookie database."""


@dataclass(frozen=True)
class VideoMetadata:
    title: str
    duration: float | None
    webpage_url: str
    description: str
    uploader: str
    subtitle_language: str | None = None
    subtitle_automatic: bool = False


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
    normalized_code = code.lower().replace("_", "-")
    normalized_preferred = preferred.lower().replace("_", "-")
    return normalized_code == normalized_preferred or normalized_code.startswith(
        normalized_preferred + "-"
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
) -> VideoMetadata:
    """Fetch video metadata without downloading the media."""
    if not url.strip():
        raise ValueError("视频链接不能为空")

    cookie = _cookie_args(cookies_from_browser, cookies_file)
    meta_cmd = [
        "yt-dlp",
        "--dump-single-json",
        "--no-playlist",
        "--no-warnings",
        *cookie,
        url,
    ]
    meta = subprocess.run(
        meta_cmd,
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
    )


def _extract_wav(source: Path, audio_path: Path) -> None:
    """Extract mono 16k wav for ASR."""
    ff = subprocess.run(
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
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if ff.returncode != 0 or not audio_path.exists():
        raise RuntimeError(f"提取音频失败:\n{(ff.stderr or '')[-2000:]}")


def probe_media_duration(path: Path) -> float | None:
    """Read media duration in seconds via ffprobe; None when unavailable."""
    try:
        proc = subprocess.run(
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


def import_local_media(source: Path, work_dir: Path) -> DownloadResult:
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
    duration = probe_media_duration(source)
    video_path = source if ext in VIDEO_EXTS else None
    audio_path = work_dir / "audio.wav"
    _extract_wav(source, audio_path)

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


def download(
    url: str,
    work_dir: Path,
    *,
    metadata: VideoMetadata | None = None,
    cookies_from_browser: str | None = None,
    cookies_file: Path | None = None,
) -> DownloadResult:
    """Download best mp4 (or best) + extract wav audio into work_dir."""
    work_dir.mkdir(parents=True, exist_ok=True)
    info_json = work_dir / "info.json"
    out_tmpl = str(work_dir / "source.%(ext)s")
    cookie = _cookie_args(cookies_from_browser, cookies_file)
    video_info = metadata or probe(
        url,
        cookies_from_browser=cookies_from_browser,
        cookies_file=cookies_file,
    )

    subtitle_args: list[str] = []
    if video_info.subtitle_language:
        subtitle_args = [
            "--write-auto-subs" if video_info.subtitle_automatic else "--write-subs",
            "--sub-langs",
            video_info.subtitle_language,
            "--sub-format",
            "vtt/best",
            "--convert-subs",
            "vtt",
        ]

    # Prefer a single file with video+audio; fall back to best
    dl_cmd = [
        "yt-dlp",
        "--no-playlist",
        "--no-warnings",
        "-f",
        "bv*+ba/b",
        "--merge-output-format",
        "mp4",
        "-o",
        out_tmpl,
        "--write-info-json",
        "--print",
        "after_move:filepath",
        *subtitle_args,
        *cookie,
        url,
    ]
    dl = subprocess.run(
        dl_cmd,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if dl.returncode != 0:
        err = dl.stderr or dl.stdout
        _raise_cookie_error_if_needed(err, cookies_from_browser)
        raise RuntimeError(f"下载失败:\n{err}")

    # Locate downloaded media
    candidates = sorted(
        [
            p
            for p in work_dir.iterdir()
            if p.name != "audio.wav"
            and p.suffix.lower()
            in {".mp4", ".mkv", ".webm", ".mov", ".m4a", ".mp3", ".wav"}
        ],
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    if not candidates:
        raise RuntimeError("下载完成但未找到媒体文件")

    video_path: Path | None = None
    source = candidates[0]
    if source.suffix.lower() in {".mp4", ".mkv", ".webm", ".mov"}:
        video_path = source

    # Extract mono 16k wav for ASR
    audio_path = work_dir / "audio.wav"
    if not (source.suffix.lower() == ".wav" and source.name == "audio.wav"):
        _extract_wav(source, audio_path)

    subtitle_candidates = sorted(
        work_dir.glob("source*.vtt"),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )
    subtitle_path = subtitle_candidates[0] if subtitle_candidates else None

    # Save compact meta
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
