from __future__ import annotations

import csv
import io
import json
from datetime import datetime

from app.models.schemas import ExportRequest, ExportResponse
from app.services.search_service import search_logs


def export_results(payload: ExportRequest) -> ExportResponse:
    search_response = search_logs(payload)
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")

    if payload.export_format == "json":
        content = json.dumps(
            {
                "summary": search_response.summary.model_dump(mode="json"),
                "matches": [m.model_dump(mode="json") for m in search_response.matches],
                "truncated": search_response.truncated,
            },
            indent=2,
        )
        return ExportResponse(content=content, filename=f"log-export-{timestamp}.json", export_format="json")

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=["file_path", "line_number", "timestamp", "message"])
    writer.writeheader()
    for m in search_response.matches:
        writer.writerow(
            {
                "file_path": m.file_path,
                "line_number": m.line_number,
                "timestamp": m.timestamp.isoformat() if m.timestamp else "",
                "message": m.message,
            }
        )

    return ExportResponse(content=output.getvalue(), filename=f"log-export-{timestamp}.csv", export_format="csv")
