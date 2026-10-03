from datetime import date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.repositories import accountability, identity
from app.repositories.supabase_transactions import SupabaseConfigurationError
from app.services.identity import get_current_user, require_roles


router = APIRouter(tags=["accountability"], dependencies=[Depends(get_current_user)])
ReviewerResource = Literal["TRANSACTION", "ALERT"]
ReviewAction = Literal["REVIEWED", "REOPENED", "NOTE_ADDED"]


class ReviewActionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: ReviewAction
    note: str | None = Field(default=None, max_length=2000)


@router.post("/reviews/{resource_type}/{resource_id}", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def record_review(resource_type: ReviewerResource, resource_id: str,
                        request: ReviewActionInput, user: dict = Depends(get_current_user)):
    try:
        row = await run_in_threadpool(
            accountability.record_review, actor_id=user["id"], resource_type=resource_type,
            resource_id=resource_id, action=request.action, note=request.note,
        )
        return {"record": row["record"],
                "status": row.get("transaction_review_status"),
                "alert": row.get("alert")}
    except identity.IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(status_code=503, detail="ACCOUNTABILITY_UNAVAILABLE") from exc

@router.get("/reviews/{resource_type}/{resource_id}", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def get_review_history(resource_type: ReviewerResource, resource_id: str,
                             page: int = Query(default=1, ge=1),
                             page_size: int = Query(default=25, ge=1, le=100),
                             user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(
            accountability.review_history, resource_type=resource_type,
            resource_id=resource_id, actor_id=user["id"], page=page, page_size=page_size,
        )
    except identity.IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(status_code=503, detail="ACCOUNTABILITY_UNAVAILABLE") from exc


@router.get("/audit-events", dependencies=[Depends(require_roles("SUPERVISOR", "ADMIN"))])
async def get_audit_events(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    actor: str | None = Query(default=None, max_length=100),
    search: str | None = Query(default=None, max_length=100),
    action: str | None = Query(default=None, min_length=1, max_length=80),
    resource_type: str | None = Query(default=None, min_length=1, max_length=40),
    outcome: Literal["SUCCESS", "FAILED", "DENIED"] | None = None,
    date_filter: date | None = Query(default=None, alias="date"),
    sort: Literal["NEWEST", "OLDEST"] = "NEWEST",
    user: dict = Depends(get_current_user),
):
    try:
        return await run_in_threadpool(
            accountability.list_audit_events, page=page, page_size=page_size,
            actor=actor, action=action, resource_type=resource_type,
            outcome=outcome, date=date_filter.isoformat() if date_filter else None,
            search=search,
            actor_id=user["id"],
            sort=sort,
        )
    except identity.IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(status_code=503, detail="ACCOUNTABILITY_UNAVAILABLE") from exc
