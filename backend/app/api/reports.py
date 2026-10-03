from __future__ import annotations

from datetime import datetime
from typing import Literal

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    Response,
    status,
)
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.repositories.supabase_reports import (
    get_report_by_id,
    list_reports as repository_list_reports,
)
from app.repositories.supabase_transactions import (
    SupabaseConfigurationError,
    SupabasePersistenceError,
)
from app.services.audit_reports import (
    build_report_csv,
    generate_daily_report,
)


router = APIRouter(
    prefix="/reports",
    tags=["reports"],
)


class ReportGenerationRequest(BaseModel):
    type: Literal["DAILY"]
    period_start: datetime
    period_end: datetime


@router.get("")
async def get_reports(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
) -> dict[str, object]:
    try:
        reports, total = await run_in_threadpool(
            repository_list_reports,
            page=page,
            page_size=page_size,
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Report storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Reports could not be retrieved.",
        ) from exc

    return {
        "items": reports,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_report(
    request: ReportGenerationRequest,
) -> dict[str, object]:
    try:
        return await run_in_threadpool(
            generate_daily_report,
            period_start=request.period_start,
            period_end=request.period_end,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Report storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Report could not be generated.",
        ) from exc


@router.get("/{report_id}/download")
async def download_report(report_id: str) -> Response:
    try:
        report = await run_in_threadpool(
            get_report_by_id,
            report_id,
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Report storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Report could not be downloaded.",
        ) from exc

    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Report not found.",
        )

    if report.get("status") != "COMPLETED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Report is not ready for download.",
        )

    try:
        content = build_report_csv(report)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc

    return Response(
        content=content,
        media_type="text/csv",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{report_id}.csv"'
            )
        },
    )
