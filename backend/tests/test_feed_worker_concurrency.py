import asyncio

import pytest

from app.services.feed_worker_concurrency import worker_count


@pytest.mark.parametrize("stage", ["VALIDATION", "AUDIT"])
def test_worker_count_defaults_to_one_and_bounds_explicit_settings(monkeypatch, stage):
    name = f"INGESTION_{stage}_CONCURRENCY"
    monkeypatch.delenv(name, raising=False)
    assert worker_count(stage) == 1
    for count in (1, 4, 8):
        monkeypatch.setenv(name, str(count))
        assert worker_count(stage) == count
    for value in ("0", "9", "-1", "4.0", "fast", "", " 4", "٤"):
        monkeypatch.setenv(name, value)
        with pytest.raises(ValueError, match=name):
            worker_count(stage)


def test_feed_worker_pool_runs_both_stages_concurrently_and_cleans_up(monkeypatch):
    from app.main import app, lifespan
    from app.services import feed_auditing, ingestion_validation, transaction_processing
    from app.repositories import ingestion

    monkeypatch.setattr(transaction_processing, "enabled", lambda: False)
    monkeypatch.setenv("CASE_SLA_ESCALATION_ENABLED", "false")
    monkeypatch.setenv("DAILY_REPORT_SCHEDULER_ENABLED", "false")
    for stage, module in (("VALIDATION", ingestion_validation), ("AUDIT", feed_auditing)):
        monkeypatch.setattr(module, "enabled", lambda: True)
        monkeypatch.setenv(f"INGESTION_{stage}_CONCURRENCY", "4")
    active = {"validation": 0, "audit": 0}
    peaks = active.copy()
    closed = []

    async def worker(stage):
        active[stage] += 1
        peaks[stage] = max(peaks[stage], active[stage])
        try:
            await asyncio.Event().wait()
        finally:
            active[stage] -= 1

    monkeypatch.setattr(ingestion_validation, "validation_loop", lambda: worker("validation"))
    monkeypatch.setattr(feed_auditing, "audit_loop", lambda: worker("audit"))
    monkeypatch.setattr(ingestion, "close_rpc_client", lambda: closed.append(active.copy()))

    async def exercise():
        async with lifespan(app):
            await asyncio.sleep(0)
            assert active == {"validation": 4, "audit": 4}
        assert active == {"validation": 0, "audit": 0}

    asyncio.run(exercise())
    assert peaks == {"validation": 4, "audit": 4}
    assert closed == [{"validation": 0, "audit": 0}]
