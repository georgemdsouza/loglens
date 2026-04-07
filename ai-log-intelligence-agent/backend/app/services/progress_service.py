from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock

_PROGRESS: dict[str, dict[str, object]] = {}
_LOCK = Lock()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def start_progress(search_id: str, total_files: int) -> None:
    with _LOCK:
        _PROGRESS[search_id] = {
            "search_id": search_id,
            "status": "running",
            "started_at": _now_iso(),
            "updated_at": _now_iso(),
            "current_file": None,
            "total_files": total_files,
            "files_scanned": 0,
            "lines_scanned": 0,
            "matches_found": 0,
            "message": "Scanning started",
        }


def update_progress(
    search_id: str,
    *,
    current_file: str | None = None,
    files_scanned: int | None = None,
    lines_scanned: int | None = None,
    matches_found: int | None = None,
    message: str | None = None,
) -> None:
    with _LOCK:
        progress = _PROGRESS.get(search_id)
        if not progress:
            return
        if current_file is not None:
            progress["current_file"] = current_file
        if files_scanned is not None:
            progress["files_scanned"] = files_scanned
        if lines_scanned is not None:
            progress["lines_scanned"] = lines_scanned
        if matches_found is not None:
            progress["matches_found"] = matches_found
        if message is not None:
            progress["message"] = message
        progress["updated_at"] = _now_iso()


def finish_progress(search_id: str, message: str = "Scan completed") -> None:
    with _LOCK:
        progress = _PROGRESS.get(search_id)
        if not progress:
            return
        if progress.get("status") == "cancelled":
            return
        progress["status"] = "completed"
        progress["message"] = message
        progress["updated_at"] = _now_iso()


def fail_progress(search_id: str, message: str) -> None:
    with _LOCK:
        progress = _PROGRESS.get(search_id)
        if not progress:
            return
        if progress.get("status") == "cancelled":
            return
        progress["status"] = "failed"
        progress["message"] = message
        progress["updated_at"] = _now_iso()


def get_progress(search_id: str) -> dict[str, object] | None:
    with _LOCK:
        progress = _PROGRESS.get(search_id)
        return dict(progress) if progress else None


def request_cancel(search_id: str) -> bool:
    with _LOCK:
        progress = _PROGRESS.get(search_id)
        if not progress:
            return False
        progress["status"] = "cancelled"
        progress["message"] = "Cancel requested"
        progress["updated_at"] = _now_iso()
        return True


def is_cancelled(search_id: str) -> bool:
    with _LOCK:
        progress = _PROGRESS.get(search_id)
        if not progress:
            return False
        return progress.get("status") == "cancelled"
