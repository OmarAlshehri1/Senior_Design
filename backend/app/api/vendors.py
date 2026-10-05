from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.repositories import identity, vendors
from app.services.identity import get_current_user, require_roles

router = APIRouter(prefix="/vendors", tags=["vendors"], dependencies=[Depends(get_current_user)])


class VendorRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    reason: str = Field(min_length=1, max_length=2000)


class VendorDecision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approve: bool
    note: str | None = Field(default=None, max_length=2000)


class VendorChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["REMOVE_WATCHLIST", "UNBLOCK"]
    note: str | None = Field(default=None, max_length=2000)


async def _call(operation, **values):
    try:
        return await run_in_threadpool(operation, **values)
    except identity.IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc


@router.get("", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def list_vendors(
    page: int = Query(default=1, ge=1), page_size: int = Query(default=25, ge=1, le=100),
    status: Literal["NORMAL", "WATCHLISTED", "BLOCKED"] | None = None,
    search: str | None = Query(default=None, max_length=100),
    risk: Literal["LOW", "MEDIUM", "HIGH"] | None = None,
    user: dict = Depends(get_current_user),
):
    return await _call(vendors.list_vendors, actor_id=user["id"], page=page,
                       page_size=page_size, status=status, search=search, risk=risk)


@router.get("/{vendor_id}", dependencies=[Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))])
async def get_vendor(vendor_id: str, user: dict = Depends(get_current_user)):
    return await _call(vendors.get_vendor, actor_id=user["id"], vendor_id=vendor_id)


@router.post("/{vendor_id}/watchlist-requests", dependencies=[Depends(require_roles("AUDITOR"))])
async def request_watchlist(vendor_id: str, request: VendorRequest, user: dict = Depends(get_current_user)):
    return await _call(vendors.request, actor_id=user["id"], vendor_id=vendor_id,
                       request_type="WATCHLIST", reason=request.reason)


@router.post("/{vendor_id}/block-requests", dependencies=[Depends(require_roles("SUPERVISOR"))])
async def request_block(vendor_id: str, request: VendorRequest, user: dict = Depends(get_current_user)):
    return await _call(vendors.request, actor_id=user["id"], vendor_id=vendor_id,
                       request_type="BLOCK", reason=request.reason)


@router.post("/requests/{request_id}/decision", dependencies=[Depends(require_roles("SUPERVISOR", "ADMIN"))])
async def decide_request(request_id: UUID, request: VendorDecision, user: dict = Depends(get_current_user)):
    return await _call(vendors.decide, actor_id=user["id"], request_id=str(request_id),
                       approve=request.approve, note=request.note)


@router.post("/{vendor_id}/monitoring", dependencies=[Depends(require_roles("SUPERVISOR", "ADMIN"))])
async def update_monitoring(vendor_id: str, request: VendorChange, user: dict = Depends(get_current_user)):
    if request.action == "UNBLOCK" and user.get("role") != "ADMIN":
        raise HTTPException(status_code=403, detail="FORBIDDEN")
    return await _call(vendors.change, actor_id=user["id"], vendor_id=vendor_id,
                       action=request.action, note=request.note)
