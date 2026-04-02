from __future__ import annotations

from pathlib import Path
import gzip
from typing import Iterator


def iter_file_lines(path: Path) -> Iterator[tuple[int, str]]:
    if path.suffix.lower() == ".gz":
        with gzip.open(path, "rt", encoding="utf-8", errors="replace") as handle:
            for idx, line in enumerate(handle, start=1):
                yield idx, line
        return

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for idx, line in enumerate(handle, start=1):
            yield idx, line
