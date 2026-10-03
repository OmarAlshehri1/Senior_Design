import os
from typing import Literal
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool
from starlette.responses import Response

from app.repositories import case_storage, cases, identity
from app.services.case_evidence import EvidenceError, MAX_EVIDENCE_BYTES, scan_clean_file, validate_filename
from app.services.identity import get_current_user, require_roles


router = APIRouter(prefix="/cases", tags=["cases"], dependencies=[Depends(get_current_user)])
CaseStatus = Literal["OPEN", "INVESTIGATING", "ESCALATED", "RESOLUTION_REQUESTED", "RESOLVED", "CLOSED"]
CasePriority = Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
ResolutionOutcome = Literal["NO_ISSUE_FOUND", "ISSUE_CONFIRMED", "FALSE_POSITIVE", "NEEDS_INVESTIGATION"]


class CaseCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_type: Literal["ALERT", "TRANSACTION"]
    source_id: str = Field(min_length=1, max_length=200)
    title: str = Field(min_length=1, max_length=200)
    description: str = Field(min_length=1, max_length=5000)
    priority: CasePriority
    department: str | None = Field(default=None, min_length=1, max_length=120)
    assigned_to_id: UUID | None = None


class CaseStatusInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: CaseStatus
    note: str | None = Field(default=None, max_length=2000)


class CaseAssignmentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    assignee_id: UUID
    note: str | None = Field(default=None, max_length=2000)


class CaseCommentInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: str = Field(min_length=1, max_length=4000)


class ClosureRequestInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    outcome: ResolutionOutcome
    note: str = Field(min_length=1, max_length=4000)
    evidence_summary: str | None = Field(default=None, min_length=1, max_length=2000)


class ClosureDecisionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approve: bool
    note: str | None = Field(default=None, max_length=2000)


def _raise_identity_error(exc: identity.IdentityError) -> None:
    raise HTTPException(status_code=exc.status, detail=exc.code) from exc


async def _rpc(operation, **values):
    try:
        return await run_in_threadpool(operation, **values)
    except identity.IdentityError as exc:
        _raise_identity_error(exc)


@router.get("", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def list_cases(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    status: CaseStatus | None = None,
    priority: CasePriority | None = None,
    search: str | None = Query(default=None, max_length=100),
    user: dict = Depends(get_current_user),
):
    return await _rpc(cases.list_cases, actor_id=user["id"], page=page,
                      page_size=page_size, status=status, priority=priority, search=search)


@router.get("/capabilities", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def get_case_capabilities():
    return await run_in_threadpool(cases.capabilities)


@router.post("", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def create_case(request: CaseCreate, user: dict = Depends(get_current_user)):
    return await _rpc(cases.create_case, actor_id=user["id"], p_source_type=request.source_type,
                      p_source_id=request.source_id, p_title=request.title, p_description=request.description,
                      p_priority=request.priority, p_department=request.department,
                      p_assigned_to=str(request.assigned_to_id) if request.assigned_to_id else None)


@router.get("/{case_id}", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def get_case(case_id: UUID, user: dict = Depends(get_current_user)):
    return await _rpc(cases.get_case, actor_id=user["id"], case_id=str(case_id))


@router.post("/{case_id}/status", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def update_case_status(case_id: UUID, request: CaseStatusInput, user: dict = Depends(get_current_user)):
    return await _rpc(cases.update_status, actor_id=user["id"], case_id=str(case_id),
                      status=request.status, note=request.note)


@router.post("/{case_id}/assignment", dependencies=[Depends(require_roles("SUPERVISOR", "ADMIN"))])
async def assign_case(case_id: UUID, request: CaseAssignmentInput, user: dict = Depends(get_current_user)):
    return await _rpc(cases.assign, actor_id=user["id"], case_id=str(case_id),
                      assignee_id=str(request.assignee_id), note=request.note)


@router.post("/{case_id}/comments", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def add_case_comment(case_id: UUID, request: CaseCommentInput, user: dict = Depends(get_current_user)):
    return await _rpc(cases.add_comment, actor_id=user["id"], case_id=str(case_id), message=request.message)


@router.post("/{case_id}/closure-request", dependencies=[Depends(require_roles("AUDITOR"))])
async def request_case_closure(case_id: UUID, request: ClosureRequestInput, user: dict = Depends(get_current_user)):
    return await _rpc(cases.request_closure, actor_id=user["id"], case_id=str(case_id),
                      outcome=request.outcome, note=request.note, evidence_summary=request.evidence_summary)


@router.post("/{case_id}/closure-decision", dependencies=[Depends(require_roles("SUPERVISOR", "ADMIN"))])
async def decide_case_closure(case_id: UUID, request: ClosureDecisionInput, user: dict = Depends(get_current_user)):
    return await _rpc(cases.decide_closure, actor_id=user["id"], case_id=str(case_id),
                      approve=request.approve, note=request.note)


@router.post("/{case_id}/evidence", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def upload_case_evidence(
    case_id: UUID,
    request: Request,
    file_name: str = Header(min_length=1, max_length=500, alias="X-File-Name"),
    category: Literal["DOCUMENT", "SCREENSHOT", "INVOICE", "APPROVAL_RECORD", "OTHER"] = Query(),
    description: str | None = Query(default=None, max_length=1000),
    user: dict = Depends(get_current_user),
):
    bucket = os.getenv("CASE_EVIDENCE_BUCKET", "").strip()
    if not bucket or not os.getenv("CASE_ANTIVIRUS_EXECUTABLE", "").strip():
        raise HTTPException(status_code=503, detail="EVIDENCE_STORAGE_OR_SCANNER_UNAVAILABLE")
    if not await run_in_threadpool(case_storage.bucket_available, bucket):
        raise HTTPException(status_code=503, detail="PRIVATE_EVIDENCE_BUCKET_UNAVAILABLE")
    case_id_text = str(case_id)
    case_bundle = await _rpc(cases.get_case, actor_id=user["id"], case_id=case_id_text)
    if case_bundle["case"].get("status") == "CLOSED":
        raise HTTPException(status_code=409, detail="CLOSED_CASE_READ_ONLY")
    content_length = request.headers.get("Content-Length")
    if content_length and content_length.isdigit() and int(content_length) > MAX_EVIDENCE_BYTES:
        await _rpc(cases.record_evidence_rejection, actor_id=user["id"], case_id=case_id_text, reason="SIZE_LIMIT")
        raise HTTPException(status_code=413, detail="EVIDENCE_SIZE_LIMIT")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_EVIDENCE_BYTES:
            await _rpc(cases.record_evidence_rejection, actor_id=user["id"], case_id=case_id_text, reason="SIZE_LIMIT")
            raise HTTPException(status_code=413, detail="EVIDENCE_SIZE_LIMIT")
        content.extend(chunk)
    try:
        safe_name, extension = validate_filename(file_name, request.headers.get("Content-Type", ""), bytes(content))
        await run_in_threadpool(scan_clean_file, bytes(content), extension)
    except EvidenceError as exc:
        if exc.reason:
            await _rpc(cases.record_evidence_rejection, actor_id=user["id"], case_id=case_id_text, reason=exc.reason)
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc

    evidence_id = str(uuid4())
    object_key = f"{case_id_text}/{evidence_id}{extension}"
    mime_type = request.headers.get("Content-Type", "").lower().split(";", 1)[0].strip()
    try:
        await run_in_threadpool(case_storage.upload, bucket, object_key, bytes(content), mime_type)
    except identity.IdentityError as exc:
        _raise_identity_error(exc)
    try:
        result = await _rpc(cases.add_evidence, actor_id=user["id"], case_id=case_id_text,
            p_file_name=safe_name, p_file_size=len(content), p_mime_type=mime_type,
            p_category=category, p_description=description, p_storage_key=object_key, p_scan_status="CLEAN")
    except HTTPException:
        try:
            await run_in_threadpool(case_storage.remove, bucket, object_key)
        except identity.IdentityError as cleanup_error:
            raise HTTPException(status_code=503, detail=cleanup_error.code) from cleanup_error
        raise
    result.pop("storage_key", None)
    return result


@router.get("/{case_id}/evidence/{evidence_id}", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def download_case_evidence(case_id: UUID, evidence_id: UUID, user: dict = Depends(get_current_user)):
    bucket = os.getenv("CASE_EVIDENCE_BUCKET", "").strip()
    if not bucket:
        raise HTTPException(status_code=503, detail="EVIDENCE_STORAGE_UNAVAILABLE")
    if not await run_in_threadpool(case_storage.bucket_available, bucket):
        raise HTTPException(status_code=503, detail="PRIVATE_EVIDENCE_BUCKET_UNAVAILABLE")
    metadata = await _rpc(cases.get_evidence, actor_id=user["id"], case_id=str(case_id), evidence_id=str(evidence_id))
    try:
        content, stored_type = await run_in_threadpool(case_storage.download, bucket, metadata["storage_key"])
    except identity.IdentityError as exc:
        _raise_identity_error(exc)
    if len(content) != metadata["file_size"] or stored_type.split(";", 1)[0].lower() != metadata["mime_type"]:
        raise HTTPException(status_code=503, detail="EVIDENCE_STORAGE_INTEGRITY_ERROR")
    return Response(content=content, media_type=metadata["mime_type"], headers={
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(metadata['file_name'], safe='')}",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
    })
