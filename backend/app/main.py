from fastapi import FastAPI

from app.api.transactions import router as transactions_router


app = FastAPI(
    title="Continuous Auditing API",
    version="0.1.0",
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