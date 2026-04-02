from __future__ import annotations

from datetime import datetime
import re

from app.models.schemas import DateRange, SearchFilters


def within_range(ts: datetime | None, date_range: DateRange | None) -> bool:
    if date_range is None:
        return True
    if ts is None:
        return False
    if date_range.start and ts < date_range.start:
        return False
    if date_range.end:
        # Most UI inputs are second-resolution (microseconds=0). If the parsed log line
        # includes fractional microseconds, strict `ts > end` would exclude the same second.
        # Treat end as inclusive to the whole second when microseconds are not provided.
        end = (
            date_range.end.replace(microsecond=999999)
            if date_range.end.microsecond == 0
            else date_range.end
        )
        if ts > end:
            return False
    return True


def build_line_matcher(filters: SearchFilters):
    keyword = filters.keyword or ""
    terms = [t.strip() for t in filters.terms if t.strip()]

    if not filters.regex_mode and terms:
        if filters.case_insensitive:
            lowered_terms = [t.lower() for t in terms]
            if filters.terms_operator == "or":
                return lambda line: any(t in line.lower() for t in lowered_terms)
            return lambda line: all(t in line.lower() for t in lowered_terms)

        if filters.terms_operator == "or":
            return lambda line: any(t in line for t in terms)
        return lambda line: all(t in line for t in terms)

    if not keyword:
        return lambda line: True

    literal_lookahead = re.fullmatch(r"\(\?\=\.\*([A-Za-z0-9_.:@\-]+)\)", keyword)
    if literal_lookahead:
        token = literal_lookahead.group(1)
        if filters.case_insensitive:
            token_lower = token.lower()
            return lambda line: token_lower in line.lower()
        return lambda line: token in line

    if filters.regex_mode:
        flags = re.IGNORECASE if filters.case_insensitive else 0
        pattern = re.compile(keyword, flags)
        return lambda line: bool(pattern.search(line))

    if filters.case_insensitive:
        lowered = keyword.lower()
        return lambda line: lowered in line.lower()

    return lambda line: keyword in line
