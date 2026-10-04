from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from app.repositories import identity, settings
from app.services.identity import get_current_user, require_roles

router = APIRouter(prefix="/settings", tags=["settings"], dependencies=[Depends(get_current_user)])
read_roles = Depends(require_roles("AUDITOR", "SUPERVISOR", "ADMIN"))
admin_role = Depends(require_roles("ADMIN"))


class OrganizationNameInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    organization_name: str = Field(min_length=2, max_length=120)

    @field_validator("organization_name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


async def _call(operation, **values):
    try:
        return await run_in_threadpool(operation, **values)
    except identity.IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc


@router.get("", dependencies=[read_roles])
async def get_settings(user: dict = Depends(get_current_user)):
    return await _call(settings.get_organization_settings, actor_id=user["id"])


@router.patch("/organization", dependencies=[admin_role])
async def update_organization(payload: OrganizationNameInput, user: dict = Depends(get_current_user)):
    return await _call(
        settings.update_organization_name,
        actor_id=user["id"],
        organization_name=payload.organization_name,
    )
