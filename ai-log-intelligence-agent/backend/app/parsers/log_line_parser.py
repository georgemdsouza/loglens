from __future__ import annotations

from app.parsers.timestamp_parser import extract_timestamp


def parse_log_line(line: str) -> tuple[str | None, str]:
    """Return ISO timestamp string (if parsed) and raw message."""
    ts = extract_timestamp(line)
    return (ts.isoformat() if ts else None, line.rstrip("\n"))
