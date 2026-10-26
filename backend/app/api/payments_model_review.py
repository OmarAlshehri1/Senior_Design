"""Application-session endpoints for an explicitly enabled staging-only pilot."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from app.api.feed_review import read
from app.services.identity import get_current_user
from app.services import payments_model_review as store

router = APIRouter(prefix='/payments-model-review', tags=['payments-model-review'])


async def authorized(user):
    if user['role'] not in ('ADMIN', 'SUPERVISOR', 'AUDITOR'):
        raise HTTPException(403, 'FORBIDDEN')
    directory, data = await run_in_threadpool(store.package)
    sources = await read('list_review_feed_sources', user)
    if not any(source['id'] == data['source_id'] for source in sources):
        raise HTTPException(403, 'FORBIDDEN')
    return directory, data


async def server_read(user, dataset, **values):
    result = await read('read_model_reviews', user, p_dataset=dataset, **values)
    if (not isinstance(result, dict) or result.get('dataset_id') != dataset
            or result.get('source_id') != 'payments-file-local' or result.get('combined_risk') is not None):
        raise HTTPException(503, 'MODEL_REVIEW_BINDING_INVALID')
    return result


@router.get('/capabilities')
async def capabilities(response: Response, user: dict = Depends(get_current_user)):
    response.headers['Cache-Control'] = 'no-store'
    if user['role'] not in ('ADMIN', 'SUPERVISOR', 'AUDITOR'):
        return {'enabled': False}
    try:
        mode, dataset = store.storage_configuration()
        if mode == 'supabase':
            data = await server_read(user, dataset, p_page=1, p_page_size=1, p_case=None)
        else:
            _, data = await authorized(user)
    except HTTPException as exc:
        if exc.status_code in (403, 404):
            return {'enabled': False}
        raise
    return {'enabled': True, 'source_id': data['source_id'], 'dataset_id': data['dataset_id'],
            'storage': mode, 'experimental': True, 'inline_diagnostics': False}


@router.get('')
async def listing(response: Response, page: int = Query(1, ge=1, le=1000000),
                  page_size: int = Query(100, ge=1, le=100),
                  case_id: str | None = Query(None, min_length=1, max_length=128),
                  user: dict = Depends(get_current_user)):
    response.headers['Cache-Control'] = 'no-store'
    mode, dataset = store.storage_configuration()
    if user['role'] not in ('ADMIN', 'SUPERVISOR', 'AUDITOR'):
        raise HTTPException(403, 'FORBIDDEN')
    if mode == 'supabase':
        return await server_read(user, dataset, p_page=page, p_page_size=page_size, p_case=case_id)
    directory, data = await authorized(user)
    result = await run_in_threadpool(store.list_reviews, directory, data, user['id'])
    groups = []
    for nominated in (True, False):
        items = [i for i in result['items'] if bool(i.get('model_nominated')) == nominated]
        counts = {key: sum(i['review'].get('outcome') == outcome for i in items)
                  for key, outcome in [('yes', 'YES'), ('no', 'NO'), ('insufficient', 'INSUFFICIENT_INFORMATION')]}
        reviewed = sum(counts.values())
        groups.append(dict(nominated=nominated, total=len(items), reviewed=reviewed,
                           pending=len(items)-reviewed, **counts))
    items = [i for i in result['items'] if case_id is None or i['case_id'] == case_id]
    return {**result, 'items': items[(page-1)*page_size:page*page_size], 'total': len(items),
            'page': page, 'page_size': page_size, 'summary': groups}


class Review(BaseModel):
    model_config = ConfigDict(extra='forbid')
    outcome: Literal['YES', 'NO', 'INSUFFICIENT_INFORMATION']
    note: str = Field(min_length=1, max_length=2000)
    expected_version: int = Field(ge=0)

    @field_validator('note')
    @classmethod
    def meaningful_note(cls, value):
        value = value.strip()
        if not value or any((ord(c) < 32 or ord(c) == 127) and c not in '\n\r\t' for c in value):
            raise ValueError('Enter a review reason.')
        return value


@router.post('/{case_id}')
async def save(case_id: str, request: Review, response: Response, user: dict = Depends(get_current_user)):
    response.headers['Cache-Control'] = 'no-store'
    mode, dataset = store.storage_configuration()
    if user['role'] not in ('ADMIN', 'SUPERVISOR', 'AUDITOR'):
        raise HTTPException(403, 'FORBIDDEN')
    if mode == 'supabase':
        result = await server_read(user, dataset, p_case=case_id, p_page=1, p_page_size=1)
        if not result['items']:
            raise HTTPException(404, 'NOT_FOUND')
        try:
            return await read('save_model_review', user, p_dataset=dataset, p_case=case_id,
                              p_outcome=request.outcome, p_note=request.note,
                              p_expected_version=request.expected_version)
        except HTTPException as exc:
            if exc.status_code == 409:
                raise HTTPException(409, 'REVIEW_VERSION_CONFLICT') from None
            raise
    directory, data = await authorized(user)
    return await run_in_threadpool(store.save_review, directory, data, user['id'], case_id,
                                   request.outcome, request.note, request.expected_version)
