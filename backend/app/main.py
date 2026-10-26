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
from app.api.vendors import router as vendors_router
from app.api.analytics import router as analytics_router
from app.api.settings import router as settings_router
from app.api.primary_dataset import router as primary_dataset_router
from app.api.business_reports import router as business_reports_router
from app.api.ingestion import router as ingestion_router
from app.api.feed_review import router as feed_review_router
from app.api.payments_model_review import router as payments_model_review_router


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
    from app.services.daily_report_scheduler import daily_report_loop
    from app.services.ingestion_validation import enabled as validation_enabled, validation_loop
    from app.services.feed_auditing import enabled as feed_audit_enabled, audit_loop
    task = asyncio.create_task(recovery_loop()) if enabled() else None
    sla_enabled = os.getenv("CASE_SLA_ESCALATION_ENABLED", "false").lower() == "true"
    sla_task = asyncio.create_task(escalation_loop()) if sla_enabled else None
    reports_enabled = os.getenv("DAILY_REPORT_SCHEDULER_ENABLED", "false").lower() == "true"
    report_task = asyncio.create_task(daily_report_loop()) if reports_enabled else None
    validation_task = asyncio.create_task(validation_loop()) if validation_enabled() else None
    feed_audit_task = asyncio.create_task(audit_loop()) if feed_audit_enabled() else None
    try:
        yield
    finally:
        if feed_audit_task is not None:
            feed_audit_task.cancel()
            with suppress(asyncio.CancelledError):
                await feed_audit_task
        if validation_task is not None:
            validation_task.cancel()
            with suppress(asyncio.CancelledError):
                await validation_task
        if task is not None:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        if sla_task is not None:
            sla_task.cancel()
            with suppress(asyncio.CancelledError):
                await sla_task
        if report_task is not None:
            report_task.cancel()
            with suppress(asyncio.CancelledError):
                await report_task
        from app.repositories.ingestion import close_rpc_client
        from starlette.concurrency import run_in_threadpool
        await run_in_threadpool(close_rpc_client)


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
app.include_router(business_reports_router, prefix="/api/v1")
app.include_router(ingestion_router, prefix="/api/v1")
app.include_router(feed_review_router, prefix="/api/v1")
app.include_router(payments_model_review_router, prefix="/api/v1")
app.include_router(alerts_websocket_router)
app.include_router(identity_router, prefix="/api/v1")
app.include_router(accountability_router, prefix="/api/v1")
app.include_router(teams_router, prefix="/api/v1")
app.include_router(notifications_router, prefix="/api/v1")
app.include_router(cases_router, prefix="/api/v1")
app.include_router(vendors_router, prefix="/api/v1")
app.include_router(analytics_router, prefix="/api/v1")
app.include_router(settings_router, prefix="/api/v1")
app.include_router(primary_dataset_router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "continuous-auditing-api",
    }
