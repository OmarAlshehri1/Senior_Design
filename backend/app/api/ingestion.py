"""Phase-one source intake. Deliberately disconnected from canonical processing."""
import hashlib
import json
import os
import re
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.repositories import ingestion as repository
from app.repositories.supabase_transactions import SupabaseConfigurationError, SupabasePersistenceError
from app.services.ingestion_payload import MAX_BODY, parse_envelope, fingerprint_value
from app.services.feed_worker_wakeup import notify

router = APIRouter(prefix="/ingestion", tags=["ingestion"])


async def call(name: str, **payload: Any) -> Any:
    try:
        result = await run_in_threadpool(repository.rpc, name, payload)
    except (SupabaseConfigurationError, SupabasePersistenceError):
        raise HTTPException(503, detail={"code": "STORAGE_UNAVAILABLE"}) from None
    if isinstance(result, dict) and "error" in result:
        code = result["error"]
        status = {"UNAUTHORIZED": 401, "SOURCE_MISMATCH": 403, "RATE_LIMITED": 429,
                  "EVENT_CONFLICT": 409, "RECORD_CONFLICT": 409}.get(code, 422)
        raise HTTPException(status, detail={"code": code},
                            headers={"Retry-After": "1"} if status == 429 else None)
    return result


async def source(request: Request) -> tuple[str, str]:
    if os.getenv("INGESTION_ENABLED", "false").lower() != "true":
        raise HTTPException(404, detail="Not found")
    authorization = request.headers.get("authorization", "")
    # Provision secrets with secrets.token_urlsafe(32); hash with SHA-256 offline.
    match = re.fullmatch(r"Bearer ([A-Za-z0-9_-]{43,128})", authorization)
    if not match:
        raise HTTPException(401, detail={"code": "SOURCE_CREDENTIAL_REQUIRED"})
    digest = hashlib.sha256(match[1].encode("ascii")).hexdigest()
    registered = await call("ingestion_source", p_credential_hash=digest)
    if not isinstance(registered, dict) or not isinstance(registered.get("source_id"), str):
        raise HTTPException(401, detail={"code": "UNAUTHORIZED"})
    return digest, registered["source_id"]


@router.post("/events")
async def receive_event(request: Request, identity: tuple[str, str] = Depends(source)):
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "application/json":
        raise HTTPException(415, detail={"code": "JSON_REQUIRED"})
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise HTTPException(415, detail={"code": "ENCODING_UNSUPPORTED"})
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_BODY:
            raise HTTPException(413, detail={"code": "PAYLOAD_TOO_LARGE"})
        body.extend(chunk)
    try:
        envelope = parse_envelope(bytes(body))
    except (ValueError, UnicodeError, RecursionError, OverflowError):
        raise HTTPException(422, detail={"code": "INVALID_ENVELOPE"}) from None
    digest, source_id = identity
    if envelope["source_id"] != source_id:
        raise HTTPException(403, detail={"code": "SOURCE_MISMATCH"})
    canonical = json.dumps(fingerprint_value(envelope), ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    fingerprint = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    result = await call("submit_ingestion_event", p_credential_hash=digest,
                        p_payload_text=body.decode("utf-8"), p_fingerprint=fingerprint)
    if not isinstance(result, dict) or not isinstance(result.get("duplicate"), bool):
        raise HTTPException(503, detail={"code": "INVALID_STORAGE_RESPONSE"})
    notify("validation")
    return JSONResponse(result, status_code=200 if result["duplicate"] else 202)


@router.get("/receipts")
async def find_receipt(event_id: str = Query(min_length=1, max_length=128),
                       identity: tuple[str, str] = Depends(source)):
    result = await call("read_ingestion_receipts", p_credential_hash=identity[0], p_event_id=event_id)
    return {"items": [result] if result else [], "total": int(result is not None)}


@router.get("/receipts/{receipt_id}")
async def read_receipt(receipt_id: UUID, identity: tuple[str, str] = Depends(source)):
    result = await call("read_ingestion_receipts", p_credential_hash=identity[0], p_receipt_id=str(receipt_id))
    if result is None:
        raise HTTPException(404, detail={"code": "RECEIPT_NOT_FOUND"})
    return result
