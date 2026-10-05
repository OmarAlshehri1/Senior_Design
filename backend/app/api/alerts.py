from __future__ import annotations

import asyncio
import json
import os

from typing import Literal

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel, ConfigDict, Field
from fastapi import Depends
from app.services.identity import get_current_user, authenticate_token
from app.repositories.identity import IdentityError
from starlette.concurrency import run_in_threadpool

from app.repositories.supabase_alerts import list_alerts as repository_list_alerts
from app.repositories import accountability, identity
from app.repositories.supabase_transactions import (
    SupabaseConfigurationError,
    SupabasePersistenceError,
)
from app.services.alert_stream import alert_manager


router = APIRouter(
    prefix="/alerts",
    tags=["alerts"],
    dependencies=[Depends(get_current_user)],
)
websocket_router = APIRouter(
    prefix="/ws",
    tags=["alerts"],
)


class AlertReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["REVIEWED", "ACTIVE"]
    note: str | None = Field(default=None, max_length=2000)


class AlertAssignmentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["ASSIGNED", "REASSIGNED", "UNASSIGNED"]
    assignee_id: str | None = None
    note: str | None = Field(default=None, max_length=2000)


@router.get("")
async def get_alerts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    status_filter: Literal[
        "ACTIVE",
        "REVIEWED",
    ] | None = Query(default=None, alias="status"),
    user: dict = Depends(get_current_user),
) -> dict[str, object]:
    try:
        alerts, total = await run_in_threadpool(
            repository_list_alerts,
            actor_id=user["id"],
            page=page,
            page_size=page_size,
            status_filter=status_filter,
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Alert storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Alerts could not be retrieved.",
        ) from exc
    except IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc

    return {
        "items": alerts,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{alert_id}/assignment")
async def get_alert_assignment(alert_id: str, user: dict = Depends(get_current_user)):
    try:
        return await run_in_threadpool(identity.rpc, "get_alert_assignment_bundle",
                                       p_actor=user["id"], p_alert_id=alert_id)
    except IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc


@router.post("/{alert_id}/assignment")
async def update_alert_assignment(alert_id: str, request: AlertAssignmentRequest,
                                  user: dict = Depends(get_current_user)):
    if user.get("role") not in ("SUPERVISOR", "ADMIN"):
        raise HTTPException(status_code=403, detail="FORBIDDEN")
    try:
        return await run_in_threadpool(identity.rpc, "record_alert_assignment",
            p_actor=user["id"], p_alert_id=alert_id, p_action=request.action,
            p_assignee_id=request.assignee_id, p_note=request.note)
    except IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc


@router.patch("/{alert_id}/review")
async def review_alert(
    alert_id: str,
    request: AlertReviewRequest,
    user: dict = Depends(get_current_user),
) -> dict[str, object]:
    try:
        result = await run_in_threadpool(
            accountability.record_review,
            actor_id=user["id"], resource_type="ALERT", resource_id=alert_id,
            action="REVIEWED" if request.status == "REVIEWED" else "REOPENED",
            note=request.note,
        )
    except identity.IdentityError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.code) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                            detail="Alert storage is not configured.") from exc

    return result["alert"]


@websocket_router.websocket("/alerts")
async def alert_stream(websocket: WebSocket) -> None:
    origin = websocket.headers.get("origin")
    configured = os.getenv("FRONTEND_ORIGINS") or os.getenv("FRONTEND_ORIGIN", "")
    allowed = [x.strip().rstrip("/") for x in configured.split(",") if x.strip()] if configured.strip() else ["http://localhost:5173", "http://127.0.0.1:5173"]
    if origin is not None and origin not in allowed:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    connection = None
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=10)
        message = json.loads(raw) if len(raw)<=9000 else None
        if not isinstance(message, dict) or message.get("type") != "auth" or not isinstance(message.get("access_token"), str):
            raise IdentityError("SESSION_EXPIRED", 401)
        token = message["access_token"]
        await run_in_threadpool(authenticate_token, token)

        class AuthenticatedConnection:
            async def accept(self):
                pass  # Handshake accepted; subscription only follows authentication.

            async def send_json(self, event):
                try:
                    # Check again before delivery: revocation/account changes cannot leak a later event.
                    await run_in_threadpool(authenticate_token, token)
                except (IdentityError, SupabaseConfigurationError):
                    await websocket.close(code=1008)
                    raise
                await websocket.send_json(event)

        connection = AuthenticatedConnection()
        await alert_manager.connect(connection)
        await websocket.send_json({"type": "auth.ready"})
        while True:
            try:
                await asyncio.wait_for(websocket.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                pass
            await run_in_threadpool(authenticate_token, token)
    except WebSocketDisconnect:
        pass
    except (IdentityError, SupabaseConfigurationError, ValueError, asyncio.TimeoutError):
        await websocket.close(code=1008)
    finally:
        if connection is not None:
            alert_manager.disconnect(connection)
