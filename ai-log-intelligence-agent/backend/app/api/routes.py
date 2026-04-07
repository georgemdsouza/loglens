from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.models.schemas import (
    ExportRequest,
    ExportResponse,
    HealthResponse,
    ScanRequest,
    ScanProgressResponse,
    ScanRootConfigResponse,
    SearchRequest,
    SearchResponse,
)
from app.services.export_service import export_results
from app.services.folder_scanner_service import resolve_scan_folder, scan_log_files, scan_root_metadata
from app.services.progress_service import get_progress, request_cancel
from app.services.search_service import SearchCancelledError, search_logs

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
        files = scan_log_files(payload.subfolder, payload.include_extensions, payload.selected_files)
        target = resolve_scan_folder(payload.subfolder)
        return {
            "total_files": len(files),
            "files": [
                {"path": str(p), "relative_path": str(p.relative_to(target)).replace("\\", "/")}
                for p in files[:2000]
            ],
        }
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/search-status", response_model=ScanProgressResponse)
def search_status(search_id: str) -> ScanProgressResponse:
    progress = get_progress(search_id)
    if not progress:
        return ScanProgressResponse(
            search_id=search_id,
            status="not_found",
            message="No scan status found for this search_id",
        )
    return ScanProgressResponse(**progress)


@router.post("/search", response_model=SearchResponse)
def search(payload: SearchRequest) -> SearchResponse:
    try:
        return search_logs(payload)
    except SearchCancelledError as exc:
        raise HTTPException(status_code=499, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/search-cancel")
def cancel_search(search_id: str):
    cancelled = request_cancel(search_id)
    if not cancelled:
        raise HTTPException(status_code=404, detail="search_id not found")
    return {"search_id": search_id, "status": "cancel_requested"}


@router.post("/export", response_model=ExportResponse)
def export(payload: ExportRequest) -> ExportResponse:
    try:
        return export_results(payload)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
