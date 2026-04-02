from __future__ import annotations

import os
from pathlib import Path


class Settings:
    log_mount_path: str = os.getenv("LOG_MOUNT_PATH", "/data/logs")


settings = Settings()


def get_scan_root() -> Path:
    return Path(settings.log_mount_path).expanduser().resolve()
