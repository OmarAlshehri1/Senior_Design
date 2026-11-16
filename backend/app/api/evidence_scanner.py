"""Scoped machine API for a trusted external scanner; no human account impersonation."""
import hashlib
import hmac
import json
import os
import re
from pathlib import PurePosixPath
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from app.repositories import case_storage, identity


def scanner_auth(authorization: str | None = Header(default=None)):
    expected = os.getenv('CASE_SCANNER_TOKEN_SHA256', '')
    if (os.getenv('CASE_EVIDENCE_QUARANTINE_ENABLED', 'false').lower() != 'true'
            or not re.fullmatch(r'[0-9a-f]{64}', expected)
            or os.getenv('CASE_EVIDENCE_BUCKET') != 'case-evidence-private'):
        raise HTTPException(503, detail='SCANNER_NOT_CONFIGURED')
    parts = (authorization or '').split()
    if len(parts) != 2 or parts[0].lower() != 'bearer' or not 32 <= len(parts[1]) <= 512:
        raise HTTPException(401, detail='SCANNER_UNAUTHORIZED')
    actual = hashlib.sha256(parts[1].encode()).hexdigest()
    if not hmac.compare_digest(actual, expected):
        raise HTTPException(401, detail='SCANNER_UNAUTHORIZED')


router = APIRouter(prefix='/internal/evidence-scans', dependencies=[Depends(scanner_auth)],
                   tags=['internal-evidence-scanner'])


class ScanProof(BaseModel):
    model_config = ConfigDict(extra='forbid')
    engine_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    database: dict[str, str] = Field(min_length=3, max_length=3)


class Finish(BaseModel):
    model_config = ConfigDict(extra='forbid')
    lease_token: UUID
    content_sha256: str = Field(pattern=r'^[0-9a-f]{64}$')
    scan_status: Literal['CLEAN', 'INFECTED', 'ERROR']
    proof: ScanProof


async def rpc(name, **values):
    try:
        return await run_in_threadpool(identity.rpc, name, **values)
    except identity.IdentityError as error:
        raise HTTPException(error.status, detail=error.code) from None


@router.get('/status')
async def status():
    host = urlsplit(os.getenv('SUPABASE_URL', '')).hostname or ''
    return {'project_ref': host.split('.')[0] if host.endswith('.supabase.co') else None,
            'bucket_private': await run_in_threadpool(case_storage.bucket_available, 'case-evidence-private'),
            'worker_protocol': 1}


@router.post('/claim')
async def claim():
    metadata = await rpc('claim_case_evidence_scan_job')
    if metadata:
        metadata.pop('storage_key', None)
    return metadata


@router.get('/{evidence_id}/content')
async def content(evidence_id: UUID, lease: UUID = Header(alias='X-Scan-Lease')):
    metadata = await rpc('read_claimed_case_evidence_scan', p_evidence=str(evidence_id), p_lease=str(lease))
    key = metadata['storage_key']
    parts = PurePosixPath(key).parts
    if (len(parts) < 3 or parts[0] != 'quarantine' or parts[1] != str(metadata['case_id'])
            or '..' in parts or '\\' in key or not 0 < metadata['file_size'] <= 5 * 1024 * 1024):
        raise HTTPException(503, detail='QUARANTINE_METADATA_INVALID')
    try:
        data, content_type = await run_in_threadpool(case_storage.download, 'case-evidence-private', key)
    except identity.IdentityError as error:
        raise HTTPException(error.status, detail=error.code) from None
    if (len(data) != metadata['file_size'] or content_type.split(';', 1)[0].lower() != metadata['mime_type']
            or hashlib.sha256(data).hexdigest() != metadata['content_sha256']):
        raise HTTPException(503, detail='EVIDENCE_STORAGE_INTEGRITY_ERROR')
    return Response(data, media_type='application/octet-stream',
                    headers={'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'})


@router.post('/{evidence_id}/finish')
async def finish(evidence_id: UUID, request: Request):
    # Authenticate before reading; never buffer an unbounded JSON request.
    raw = bytearray()
    async for part in request.stream():
        if len(raw) + len(part) > 8192:
            raise HTTPException(413, detail='SCANNER_RESULT_TOO_LARGE')
        raw.extend(part)
    try:
        body = Finish.model_validate_json(raw)
        if any(not re.fullmatch(r'(main|daily|bytecode)\.(cvd|cld)', name)
               or not re.fullmatch(r'[0-9a-f]{64}', value) for name, value in body.proof.database.items()):
            raise ValueError('Invalid definitions proof')
        if {name.split('.')[0] for name in body.proof.database} != {'main', 'daily', 'bytecode'}:
            raise ValueError('Incomplete definitions proof')
    except (ValidationError, ValueError):
        raise HTTPException(422, detail='INVALID_SCANNER_RESULT') from None
    return await rpc('finish_claimed_case_evidence_scan', p_evidence=str(evidence_id),
                     p_lease=str(body.lease_token), p_sha256=body.content_sha256,
                     p_status=body.scan_status, p_proof=body.proof.model_dump())
