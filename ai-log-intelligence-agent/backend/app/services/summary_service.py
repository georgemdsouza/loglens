from __future__ import annotations

from collections import Counter


class SummaryCollector:
    def __init__(self) -> None:
        self.total_files_scanned = 0
        self.total_lines_scanned = 0
        self.total_matches = 0
        self._pattern_counter: Counter[str] = Counter()

    def add_file(self) -> None:
        self.total_files_scanned += 1

    def add_line(self) -> None:
        self.total_lines_scanned += 1

    def add_match(self, message: str) -> None:
        self.total_matches += 1
        normalized = self._normalize_message(message)
        if normalized:
            self._pattern_counter[normalized] += 1

    def top_patterns(self, limit: int = 10) -> list[tuple[str, int]]:
        return self._pattern_counter.most_common(limit)

    @staticmethod
    def _normalize_message(message: str) -> str:
        # Reduce very long noisy messages for compact counting.
        msg = message.strip()
        return msg[:160]
