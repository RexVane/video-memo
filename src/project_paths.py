"""Paths shared by source-tree and installed VideoMemo executions."""

from __future__ import annotations

import os
from pathlib import Path


def project_root() -> Path:
    """Return the configured data root for source and installed executions."""
    configured = os.environ.get("VIDEOMEMO_PROJECT_ROOT", "").strip()
    if configured:
        return Path(configured).expanduser().resolve()

    source_root = Path(__file__).resolve().parent.parent
    if (source_root / "requirements.txt").is_file() and (source_root / "src").is_dir():
        return source_root
    return Path.cwd().resolve()
