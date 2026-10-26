"""Application-session reads of explicitly assigned feed evidence."""
from uuid import UUID
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from app.repositories import identity
from app.repositories.supabase_transactions import SupabaseConfigurationError
from app.services.identity import get_current_user
from app.services.feed_exception_report import build_exception_export
from app.services.feed_summary_report import build_summary_export
from app.services.feed_review_availability import enabled as feed_review_enabled

router = APIRouter(prefix="/feed-review", tags=["feed-review"])


async def read(name, user, **values):
    if not feed_review_enabled():
        raise HTTPException(404, detail='FEED_REVIEW_DISABLED')
    try:
        return await run_in_threadpool(identity.rpc, name, p_actor=user["id"], **values)
    except identity.IdentityError as exc:
        raise HTTPException(exc.status, detail=exc.code) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(503, detail="FEED_REVIEW_UNAVAILABLE") from exc


@router.get('/capabilities')
async def capabilities(response: Response, user: dict = Depends(get_current_user)):
    response.headers['Cache-Control'] = 'no-store'
    return {'enabled': feed_review_enabled() and user['role'] in ('ADMIN', 'SUPERVISOR', 'AUDITOR')}


@router.get("/sources")
async def sources(user: dict = Depends(get_current_user)):
    return {"items": await read("list_review_feed_sources", user)}


@router.get("/transactions")
async def transactions(source_id: str = Query(min_length=1, max_length=128),
                       page: int = Query(1, ge=1, le=1000000),
                       page_size: int = Query(25, ge=1, le=100),
                       user: dict = Depends(get_current_user)):
    return await read("read_review_feed", user, p_source=source_id, p_page=page, p_page_size=page_size)


@router.get("/transactions/{transaction_id}")
async def detail(transaction_id: UUID, source_id: str = Query(min_length=1, max_length=128),
                 user: dict = Depends(get_current_user)):
    result = await read("read_review_feed", user, p_source=source_id, p_id=str(transaction_id))
    if not result["items"]:
        raise HTTPException(404, detail="NOT_FOUND")
    return result["items"][0]


@router.get('/exceptions')
async def exceptions(source_id: str = Query(min_length=1, max_length=128),
                     page: int = Query(1, ge=1, le=1000000), page_size: int = Query(25, ge=1, le=100),
                     user: dict = Depends(get_current_user)):
    return await read('read_feed_exceptions', user, p_source=source_id, p_page=page, p_page_size=page_size)


@router.get('/exception-teams')
async def exception_teams(source_id: str = Query(min_length=1, max_length=128), user: dict = Depends(get_current_user)):
    return {'items': await read('list_feed_exception_teams', user, p_source=source_id)}


async def exception_record(transaction_id, source_id, user):
    result = await read('read_feed_exceptions', user, p_source=source_id, p_id=str(transaction_id))
    if not result['items']:
        raise HTTPException(404, detail='NOT_FOUND')
    return result['items'][0]


@router.get('/exceptions/{transaction_id}')
async def exception_detail(transaction_id: UUID, source_id: str = Query(min_length=1, max_length=128),
                           user: dict = Depends(get_current_user)):
    return await exception_record(transaction_id, source_id, user)


class ExceptionAction(BaseModel):
    model_config = ConfigDict(extra='forbid')
    source_id: str = Field(min_length=1, max_length=128)
    action: Literal['ASSIGN', 'START_REVIEW', 'NOTE', 'CLOSE', 'REOPEN']
    expected_version: int = Field(ge=0)
    note: str = Field(min_length=1, max_length=2000)
    team_id: UUID | None = None
    resolution: Literal['CONFIRMED_EXCEPTION', 'DISMISSED'] | None = None

    @field_validator('note')
    @classmethod
    def review_note(cls, value):
        value = value.strip()
        if not value or any((ord(char) < 32 or ord(char) == 127) and char not in '\n\r\t' for char in value):
            raise ValueError('A non-empty review note without control characters is required.')
        return value


@router.post('/exceptions/{transaction_id}/actions')
async def exception_action(transaction_id: UUID, request: ExceptionAction, user: dict = Depends(get_current_user)):
    return await read('act_on_feed_exception', user, p_source=request.source_id, p_id=str(transaction_id),
                      p_action=request.action, p_expected_version=request.expected_version, p_note=request.note,
                      p_team=str(request.team_id) if request.team_id else None, p_resolution=request.resolution)


@router.get('/exceptions/{transaction_id}/download')
async def exception_download(transaction_id: UUID, source_id: str = Query(min_length=1, max_length=128),
                             format: Literal['html', 'xlsx', 'pdf'] = 'html', user: dict = Depends(get_current_user)):
    if user['role'] not in ('ADMIN', 'SUPERVISOR'):
        raise HTTPException(403, detail='FORBIDDEN')
    record = await exception_record(transaction_id, source_id, user)
    content, media_type = await run_in_threadpool(build_exception_export, record, format)
    return Response(content, media_type=media_type, headers={
        'Content-Disposition': f'attachment; filename="Feed-Exception-{transaction_id}.{format}"',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    })


async def summary_record(user, source_id, period_start, period_end, team_id):
    if user['role'] not in ('ADMIN', 'SUPERVISOR'):
        raise HTTPException(403, detail='FORBIDDEN')
    if ((period_start is None) != (period_end is None)
            or any(value is not None and (value.tzinfo is None or value.utcoffset() is None)
                   for value in (period_start, period_end))
            or (period_start is not None and period_start >= period_end)):
        raise HTTPException(422, detail='Supply an ordered pair of timezone-aware period boundaries, or neither.')
    return await read('read_feed_summary_report', user, p_source=source_id,
                      p_start=period_start.isoformat() if period_start else None,
                      p_end=period_end.isoformat() if period_end else None,
                      p_team=str(team_id) if team_id else None)


@router.get('/summary')
async def summary(source_id: str = Query(min_length=1, max_length=128), period_start: datetime | None = None,
                  period_end: datetime | None = None, team_id: UUID | None = None,
                  user: dict = Depends(get_current_user)):
    return await summary_record(user, source_id, period_start, period_end, team_id)


@router.get('/summary/download')
async def summary_download(source_id: str = Query(min_length=1, max_length=128),
                           format: Literal['html', 'xlsx', 'pdf'] = 'html', period_start: datetime | None = None,
                           period_end: datetime | None = None, team_id: UUID | None = None,
                           user: dict = Depends(get_current_user)):
    report = await summary_record(user, source_id, period_start, period_end, team_id)
    content, media_type = await run_in_threadpool(build_summary_export, report, format)
    return Response(content, media_type=media_type, headers={
        'Content-Disposition': f'attachment; filename="Feed-Summary.{format}"',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    })
