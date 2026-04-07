from __future__ import annotations

import os
from pathlib import Path

from app.core.config import get_scan_root


def _normalize_extensions(include_extensions: list[str]) -> set[str]:
    normalized: set[str] = set()
    for ext in include_extensions:
        cleaned = ext.strip().lower()
        if not cleaned:
            continue
        if cleaned in {"[none]", "none", "noext", "no-extension", "no_extension"}:
            normalized.add("[none]")
            continue
        normalized.add(cleaned if cleaned.startswith(".") else f".{cleaned}")
    return normalized


def resolve_scan_folder(subfolder: str) -> Path:
    root = get_scan_root()

    if not root.exists() or not root.is_dir():
        raise ValueError(
            f"Mounted scan root does not exist: {root}. Make sure your Docker volume is mounted."
        )

    if not os.access(root, os.R_OK):
        raise ValueError(f"Mounted scan root is not readable: {root}")

    normalized = (subfolder or "").strip().lstrip("/")
    if not normalized:
        return root

    candidate = (root / normalized).resolve()
    if not str(candidate).startswith(str(root)):
        raise ValueError("Invalid subfolder. Use a relative path within mounted scan root.")
    if not candidate.exists() or not candidate.is_dir():
        raise ValueError(f"Subfolder does not exist under mounted root: {normalized}")
    if not os.access(candidate, os.R_OK):
        raise ValueError(f"Subfolder is not readable: {normalized}")
    return candidate


def scan_log_files(subfolder: str, include_extensions: list[str]) -> list[Path]:
    target = resolve_scan_folder(subfolder)
    normalized_ext = _normalize_extensions(include_extensions)
    include_no_extension = "[none]" in normalized_ext
    files = [
        p
        for p in target.rglob("*")
        if p.is_file()
        and (
            p.suffix.lower() in normalized_ext
            or (include_no_extension and p.suffix == "")
        )
    ]
    if not files:
        scan_target = subfolder.strip() or "."
        raise ValueError(
            f"No matching log files found in mounted path '{scan_target}'. "
            "Check LOG_FOLDER mount and selected file extensions."
        )
    return files


def scan_root_metadata() -> dict[str, object]:
    root = get_scan_root()
    exists = root.exists() and root.is_dir()
    readable = os.access(root, os.R_OK) if exists else False
    total_files = 0
    if exists and readable:
        total_files = sum(1 for p in root.rglob("*") if p.is_file())

    return {
        "scan_root": str(root),
        "exists": exists,
        "readable": readable,
        "total_files_under_root": total_files,
    }
