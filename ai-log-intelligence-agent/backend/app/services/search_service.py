from __future__ import annotations

from collections import deque
from datetime import datetime
from uuid import uuid4

from app.models.schemas import ContextLine, LogMatch, SearchRequest, SearchResponse, SummaryStats
from app.parsers.timestamp_parser import extract_timestamp
from app.services.file_streaming_service import iter_file_lines
from app.services.filter_engine import build_line_matcher, within_range
from app.services.folder_scanner_service import scan_log_files
from app.services.progress_service import (
    fail_progress,
    finish_progress,
    is_cancelled,
    start_progress,
    update_progress,
)
from app.services.summary_service import SummaryCollector


class SearchCancelledError(Exception):
    pass


def search_logs(payload: SearchRequest) -> SearchResponse:
    paths = scan_log_files(payload.subfolder, payload.include_extensions, payload.selected_files)
    search_id = payload.search_id or str(uuid4())
    start_progress(search_id, len(paths))
    matcher = build_line_matcher(payload.filters)
    summary = SummaryCollector()
    results: list[LogMatch] = []
    truncated = False
    context_window = payload.context_lines

    try:
        for path in paths:
            if is_cancelled(search_id):
                raise SearchCancelledError("Scan cancelled by user")
            summary.add_file()
            update_progress(
                search_id,
                current_file=str(path),
                files_scanned=summary.total_files_scanned,
                lines_scanned=summary.total_lines_scanned,
                matches_found=summary.total_matches,
                message=f"Scanning {path.name}",
            )
            before_buffer: deque[ContextLine] = deque(maxlen=context_window if context_window > 0 else 0)
            pending_context_after: list[dict[str, int]] = []
            for line_number, line in iter_file_lines(path):
                if line_number % 1000 == 0 and is_cancelled(search_id):
                    raise SearchCancelledError("Scan cancelled by user")
                summary.add_line()
                stripped = line.rstrip("\n")

                if summary.total_lines_scanned % 5000 == 0:
                    update_progress(
                        search_id,
                        lines_scanned=summary.total_lines_scanned,
                        matches_found=summary.total_matches,
                        files_scanned=summary.total_files_scanned,
                    )

                if context_window > 0 and pending_context_after:
                    for pending in pending_context_after:
                        remaining = int(pending["remaining"])
                        if remaining > 0:
                            match_index = int(pending["match_index"])
                            results[match_index].context_after.append(
                                ContextLine(line_number=line_number, message=stripped)
                            )
                            pending["remaining"] = remaining - 1
                    pending_context_after = [p for p in pending_context_after if int(p["remaining"]) > 0]

                if not matcher(line):
                    if context_window > 0:
                        before_buffer.append(ContextLine(line_number=line_number, message=stripped))
                    continue

                ts = extract_timestamp(line, default_year=datetime.now().year)
                if not within_range(ts, payload.date_range):
                    if context_window > 0:
                        before_buffer.append(ContextLine(line_number=line_number, message=stripped))
                    continue

                summary.add_match(line)
                if len(results) < payload.max_results:
                    context_before = list(before_buffer) if context_window > 0 else []
                    results.append(
                        LogMatch(
                            file_path=str(path),
                            line_number=line_number,
                            timestamp=ts,
                            message=stripped,
                            context_before=context_before,
                            context_after=[],
                        )
                    )
                    if context_window > 0:
                        pending_context_after.append(
                            {"match_index": len(results) - 1, "remaining": context_window}
                        )
                else:
                    truncated = True

                if context_window > 0:
                    before_buffer.append(ContextLine(line_number=line_number, message=stripped))

        response_summary = SummaryStats(
            total_files_scanned=summary.total_files_scanned,
            total_lines_scanned=summary.total_lines_scanned,
            total_matches=summary.total_matches,
            top_patterns=summary.top_patterns(),
        )
        finish_progress(search_id, "Scan completed")
        return SearchResponse(matches=results, summary=response_summary, truncated=truncated)
    except SearchCancelledError:
        raise
    except Exception as exc:  # pragma: no cover
        fail_progress(search_id, str(exc))
        raise
