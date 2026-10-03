from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from starlette.concurrency import run_in_threadpool

from app.repositories import identity
from app.services.identity import get_current_user, require_roles

router = APIRouter(prefix="/teams", tags=["teams"], dependencies=[Depends(get_current_user)])


class TeamInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(min_length=1, max_length=120)
    supervisor_id: str


class TeamUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str | None = Field(default=None, min_length=1, max_length=120)
    supervisor_id: str | None = None


class MembershipInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["ADD", "TRANSFER", "REMOVE"]
    user_id: str


def _rpc_error(exc: identity.IdentityError):
    raise HTTPException(status_code=exc.status, detail=exc.code) from exc


@router.get("", dependencies=[Depends(require_roles("SUPERVISOR", "ADMIN"))])
async def get_teams(user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(identity.rpc, "list_audit_teams", p_actor=user["id"])
    except identity.IdentityError as exc:
        _rpc_error(exc)


@router.get("/activity", dependencies=[Depends(require_roles("SUPERVISOR", "ADMIN"))])
async def get_team_activity(team_id: str | None = None, user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(identity.rpc, "get_team_activity", p_actor=user["id"], p_team_id=team_id)
    except identity.IdentityError as exc:
        _rpc_error(exc)


@router.get("/{team_id}/member-candidates", dependencies=[Depends(require_roles("SUPERVISOR", "ADMIN"))])
async def get_team_member_candidates(team_id: str, user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(identity.rpc, "list_team_member_candidates", p_actor=user["id"], p_team_id=team_id)
    except identity.IdentityError as exc:
        _rpc_error(exc)


@router.post("", dependencies=[Depends(require_roles("ADMIN"))])
async def create_team(request: TeamInput, user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(identity.rpc, "manage_audit_team", p_actor=user["id"],
            p_action="CREATE", p_name=request.name, p_supervisor_id=request.supervisor_id)
    except identity.IdentityError as exc:
        _rpc_error(exc)


@router.patch("/{team_id}", dependencies=[Depends(require_roles("ADMIN"))])
async def update_team(team_id: str, request: TeamUpdate, user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(identity.rpc, "manage_audit_team", p_actor=user["id"],
            p_action="UPDATE", p_team_id=team_id, p_name=request.name, p_supervisor_id=request.supervisor_id)
    except identity.IdentityError as exc:
        _rpc_error(exc)


@router.delete("/{team_id}", dependencies=[Depends(require_roles("ADMIN"))])
async def deactivate_team(team_id: str, user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(identity.rpc, "manage_audit_team", p_actor=user["id"],
            p_action="DEACTIVATE", p_team_id=team_id)
    except identity.IdentityError as exc:
        _rpc_error(exc)


@router.post("/{team_id}/members", dependencies=[Depends(require_roles("SUPERVISOR", "ADMIN"))])
async def update_team_member(team_id: str, request: MembershipInput, user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(identity.rpc, "set_audit_team_member", p_actor=user["id"],
            p_team_id=team_id, p_user_id=request.user_id, p_action=request.action)
    except identity.IdentityError as exc:
        _rpc_error(exc)
