"""Transport timing must survive thread dispatch without leaking request data."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repositories import ingestion as repository
from app.repositories.supabase_transactions import SupabasePersistenceError


@pytest.fixture(autouse=True)
def transport(monkeypatch):
    repository.close_rpc_client()
    monkeypatch.setattr(repository, "_get_configuration", lambda: ("https://storage.test", "secret"))
    monkeypatch.setattr(repository, "_get_headers", lambda: {"apikey": "never-expose-this"})
    yield
    repository.close_rpc_client()


def install(monkeypatch, handler):
    client = httpx.Client(transport=httpx.MockTransport(handler))
    monkeypatch.setattr(repository.httpx, "Client", lambda **kwargs: client)


def test_route_trace_crosses_thread_boundary_and_is_off_by_default(monkeypatch):
    monkeypatch.setenv("INGESTION_ENABLED", "true")
    seen = []

    def handler(request):
        seen.append("trace" in request.extensions)
        if "trace" in request.extensions:
            callback = request.extensions["trace"]
            # Trace info is deliberately unusable and must never be inspected.
            for event in ("connection.connect_tcp", "connection.start_tls",
                          "http11.receive_response_headers"):
                callback(event + ".started", None)
                callback(event + ".complete", None)
            callback("untrusted.secret.started", None)
            callback("untrusted.secret.complete", None)
        return httpx.Response(200, json={"receipt_id": "10000000-0000-4000-8000-000000000001"})

    install(monkeypatch, handler)
    client = TestClient(app)
    url = "/api/v1/ingestion/receipts?event_id=private-event"
    headers = {"Authorization": "Bearer " + "x" * 43}
    monkeypatch.delenv("INGESTION_TIMING_ENABLED", raising=False)
    assert "server-timing" not in client.get(url, headers=headers).headers
    monkeypatch.setenv("INGESTION_TIMING_ENABLED", "true")
    response = client.get(url, headers=headers)
    assert response.status_code == 200 and seen == [False, True]
    values = dict(part.strip().split(";dur=") for part in response.headers["server-timing"].split(","))
    assert {"read_rpc_dispatch", "read_rpc_lease", "read_rpc_http", "read_rpc_tcp",
            "read_rpc_tls", "read_rpc_wait", "read_rpc_decode"} <= values.keys()
    assert all(float(value) >= 0 for value in values.values())
    assert not any(secret in response.headers["server-timing"] for secret in
                   ("private-event", "storage.test", "never-expose-this", "untrusted", "x" * 43))
    assert repository._timings.get() is None


def test_concurrent_collectors_are_isolated_and_reset(monkeypatch):
    barrier = Barrier(2)
    collectors = []

    def handler(request):
        collectors.append(repository._timings.get()[1])
        barrier.wait(timeout=5)
        trace = request.extensions["trace"]
        trace("http11.receive_response_headers.started", None)
        trace("http11.receive_response_headers.complete", None)
        return httpx.Response(200, json=True)

    install(monkeypatch, handler)

    def invoke(_):
        with repository.capture_rpc_timings() as durations:
            assert repository.rpc("ingestion_source", {}) is True
        assert repository._timings.get() is None
        return durations

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(invoke, range(2)))
    assert results[0] is not results[1]
    assert {id(value) for value in collectors} == {id(value) for value in results}
    assert all("wait" in value and "http" in value for value in results)
    assert repository._timings.get() is None


def test_failed_transport_is_not_retried_and_context_is_restored(monkeypatch):
    attempts = []

    def handler(request):
        attempts.append(1)
        callback = request.extensions["trace"]
        callback("http11.receive_response_headers.started", None)
        callback("http11.receive_response_headers.failed", None)
        raise httpx.ReadTimeout("sensitive transport detail", request=request)

    install(monkeypatch, handler)
    with repository.capture_rpc_timings() as durations:
        with pytest.raises(SupabasePersistenceError, match="^Ingestion storage unavailable\\.$"):
            repository.rpc("submit_ingestion_event", {"private": "body"})
    assert attempts == [1] and durations["wait"] >= 0 and durations["http"] >= 0
    assert repository._timings.get() is None


def test_authorization_failure_does_not_publish_collected_timings(monkeypatch):
    monkeypatch.setenv("INGESTION_ENABLED", "true")
    monkeypatch.setenv("INGESTION_TIMING_ENABLED", "true")
    install(monkeypatch, lambda request: httpx.Response(200, json={"error": "UNAUTHORIZED"}))
    response = TestClient(app).get("/api/v1/ingestion/receipts?event_id=unknown",
                                  headers={"Authorization": "Bearer " + "z" * 43})
    assert response.status_code == 401
    assert "server-timing" not in response.headers
