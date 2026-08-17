"""Small cancellation primitives shared by the pipeline and media helpers."""

from __future__ import annotations

import subprocess
import sys
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
    **kwargs,
) -> subprocess.CompletedProcess:
    """Run a command normally, or supervise it when cancellation is enabled.

    Keeping the normal path on the caller's ``subprocess.run`` preserves the
    existing test seams and avoids an extra polling thread for CLI use.
    """
    check_cancelled(cancel_event)
    if cancel_event is None:
        return run(command, **kwargs)

    popen_kwargs = dict(kwargs)
    if popen_kwargs.pop("capture_output", False):
        popen_kwargs.setdefault("stdout", subprocess.PIPE)
        popen_kwargs.setdefault("stderr", subprocess.PIPE)
    process = subprocess.Popen(command, **popen_kwargs)
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
            if cancel_event.is_set():
                if sys.platform == "win32" and process.pid:
                    subprocess.run(
                        ["taskkill", "/pid", str(process.pid), "/T", "/F"],
                        capture_output=True,
                    )
                else:
                    process.terminate()
                    try:
                        process.wait(timeout=1)
                    except subprocess.TimeoutExpired:
                        process.kill()
                process.communicate()
                raise CancellationRequested("任务已取消")
