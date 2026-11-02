"""Phase-one source intake. Deliberately disconnected from canonical processing."""
import hashlib
import json
import os
import re
from time import monotonic, perf_counter
from typing import Any
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from app.repositories import ingestion as repository
from app.repositories.supabase_transactions import SupabaseConfigurationError, SupabasePersistenceError
from app.services.ingestion_payload import MAX_BODY, parse_envelope, fingerprint_value
from app.services.feed_worker_wakeup import notify

router = APIRouter(prefix="/ingestion", tags=["ingestion"])
_timing_instance = uuid4().hex
_timing_started = monotonic()


def record_timing(request: Request, phase: str, started: float) -> None:
    timings = getattr(request.state, "ingestion_timings", None)
    if timings is not None:
        timings[phase] = (perf_counter() - started) * 1000


def attach_timings(request: Request, response: Response) -> None:
    timings = getattr(request.state, "ingestion_timings", None)
    if timings is not None:
        record_timing(request, "app", request.state.ingestion_started)
        response.headers["Server-Timing"] = ", ".join(
            f"{phase};dur={elapsed:.3f}" for phase, elapsed in timings.items())
        response.headers["X-Ingestion-Instance"] = _timing_instance
        response.headers["X-Ingestion-Uptime"] = f"{monotonic() - _timing_started:.3f}"


async def timed_call(request: Request, phase: str, name: str, **payload: Any) -> Any:
    started = perf_counter()
    try:
        return await call(name, **payload)
    finally:
        record_timing(request, phase, started)


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
    if os.getenv("INGESTION_TIMING_ENABLED", "false").lower() == "true":
        request.state.ingestion_started = perf_counter()
        request.state.ingestion_timings = {}
    if os.getenv("INGESTION_ENABLED", "false").lower() != "true":
        raise HTTPException(404, detail="Not found")
    authorization = request.headers.get("authorization", "")
    # Provision secrets with secrets.token_urlsafe(32); hash with SHA-256 offline.
    match = re.fullmatch(r"Bearer ([A-Za-z0-9_-]{43,128})", authorization)
    if not match:
        raise HTTPException(401, detail={"code": "SOURCE_CREDENTIAL_REQUIRED"})
    digest = hashlib.sha256(match[1].encode("ascii")).hexdigest()
    registered = await timed_call(request, "auth_rpc", "ingestion_source", p_credential_hash=digest)
    if not isinstance(registered, dict) or not isinstance(registered.get("source_id"), str):
        raise HTTPException(401, detail={"code": "UNAUTHORIZED"})
    return digest, registered["source_id"]


@router.post("/events")
async def receive_event(request: Request, identity: tuple[str, str] = Depends(source)):
    parse_started = perf_counter()
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
    record_timing(request, "parse", parse_started)
    result = await timed_call(request, "persist_rpc", "submit_ingestion_event", p_credential_hash=digest,
                        p_payload_text=body.decode("utf-8"), p_fingerprint=fingerprint)
    if not isinstance(result, dict) or not isinstance(result.get("duplicate"), bool):
        raise HTTPException(503, detail={"code": "INVALID_STORAGE_RESPONSE"})
    notify("validation")
    response = JSONResponse(result, status_code=200 if result["duplicate"] else 202)
    attach_timings(request, response)
    return response


@router.get("/receipts")
async def find_receipt(request: Request, response: Response, event_id: str = Query(min_length=1, max_length=128),
                       identity: tuple[str, str] = Depends(source)):
    result = await timed_call(request, "read_rpc", "read_ingestion_receipts", p_credential_hash=identity[0], p_event_id=event_id)
    attach_timings(request, response)
    return {"items": [result] if result else [], "total": int(result is not None)}


@router.get("/receipts/{receipt_id}")
async def read_receipt(receipt_id: UUID, request: Request, response: Response, identity: tuple[str, str] = Depends(source)):
    result = await timed_call(request, "read_rpc", "read_ingestion_receipts", p_credential_hash=identity[0], p_receipt_id=str(receipt_id))
    if result is None:
        raise HTTPException(404, detail={"code": "RECEIPT_NOT_FOUND"})
    attach_timings(request, response)
    return result
