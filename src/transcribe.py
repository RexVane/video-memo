"""Speech-to-text with faster-whisper (local)."""

from __future__ import annotations

import ctypes
import gc
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from cancellation import CancellationSignal, check_cancelled
from project_paths import project_root

StatusCb = Callable[[str], None]
ProgressCb = Callable[[float], None]

PROJECT_ROOT = project_root()
DEFAULT_WHISPER_MODEL_DIR = PROJECT_ROOT / "models" / "faster-whisper"


@dataclass
class TranscriptSegment:
    start: float
    end: float
    text: str


@dataclass
class Transcript:
    language: str | None
    text: str
    segments: list[TranscriptSegment]


def _fmt_ts(seconds: float) -> str:
    s = max(0, int(seconds))
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h:02d}:{m:02d}:{sec:02d}"
    return f"{m:02d}:{sec:02d}"


def get_whisper_model_dir() -> Path:
    configured = os.getenv("WHISPER_MODEL_DIR", "").strip()
    model_dir = Path(configured).expanduser() if configured else DEFAULT_WHISPER_MODEL_DIR
    if not model_dir.is_absolute():
        model_dir = PROJECT_ROOT / model_dir
    return model_dir.resolve()


def _cuda_runtime_status() -> tuple[bool, str | None]:
    try:
        import ctranslate2
    except ImportError:
        return False, "未安装 CTranslate2"

    try:
        cuda_device_count = ctranslate2.get_cuda_device_count()
    except Exception as error:
        # A broken CUDA installation can fail while probing, before Whisper
        # gets a chance to fall back to CPU. Treat that as an unavailable GPU.
        return False, f"CUDA 检测失败: {error}"

    if cuda_device_count < 1:
        return False, "未检测到 CUDA 设备"

    if sys.platform == "win32":
        missing: list[str] = []
        for library in ("cublas64_12.dll", "cublasLt64_12.dll"):
            try:
                ctypes.WinDLL(library)
            except OSError:
                missing.append(library)
        if missing:
            return False, f"缺少 {', '.join(missing)}"
    return True, None


def _is_cuda_runtime_error(error: Exception) -> bool:
    messages: list[str] = []
    current: BaseException | None = error
    while current is not None and len(messages) < 4:
        messages.append(str(current).lower())
        current = current.__cause__ or current.__context__
    combined = "\n".join(messages)
    # Avoid bare "cuda"/"out of memory" markers: a legitimate GPU OOM is a
    # model-capacity problem, not a missing runtime, and blindly retrying a
    # large model on CPU produces a slower, less useful second failure.
    return any(
        marker in combined
        for marker in (
            "cublas",
            "cudnn",
            "nvcuda",
            "cuda runtime",
            "cuda driver",
            "failed to load cuda",
            "library cuda",
            "libcuda",
        )
    )


def _transcribe_once(
    model_factory,
    audio_path: Path,
    model_size: str,
    language: str | None,
    device: str,
    compute_type: str,
    model_dir: Path,
    on_progress: ProgressCb | None = None,
    cancel_event: CancellationSignal | None = None,
) -> Transcript:
    check_cancelled(cancel_event)
    model = model_factory(
        model_size,
        device=device,
        compute_type=compute_type,
        download_root=str(model_dir),
    )
    segments_iter, info = model.transcribe(
        str(audio_path),
        language=language,
        vad_filter=True,
        beam_size=5,
    )

    segments: list[TranscriptSegment] = []
    parts: list[str] = []
    duration = float(getattr(info, "duration", 0.0) or 0.0)
    last_percent = -2
    for seg in segments_iter:
        check_cancelled(cancel_event)
        if on_progress and duration > 0:
            percent = min(100, int((seg.end / duration) * 100))
            if percent >= last_percent + 2:
                on_progress(percent / 100)
                last_percent = percent
        text = (seg.text or "").strip()
        if not text:
            continue
        segments.append(TranscriptSegment(start=seg.start, end=seg.end, text=text))
        parts.append(f"[{_fmt_ts(seg.start)}] {text}")

    if on_progress:
        on_progress(1.0)

    return Transcript(
        language=getattr(info, "language", None),
        text="\n".join(parts),
        segments=segments,
    )


def transcribe(
    audio_path: Path,
    model_size: str = "base",
    language: str | None = None,
    device: str = "auto",
    on_status: StatusCb | None = None,
    on_progress: ProgressCb | None = None,
    cancel_event: CancellationSignal | None = None,
) -> Transcript:
    """
    Transcribe audio.
    model_size: tiny / base / small / medium / large-v3
    language: e.g. 'zh', 'en', or None for auto-detect
    """
    from faster_whisper import WhisperModel

    check_cancelled(cancel_event)
    if not audio_path.is_file():
        raise FileNotFoundError(f"音频文件不存在: {audio_path}")
    if device not in {"auto", "cpu", "cuda"}:
        raise ValueError("device 必须是 auto、cpu 或 cuda")
    if model_size not in {"tiny", "base", "small", "medium", "large-v3"}:
        raise ValueError("model_size 必须是 tiny、base、small、medium 或 large-v3")

    model_dir = get_whisper_model_dir()
    model_dir.mkdir(parents=True, exist_ok=True)

    def status(message: str) -> None:
        if on_status:
            on_status(message)

    if device == "auto":
        cuda_ready, reason = _cuda_runtime_status()
        if cuda_ready:
            status("检测到完整 CUDA 运行时，使用 GPU float16")
            try:
                return _transcribe_once(
                    WhisperModel,
                    audio_path,
                    model_size,
                    language,
                    "cuda",
                    "float16",
                    model_dir,
                    on_progress,
                    cancel_event,
                )
            except Exception as error:
                if not _is_cuda_runtime_error(error):
                    raise
                status(f"CUDA 转写失败（{error}），自动切换 CPU int8")
                gc.collect()
        else:
            status(f"CUDA 不可用（{reason}），使用 CPU int8")
        device = "cpu"

    compute_type = "float16" if device == "cuda" else "int8"
    status(f"使用 {device.upper()} {compute_type}")
    return _transcribe_once(
        WhisperModel,
        audio_path,
        model_size,
        language,
        device,
        compute_type,
        model_dir,
        on_progress,
        cancel_event,
    )


def save_transcript(transcript: Transcript, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(transcript.text, encoding="utf-8")
    temporary.replace(path)
