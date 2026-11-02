"""Company-session uploads; dedicated source-token JSON intake remains /ingestion/events."""
import os
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.repositories import identity
from app.repositories.supabase_transactions import SupabaseConfigurationError
from app.services.company_imports import MAX_FILE, MAX_ROWS, ImportProblem, parse_file, build_preview
from app.services.feed_review_availability import enabled as review_enabled
from app.services.feed_worker_wakeup import notify
from app.services.identity import get_current_user
from app.services.ingestion_mapping import MappingConfiguration

def private_response(response: Response):
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'


router = APIRouter(prefix="/company-imports", tags=["company-imports"], dependencies=[Depends(private_response)])


def enabled():
    return review_enabled() and all(os.getenv(key, "false").lower() == "true" for key in (
        "COMPANY_IMPORTS_ENABLED", "INGESTION_ENABLED", "INGESTION_VALIDATION_ENABLED", "INGESTION_AUDIT_ENABLED"))


async def admin(user=Depends(get_current_user)):
    if user["role"] != "ADMIN":
        raise HTTPException(403, detail="FORBIDDEN")
    if not enabled():
        raise HTTPException(404, detail="IMPORTS_DISABLED")
    return user


async def call(name, user, **payload):
    try:
        return await run_in_threadpool(identity.rpc, name, p_actor=user["id"], **payload)
    except identity.IdentityError as exc:
        raise HTTPException(exc.status, detail=exc.code) from None
    except SupabaseConfigurationError:
        raise HTTPException(503, detail="IMPORTS_UNAVAILABLE") from None


@router.get("/capabilities")
async def capabilities(response: Response, user=Depends(get_current_user)):
    response.headers["Cache-Control"] = "no-store"
    return {"enabled": enabled() and user["role"] == "ADMIN", "formats": ["csv", "xlsx"], "max_rows": MAX_ROWS, "max_bytes": MAX_FILE}


@router.get("/sources")
async def sources(user=Depends(admin)):
    return {"items": await call("list_company_import_sources", user)}


@router.get("/history")
async def history(source_id: str = Query(min_length=1, max_length=128), user=Depends(admin)):
    return await call("company_import_history", user, p_source=source_id)


@router.post("/uploads", status_code=201)
async def upload(request: Request, source_id: str = Query(min_length=1, max_length=128),
                 filename: str = Query(min_length=1, max_length=200), sheet: str | None = Query(None, max_length=128), user=Depends(admin)):
    # Check authorization before parsing potentially expensive untrusted input.
    await call("company_import_history", user, p_source=source_id)
    if request.headers.get("content-encoding", "identity").lower() != "identity":
        raise HTTPException(415, detail="Compressed request bodies are unsupported.")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_FILE:
            raise HTTPException(413, detail=f"Upload a file no larger than {MAX_FILE // (1024 * 1024)} MiB.")
        content.extend(chunk)
    try:
        document = await run_in_threadpool(parse_file, bytes(content), filename, sheet)
    except ImportProblem as exc:
        raise HTTPException(422, detail=str(exc)) from None
    batch = await call("store_company_import", user, p_source=source_id, p_document=document)
    return {"id": batch, **{key: document[key] for key in ("filename", "sheet", "sheets", "columns")},
            "total": len(document["records"]), "sample": document["records"][:5]}


class PreviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str = Field(min_length=1, max_length=128)
    identity_column: str = Field(min_length=1, max_length=128)
    mapping: MappingConfiguration


@router.post("/{batch_id}/preview")
async def preview(batch_id: UUID, body: PreviewRequest, user=Depends(admin)):
    batch = await call("get_company_import", user, p_source=body.source_id, p_id=str(batch_id))
    try:
        result = await run_in_threadpool(build_preview, batch["document"], body.mapping, body.identity_column)
    except ImportProblem as exc:
        raise HTTPException(422, detail=str(exc)) from None
    return await call("preview_company_import", user, p_source=body.source_id, p_id=str(batch_id), p_preview=result)


class Confirmation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str = Field(min_length=1, max_length=128)
    revision: str = Field(pattern="^[0-9a-f]{64}$")
    profile_name: str | None = Field(None, min_length=1, max_length=80)


@router.post("/{batch_id}/confirm")
async def confirm(batch_id: UUID, body: Confirmation, user=Depends(admin)):
    result = await call("confirm_company_import", user, p_source=body.source_id, p_id=str(batch_id),
                        p_revision=body.revision, p_profile=body.profile_name)
    notify("validation")
    return {"inserted": result["inserted"], "duplicates": result["duplicates"]}


@router.get("/{batch_id}/progress")
async def progress(batch_id: UUID, source_id: str = Query(min_length=1, max_length=128), user=Depends(admin)):
    return await call("company_import_progress", user, p_source=source_id, p_id=str(batch_id))
