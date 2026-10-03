from __future__ import annotations

from typing import Literal

from fastapi import (
    APIRouter,
    HTTPException,
    Query,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from app.repositories.supabase_alerts import (
    list_alerts as repository_list_alerts,
    mark_alert_reviewed,
)
from app.repositories.supabase_transactions import (
    SupabaseConfigurationError,
    SupabasePersistenceError,
)
from app.services.alert_stream import alert_manager


router = APIRouter(
    prefix="/alerts",
    tags=["alerts"],
)
websocket_router = APIRouter(
    prefix="/ws",
    tags=["alerts"],
)


class AlertReviewRequest(BaseModel):
    status: Literal["REVIEWED"]


@router.get("")
async def get_alerts(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    status_filter: Literal[
        "ACTIVE",
        "REVIEWED",
    ] | None = Query(default=None, alias="status"),
) -> dict[str, object]:
    try:
        alerts, total = await run_in_threadpool(
            repository_list_alerts,
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

    return {
        "items": alerts,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.patch("/{alert_id}/review")
async def review_alert(
    alert_id: str,
    request: AlertReviewRequest,
) -> dict[str, object]:
    try:
        alert = await run_in_threadpool(
            mark_alert_reviewed,
            alert_id,
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Alert storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Alert could not be reviewed.",
        ) from exc

    if alert is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Alert not found.",
        )

    return alert


@websocket_router.websocket("/alerts")
async def alert_stream(websocket: WebSocket) -> None:
    await alert_manager.connect(websocket)

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        alert_manager.disconnect(websocket)
