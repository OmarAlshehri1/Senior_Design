import asyncio
from copy import deepcopy

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repositories import transaction_processing as repository
from app.repositories.supabase_transactions import SupabasePersistenceError, TransactionAlreadyExistsError
from app.services import transaction_processing as service


@pytest.fixture
def processing(monkeypatch):
    source = {"id": "TX-RECOVERY", "amount": 100, "approval_limit": 10,
              "created_by": "EMP", "approved_by": "EMP", "vendor_id": "V1",
              "invoice_number": "INV", "timestamp": "2026-10-03T10:00:00Z",
              "currency": "SAR", "data_quality_status": "PARTIAL", "missing_fields": [], "metadata": {}}
    state = {"transaction_id": source["id"], "input": source, "status": "PENDING",
             "lease_token": "token", "event_pending": False}
    calls = []
    def rpc(name, payload):
        calls.append(name)
        if "p_id" in payload and payload["p_id"] != state["transaction_id"]:
            raise SupabasePersistenceError("isolated missing job")
        if name == "create_transaction_with_job":
            state["input"] = payload["p_input"]
            return None
        if name == "claim_transaction_job":
            if state["status"] == "PROCESSING":
                return None
            if state["status"] == "PENDING":
                state["status"] = "PROCESSING"
            return deepcopy(state)
        if name == "finish_transaction_job":
            state.update(status="COMPLETED", result=payload["p_bundle"]["result"],
                         event_pending=True, alert_event={"id": "AL-RECOVERY", "transaction_id": source["id"]})
            return deepcopy(state)
        if name == "release_transaction_job":
            if state["status"] != "COMPLETED":
                state["status"] = "PENDING"
            return None
        raise AssertionError(name)
    class Model:
        version = "1.0.0"
        threshold = 90.6
        def score(self, records): return [100.0]
        def is_anomalous(self, score): return score >= self.threshold
    monkeypatch.setattr(repository, "rpc", rpc)
    monkeypatch.setattr(service, "get_model", lambda: Model())
    monkeypatch.setattr(service, "get_duplicate_payment_counts", lambda ids: {ids[0]: 1})
    monkeypatch.setattr(service, "get_invoice_splitting_contexts", lambda ids: {
        ids[0]: {"historical_transaction_count": 1, "window_total_amount": 110}})
    monkeypatch.setattr(service, "get_ghost_vendor_contexts", lambda ids: {
        ids[0]: {"registry_authoritative": True, "vendor_registered": False, "vendor_active": False}})
    async def publish(alert): calls.append("publish")
    def acknowledge(identifier):
        calls.append("ack")
        state["event_pending"] = False
    monkeypatch.setattr(service.alert_manager, "publish_created", publish)
    monkeypatch.setattr(repository, "acknowledge_event", acknowledge)
    return state, calls, rpc


def test_processing_commits_bundle_before_publication_and_replays_without_scoring(processing, monkeypatch):
    state, calls, _ = processing
    result = asyncio.run(service.process_job("TX-RECOVERY"))
    assert result["risk_score"] == 100
    assert result["risk_level"] == "HIGH"
    assert "metadata" not in result
    assert calls.index("finish_transaction_job") < calls.index("publish") < calls.index("ack")
    monkeypatch.setattr(service, "build_bundle", lambda *args: pytest.fail("Completed job was rescored"))
    assert asyncio.run(service.process_job("TX-RECOVERY")) == result
    assert calls.count("finish_transaction_job") == 1


@pytest.mark.parametrize("provider", ["get_duplicate_payment_counts", "get_invoice_splitting_contexts", "get_ghost_vendor_contexts"])
def test_context_failure_leaves_job_retryable(processing, monkeypatch, provider):
    state, calls, _ = processing
    original = getattr(service, provider)
    def fail(ids): raise SupabasePersistenceError("temporary context failure")
    monkeypatch.setattr(service, provider, fail)
    with pytest.raises(SupabasePersistenceError):
        asyncio.run(service.process_job("TX-RECOVERY"))
    assert state["status"] == "PENDING"
    assert "finish_transaction_job" not in calls and "publish" not in calls
    monkeypatch.setattr(service, provider, original)
    assert asyncio.run(service.process_job("TX-RECOVERY"))["risk_score"] == 100


def test_missing_context_record_is_not_saved_as_final(processing, monkeypatch):
    state, calls, _ = processing
    monkeypatch.setattr(service, "get_ghost_vendor_contexts", lambda ids: {})
    with pytest.raises(SupabasePersistenceError): asyncio.run(service.process_job("TX-RECOVERY"))
    assert state["status"] == "PENDING" and "finish_transaction_job" not in calls


def test_commit_response_lost_recovers_saved_result_without_duplicate_scoring(processing, monkeypatch):
    state, calls, original = processing
    def lost_response(name, payload):
        result = original(name, payload)
        if name == "finish_transaction_job": raise SupabasePersistenceError("response lost after commit")
        return result
    monkeypatch.setattr(repository, "rpc", lost_response)
    with pytest.raises(SupabasePersistenceError): asyncio.run(service.process_job("TX-RECOVERY"))
    assert state["status"] == "COMPLETED"
    monkeypatch.setattr(repository, "rpc", original)
    result = asyncio.run(service.process_job("TX-RECOVERY"))
    assert result["risk_score"] == 100
    assert calls.count("finish_transaction_job") == 1


def test_failed_event_ack_remains_durable_and_retries(processing, monkeypatch):
    state, calls, _ = processing
    original = repository.acknowledge_event
    def fail(identifier): raise SupabasePersistenceError("ack unavailable")
    monkeypatch.setattr(repository, "acknowledge_event", fail)
    assert asyncio.run(service.process_job("TX-RECOVERY"))["risk_score"] == 100
    assert state["event_pending"] is True
    monkeypatch.setattr(repository, "acknowledge_event", original)
    asyncio.run(service.process_job("TX-RECOVERY"))
    assert state["event_pending"] is False and calls.count("publish") == 2


def test_active_job_is_not_processed_twice(processing):
    state, calls, _ = processing
    state["status"] = "PROCESSING"
    assert asyncio.run(service.process_job("TX-RECOVERY")) is None
    assert calls == ["claim_transaction_job"]


def test_recovery_polls_other_jobs_and_pending_events_after_failure(processing, monkeypatch):
    state, calls, _ = processing
    def listed(*, events=False):
        return [{"transaction_id": "TX-RECOVERY", "alert_event": state.get("alert_event")}] if events else [{"transaction_id": "BAD"}, {"transaction_id": "TX-RECOVERY"}]
    monkeypatch.setattr(repository, "list_jobs", listed)
    asyncio.run(service.recover_once())
    assert state["status"] == "COMPLETED"


@pytest.mark.parametrize("failure", [False, True])
def test_enabled_api_uses_durable_creation_and_handles_duplicate(processing, monkeypatch, failure):
    state, calls, original = processing
    monkeypatch.setenv("TRANSACTION_RECOVERY_ENABLED", "true")
    def rpc(name, payload):
        if failure and name == "create_transaction_with_job": raise TransactionAlreadyExistsError("duplicate")
        return original(name, payload)
    monkeypatch.setattr(repository, "rpc", rpc)
    async def advisory(result): return result
    monkeypatch.setattr(service, "attach_explanation", advisory)
    # Without context manager: no external/background lifespan work in this API test.
    response = TestClient(app).post("/api/v1/transactions", json={"id": "TX-RECOVERY"})
    assert response.status_code == (409 if failure else 201)
    if failure: assert not calls
    else: assert calls[0] == "create_transaction_with_job"


def test_gemini_failure_cannot_change_committed_result(processing, monkeypatch):
    state, calls, _ = processing
    result = asyncio.run(service.process_job("TX-RECOVERY"))
    original = deepcopy(result)
    def fail(**kwargs): raise service.GeminiExplanationError("unavailable")
    monkeypatch.setattr(service, "generate_risk_explanation", fail)
    assert asyncio.run(service.attach_explanation(result)) == original
    assert state["status"] == "COMPLETED"


def test_lifespan_starts_and_cancels_enabled_recovery(monkeypatch):
    observed = []
    async def worker():
        observed.append("started")
        try:
            await asyncio.Event().wait()
        finally:
            observed.append("stopped")
    monkeypatch.setenv("TRANSACTION_RECOVERY_ENABLED", "true")
    monkeypatch.setattr(service, "recovery_loop", worker)
    with TestClient(app) as client:
        assert client.get("/api/v1/health").status_code == 200
        assert observed == ["started"]
    assert observed == ["started", "stopped"]


def test_pending_jobs_use_database_clock_rpc(monkeypatch):
    calls = []
    def rpc(name, payload):
        calls.append((name, payload))
        return [{"transaction_id": "TX-PENDING"}]
    monkeypatch.setattr(repository, "rpc", rpc)
    assert repository.list_jobs(limit=10) == [{"transaction_id": "TX-PENDING"}]
    assert calls == [("get_pending_transaction_jobs", {"p_limit": 10})]


@pytest.mark.parametrize("status", ["PENDING", "PROCESSING"])
def test_pending_reads_cannot_fabricate_completed_evaluation(status):
    from app.repositories import supabase_transactions as transactions
    row = {"id": "TX-PENDING", "created_by": "same", "approved_by": "same",
           "completeness_status": "PARTIAL", "missing_fields": []}
    result = transactions._from_database_row(row, processing_status=status,
        persisted_anomaly_score={"ai_score": 100}, persisted_explanation={"explanation": "old"})
    assert result["processing_status"] == status
    assert result["rule_status"] == "NOT_EVALUATED" and result["rule_results"] == []
    assert all(result[key] is None for key in ["rule_score", "ai_score", "risk_score", "risk_level", "explanation"])


@pytest.mark.parametrize("name,code,expected", [
    ("create_transaction_with_job", "23505", TransactionAlreadyExistsError),
    ("finish_transaction_job", "23505", SupabasePersistenceError),
    ("create_transaction_with_job", "23503", SupabasePersistenceError),
])
def test_rpc_conflict_mapping(monkeypatch, name, code, expected):
    original = httpx.Client
    transport = httpx.MockTransport(lambda request: httpx.Response(409, json={"code": code}))
    monkeypatch.setenv("SUPABASE_URL", "https://isolated.example")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "test-only-placeholder")
    monkeypatch.setattr(repository.httpx, "Client", lambda **kwargs: original(transport=transport, **kwargs))
    with pytest.raises(expected) as caught: repository.rpc(name, {})
    assert type(caught.value) is expected
