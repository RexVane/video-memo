"""Small cancellation primitives shared by the pipeline and media helpers."""

from __future__ import annotations

import subprocess
import sys
import time
from typing import Callable, Protocol


class CancellationSignal(Protocol):
    def is_set(self) -> bool: ...


class CancellationRequested(RuntimeError):
    """Raised when a user asks an in-flight pipeline to stop."""


def check_cancelled(signal: CancellationSignal | None) -> None:
    if signal is not None and signal.is_set():
        raise CancellationRequested("任务已取消")


def run_command(
    command: list[str],
    *,
    cancel_event: CancellationSignal | None,
    run: Callable[..., subprocess.CompletedProcess],
    timeout: float | None = 3600.0,
    **kwargs,
) -> subprocess.CompletedProcess:
    """Run a command normally, or supervise it when cancellation is enabled.

    ``timeout`` is a wall-clock deadline, not merely a per-I/O timeout. It keeps
    corrupt media or a wedged ffmpeg/yt-dlp process from blocking CLI mode
    forever. Callers may pass ``None`` only when an unbounded command is truly
    intentional.
    """
    check_cancelled(cancel_event)
    if cancel_event is None:
        try:
            return run(command, timeout=timeout, **kwargs)
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(
                f"外部命令运行超时（{timeout:.0f} 秒）: {command[0]}"
            ) from error

    popen_kwargs = dict(kwargs)
    if popen_kwargs.pop("capture_output", False):
        popen_kwargs.setdefault("stdout", subprocess.PIPE)
        popen_kwargs.setdefault("stderr", subprocess.PIPE)
    process = subprocess.Popen(command, **popen_kwargs)
    started = time.monotonic()
    while True:
        try:
            stdout, stderr = process.communicate(timeout=0.2)
            return subprocess.CompletedProcess(
                command,
                process.returncode,
                stdout=stdout,
                stderr=stderr,
            )
        except subprocess.TimeoutExpired:
            timed_out = timeout is not None and time.monotonic() - started >= timeout
            if cancel_event.is_set() or timed_out:
                if sys.platform == "win32" and process.pid:
                    try:
                        taskkill = subprocess.run(
                            ["taskkill", "/pid", str(process.pid), "/T", "/F"],
                            capture_output=True,
                            timeout=2,
                        )
                    except (OSError, subprocess.TimeoutExpired):
                        taskkill = None
                    # ``taskkill`` can be denied by a restricted token even
                    # for a child we own. The Popen handle remains authoritative
                    # and lets us terminate that process without waiting for its
                    # natural timeout.
                    if taskkill is None or taskkill.returncode != 0:
                        try:
                            process.kill()
                        except ProcessLookupError:
                            pass
                else:
                    process.terminate()
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        process.kill()
                process.communicate()
                if timed_out:
                    raise RuntimeError(
                        f"外部命令运行超时（{timeout:.0f} 秒）: {command[0]}"
                    )
                raise CancellationRequested("任务已取消")
