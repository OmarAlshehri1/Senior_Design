from datetime import datetime
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

from app.repositories.identity import IdentityError
from app.repositories.supabase_transactions import SupabaseConfigurationError
from app.services.identity import get_current_user, require_roles
from app.services.business_reports import (
    generate_business_report, read_business_reports, render_business_html, build_business_workbook,
)
from app.services.business_report_pdf import build_business_pdf

router = APIRouter(prefix='/reports/business', tags=['business reports'],
                   dependencies=[Depends(require_roles('ADMIN', 'SUPERVISOR'))])


class BusinessReportRequest(BaseModel):
    model_config = ConfigDict(extra='forbid')
    period_start: datetime | None = None
    period_end: datetime | None = None
    recipient: str = Field(default='Management and Audit Supervisor', min_length=1, max_length=200)
    sender: str = Field(default='Continuous Auditing System — automated preparation', min_length=1, max_length=200)
    data_context: Literal['DEMONSTRATION', 'OPERATIONAL', 'UNVERIFIED'] = 'UNVERIFIED'
    use_gemini: bool = True

    @field_validator('recipient', 'sender')
    @classmethod
    def clean_text(cls, value):
        value = value.strip()
        if not value or any(ord(c)<32 for c in value):
            raise ValueError('A non-empty single-line label is required.')
        return value

    @model_validator(mode='after')
    def paired_period(self):
        if (self.period_start is None) != (self.period_end is None):
            raise ValueError('Supply both period boundaries, or neither for latest activity.')
        return self


async def _call(function, **kwargs):
    try:
        return await run_in_threadpool(function, **kwargs)
    except IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(status_code=503, detail='Report storage is not configured.') from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post('', status_code=201)
async def create_business_report(request: BusinessReportRequest, user: dict = Depends(get_current_user)):
    return await _call(generate_business_report, actor_id=user['id'], **request.model_dump())


@router.get('')
async def list_business_reports(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                                user: dict = Depends(get_current_user)):
    return await _call(read_business_reports, actor_id=user['id'], page=page, page_size=page_size)


async def _report(report_id: UUID, user: dict):
    report = await _call(read_business_reports, actor_id=user['id'], report_id=report_id)
    if not report:
        raise HTTPException(status_code=404, detail='Report not found or no longer in your authorized scope.')
    return report


@router.get('/{report_id}')
async def get_business_report(report_id: UUID, user: dict = Depends(get_current_user)):
    return await _report(report_id, user)


@router.get('/{report_id}/download')
async def download_business_report(report_id: UUID, format: Literal['html', 'xlsx', 'pdf'] = 'html',
                                    user: dict = Depends(get_current_user)):
    report = await _report(report_id, user)
    renderer = {'html': render_business_html, 'xlsx': build_business_workbook, 'pdf': build_business_pdf}[format]
    content = await run_in_threadpool(renderer, report)
    return Response(content=content,
        media_type={'html': 'text/html', 'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                    'pdf': 'application/pdf'}[format],
        headers={'Content-Disposition': f'attachment; filename="BR-{report_id}.{format}"',
                 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})
