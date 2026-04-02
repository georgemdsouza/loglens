from __future__ import annotations

from datetime import datetime
import re

_TIMESTAMP_PATTERNS: list[tuple[re.Pattern[str], str | None]] = [
    # Example: `2026-03-29 00:00:34:433676`
    (re.compile(r"(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}:\d{1,6})"), "%Y-%m-%d %H:%M:%S:%f"),
    # Example: `2026-03-29 00:00:34,433676`
    (re.compile(r"(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2},\d{1,6})"), "%Y-%m-%d %H:%M:%S,%f"),
    (re.compile(r"(?P<ts>\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})"), "%Y-%m-%d %H:%M:%S"),
    (re.compile(r"(?P<ts>\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})"), "%Y-%m-%dT%H:%M:%S"),
    (re.compile(r"(?P<ts>\[\d{2}/[A-Za-z]{3}/\d{4}:\d{2}:\d{2}:\d{2}\])"), "[%d/%b/%Y:%H:%M:%S]"),
    (re.compile(r"(?P<ts>[A-Za-z]{3} \d{1,2} \d{2}:\d{2}:\d{2})"), "%b %d %H:%M:%S"),
    # Example: `29/03/2026 14:22:11`
    (re.compile(r"(?P<ts>\d{2}/\d{2}/\d{4} \d{2}:\d{2}:\d{2})"), "%d/%m/%Y %H:%M:%S"),
]


def extract_timestamp(line: str, default_year: int | None = None) -> datetime | None:
    for pattern, dt_format in _TIMESTAMP_PATTERNS:
        match = pattern.search(line)
        if not match or dt_format is None:
            continue

        raw = match.group("ts")
        try:
            parsed = datetime.strptime(raw, dt_format)
            if dt_format == "%b %d %H:%M:%S":
                parsed = parsed.replace(year=default_year or datetime.now().year)
            return parsed
        except ValueError:
            continue
    return None


# TODO(AI-summary): Add probabilistic timestamp inference for ambiguous formats.
