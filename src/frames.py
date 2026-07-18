"""Extract representative frames from video for vision understanding."""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path


def extract_frames(
    video_path: Path,
    out_dir: Path,
    max_frames: int = 8,
    duration: float | None = None,
    max_edge: int = 1280,
) -> list[Path]:
    """
    Sample up to max_frames evenly across the video.
    Uses ffmpeg fps filter based on duration.
    """
    if max_frames < 1:
        raise ValueError("max_frames 必须大于 0")
    if max_edge < 64:
        raise ValueError("max_edge 不能小于 64")
    if not video_path.is_file():
        raise FileNotFoundError(f"视频文件不存在: {video_path}")

    out_dir.parent.mkdir(parents=True, exist_ok=True)

    if duration and duration > 0:
        # e.g. 120s, 8 frames -> 1 frame every 15s
        interval = max(duration / max_frames, 1.0)
        fps_filter = f"fps=1/{interval:.4f}"
    else:
        # fallback: roughly one frame every 30s, cap later
        fps_filter = "fps=1/30"

    scale_filter = (
        f"scale=w='min({max_edge},iw)':h='min({max_edge},ih)':"
        "force_original_aspect_ratio=decrease:force_divisible_by=2"
    )
    vf = f"{fps_filter},{scale_filter}"

    with tempfile.TemporaryDirectory(
        prefix=f".{out_dir.name}_",
        dir=out_dir.parent,
    ) as temporary:
        temporary_dir = Path(temporary)
        pattern = str(temporary_dir / "frame_%03d.jpg")
        cmd = [
            "ffmpeg",
            "-y",
            "-i",
            str(video_path),
            "-vf",
            vf,
            "-q:v",
            "3",
            "-frames:v",
            str(max_frames),
            pattern,
        ]
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if proc.returncode != 0:
            raise RuntimeError(f"抽帧失败:\n{proc.stderr[-2000:]}")
        generated = sorted(temporary_dir.glob("frame_*.jpg"))[:max_frames]
        if not generated:
            raise RuntimeError("抽帧失败：ffmpeg 未生成任何关键帧")

        out_dir.mkdir(parents=True, exist_ok=True)
        for old_frame in out_dir.glob("frame_*.jpg"):
            old_frame.unlink()
        frames: list[Path] = []
        for frame in generated:
            destination = out_dir / frame.name
            shutil.move(str(frame), destination)
            frames.append(destination)
        return frames
