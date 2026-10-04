from threading import Event

from fastapi.testclient import TestClient

from app.main import app


def test_lifespan_starts_daily_report_worker_only_when_enabled(monkeypatch):
    started = Event()

    async def fake_report_loop():
        started.set()
        import asyncio
        await asyncio.Future()

    monkeypatch.setattr("app.services.daily_report_scheduler.daily_report_loop", fake_report_loop)
    monkeypatch.setenv("DAILY_REPORT_SCHEDULER_ENABLED", "true")
    with TestClient(app):
        assert started.wait(timeout=2)


def test_lifespan_leaves_daily_report_worker_disabled_by_default(monkeypatch):
    started = Event()

    async def fake_report_loop():
        started.set()

    monkeypatch.setattr("app.services.daily_report_scheduler.daily_report_loop", fake_report_loop)
    monkeypatch.setenv("DAILY_REPORT_SCHEDULER_ENABLED", "false")
    with TestClient(app):
        assert not started.wait(timeout=0.05)
