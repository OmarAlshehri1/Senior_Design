from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from app.repositories import analytics, identity
from app.services.identity import get_current_user, require_roles

router = APIRouter(tags=["analytics"], dependencies=[Depends(get_current_user)])
AllowedRoles = Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))


async def _call(operation, **values):
    try:
        return await run_in_threadpool(operation, **values)
    except identity.IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc


@router.get("/dashboard/summary", dependencies=[AllowedRoles])
async def get_dashboard_summary(user: dict = Depends(get_current_user)):
    return await _call(analytics.get_dashboard_summary, actor_id=user["id"])


@router.get("/audit-rules", dependencies=[AllowedRoles])
async def get_audit_rules():
    return await run_in_threadpool(analytics.list_audit_rules)


@router.get("/analytics", dependencies=[AllowedRoles])
async def get_analytics(
    period: Literal["7_DAYS", "30_DAYS", "90_DAYS"] = Query(default="30_DAYS"),
    user: dict = Depends(get_current_user),
):
    period_days = int(period.split("_", 1)[0])
    return await _call(analytics.get_analytics, actor_id=user["id"], period_days=period_days)
