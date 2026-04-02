from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class DateRange(BaseModel):
    start: datetime | None = None
    end: datetime | None = None

    @model_validator(mode="after")
    def validate_range(self) -> "DateRange":
        if self.start and self.end and self.start > self.end:
            raise ValueError("start must be less than or equal to end")
        return self


class SearchFilters(BaseModel):
    keyword: str = ""
    terms: list[str] = Field(default_factory=list)
    terms_operator: Literal["and", "or"] = "and"
    regex_mode: bool = False
    case_insensitive: bool = True


class ScanRequest(BaseModel):
    subfolder: str = ""
    include_extensions: list[str] = Field(default_factory=lambda: [".log", ".txt", ".gz"])


class SearchRequest(ScanRequest):
    date_range: DateRange | None = None
    filters: SearchFilters = Field(default_factory=SearchFilters)
    context_lines: int = Field(default=0, ge=0, le=50)
    max_results: int = Field(default=1000, ge=1, le=100000)


class ExportRequest(SearchRequest):
    export_format: Literal["json", "csv"] = "json"


class ContextLine(BaseModel):
    line_number: int
    message: str


class LogMatch(BaseModel):
    file_path: str
    line_number: int
    timestamp: datetime | None = None
    message: str
    context_before: list[ContextLine] = Field(default_factory=list)
    context_after: list[ContextLine] = Field(default_factory=list)


class SummaryStats(BaseModel):
    total_files_scanned: int = 0
    total_lines_scanned: int = 0
    total_matches: int = 0
    top_patterns: list[tuple[str, int]] = Field(default_factory=list)


class SearchResponse(BaseModel):
    matches: list[LogMatch]
    summary: SummaryStats
    truncated: bool = False


class ExportResponse(BaseModel):
    content: str
    filename: str
    export_format: Literal["json", "csv"]


class HealthResponse(BaseModel):
    status: str


class ScanRootConfigResponse(BaseModel):
    scan_root: str
    exists: bool
    readable: bool
    total_files_under_root: int = 0
