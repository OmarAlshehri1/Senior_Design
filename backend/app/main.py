import os
import asyncio
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.alerts import (
    router as alerts_router,
    websocket_router as alerts_websocket_router,
)
from app.api.reports import router as reports_router
from app.api.transactions import router as transactions_router
from app.api.identity import router as identity_router
from app.api.accountability import router as accountability_router
from app.api.teams import router as teams_router
from app.api.notifications import router as notifications_router
from app.api.cases import router as cases_router


LOCAL_FRONTEND_ORIGINS = (
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


def get_allowed_origins() -> list[str]:
    configured_origins = (
        os.getenv("FRONTEND_ORIGINS")
        or os.getenv("FRONTEND_ORIGIN", "")
    )

    if not configured_origins.strip():
        return list(LOCAL_FRONTEND_ORIGINS)

    return [
        origin.strip().rstrip("/")
        for origin in configured_origins.split(",")
        if origin.strip()
    ]


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.services.transaction_processing import enabled, recovery_loop
    from app.services.case_sla import escalation_loop
    task = asyncio.create_task(recovery_loop()) if enabled() else None
    sla_enabled = os.getenv("CASE_SLA_ESCALATION_ENABLED", "false").lower() == "true"
    sla_task = asyncio.create_task(escalation_loop()) if sla_enabled else None
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        if sla_task is not None:
            sla_task.cancel()
            with suppress(asyncio.CancelledError):
                await sla_task


app = FastAPI(
    title="Continuous Auditing API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=False,
    allow_methods=[
        "GET",
        "POST",
        "PATCH",
        "DELETE",
        "OPTIONS",
    ],
    allow_headers=[
        "Accept",
        "Content-Type",
        "Authorization",
        "X-File-Name",
    ],
)

app.include_router(
    transactions_router,
    prefix="/api/v1",
)
app.include_router(
    alerts_router,
    prefix="/api/v1",
)
app.include_router(
    reports_router,
    prefix="/api/v1",
)
app.include_router(alerts_websocket_router)
app.include_router(identity_router, prefix="/api/v1")
app.include_router(accountability_router, prefix="/api/v1")
app.include_router(teams_router, prefix="/api/v1")
app.include_router(notifications_router, prefix="/api/v1")
app.include_router(cases_router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "continuous-auditing-api",
    }
