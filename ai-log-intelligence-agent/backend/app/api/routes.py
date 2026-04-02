from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    ExportRequest,
    ExportResponse,
    HealthResponse,
    ScanRequest,
    ScanRootConfigResponse,
    SearchRequest,
    SearchResponse,
)
from app.services.export_service import export_results
from app.services.folder_scanner_service import scan_log_files, scan_root_metadata
from app.services.search_service import search_logs

router = APIRouter()


@router.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@router.get("/config", response_model=ScanRootConfigResponse)
def config() -> ScanRootConfigResponse:
    return ScanRootConfigResponse(**scan_root_metadata())


@router.post("/scan")
def scan(payload: ScanRequest):
    try:
        files = scan_log_files(payload.subfolder, payload.include_extensions)
        return {"total_files": len(files), "files": [str(p) for p in files[:500]]}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/search", response_model=SearchResponse)
def search(payload: SearchRequest) -> SearchResponse:
    try:
        return search_logs(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/export", response_model=ExportResponse)
def export(payload: ExportRequest) -> ExportResponse:
    try:
        return export_results(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
