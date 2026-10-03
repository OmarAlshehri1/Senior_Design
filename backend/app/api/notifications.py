from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from starlette.concurrency import run_in_threadpool

from app.repositories import identity
from app.services.identity import get_current_user


router = APIRouter(
    prefix="/notifications",
    tags=["notifications"],
    dependencies=[Depends(get_current_user)],
)


def _raise_identity_error(exc: identity.IdentityError) -> None:
    raise HTTPException(status_code=exc.status, detail=exc.code) from exc


@router.get("")
async def list_notifications(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    unread_only: bool = False,
    user: dict = Depends(get_current_user),
) -> dict[str, object]:
    try:
        result = await run_in_threadpool(
            identity.rpc,
            "list_user_notifications",
            p_actor=user["id"],
            p_page=page,
            p_page_size=page_size,
            p_unread_only=unread_only,
        )
    except identity.IdentityError as exc:
        _raise_identity_error(exc)
    if not isinstance(result, dict) or not isinstance(result.get("items"), list):
        raise HTTPException(status_code=502, detail="NOTIFICATION_STORAGE_UNAVAILABLE")
    return result


@router.patch("/{notification_id}/read")
async def mark_notification_read(
    notification_id: UUID,
    user: dict = Depends(get_current_user),
) -> dict[str, object]:
    try:
        result = await run_in_threadpool(
            identity.rpc,
            "mark_user_notification_read",
            p_actor=user["id"],
            p_notification=str(notification_id),
        )
    except identity.IdentityError as exc:
        _raise_identity_error(exc)
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="NOTIFICATION_STORAGE_UNAVAILABLE")
    return result


@router.post("/read-all")
async def mark_all_notifications_read(
    user: dict = Depends(get_current_user),
) -> dict[str, object]:
    try:
        result = await run_in_threadpool(
            identity.rpc,
            "mark_all_user_notifications_read",
            p_actor=user["id"],
        )
    except identity.IdentityError as exc:
        _raise_identity_error(exc)
    if not isinstance(result, dict):
        raise HTTPException(status_code=502, detail="NOTIFICATION_STORAGE_UNAVAILABLE")
    return result
