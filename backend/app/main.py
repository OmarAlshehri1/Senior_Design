import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.transactions import router as transactions_router


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


app = FastAPI(
    title="Continuous Auditing API",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_allowed_origins(),
    allow_credentials=False,
    allow_methods=[
        "GET",
        "POST",
        "OPTIONS",
    ],
    allow_headers=[
        "Accept",
        "Content-Type",
    ],
)

app.include_router(
    transactions_router,
    prefix="/api/v1",
)


@app.get("/api/v1/health")
async def health_check() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "continuous-auditing-api",
    }