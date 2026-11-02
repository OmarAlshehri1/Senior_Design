import copy
import hashlib
import json

import httpx
import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.api import ingestion as api
from app.repositories import ingestion as repository
from app.repositories.supabase_transactions import SupabasePersistenceError

TOKEN = "x" * 43
HEADERS = {"Authorization": f"Bearer {TOKEN}"}
RECEIPT = "10000000-0000-4000-8000-000000000001"


@pytest.fixture(autouse=True)
def close_ingestion_transport():
    repository.close_rpc_client()
    yield
    repository.close_rpc_client()


def event():
    return {"schema_version": "1.0", "source_id": "source-A", "event_id": "event-1",
            "record_id": "record-1", "event_type": "transaction.created",
            "original_record": {"unfamiliar_column": "unknown", "amount": "000.10"}}


@pytest.fixture
def intake(monkeypatch):
    monkeypatch.setenv("INGESTION_ENABLED", "true")
    calls = []
    stored = {}

    def rpc(name, payload):
        calls.append((name, copy.deepcopy(payload)))
        if payload["p_credential_hash"] != hashlib.sha256(TOKEN.encode()).hexdigest():
            return {"error": "UNAUTHORIZED"}
        if name == "ingestion_source":
            return {"source_id": "source-A"}
        if name == "submit_ingestion_event":
            envelope = json.loads(payload["p_payload_text"])
            if stored and stored["envelope"] != envelope:
                return {"error": "EVENT_CONFLICT"}
            duplicate = bool(stored)
            stored.update(envelope=copy.deepcopy(envelope))
            return {"receipt_id": RECEIPT, "duplicate": duplicate,
                    "intake_status": "PENDING_VALIDATION", "processing_status": "PENDING"}
        return {"receipt_id": RECEIPT} if stored else None

    monkeypatch.setattr(repository, "rpc", rpc)
    return TestClient(app), calls, stored


def test_disabled_even_with_valid_source(intake, monkeypatch):
    client, calls, _ = intake
    monkeypatch.delenv("INGESTION_ENABLED")
    assert client.post("/api/v1/ingestion/events", headers=HEADERS, json=event()).status_code == 404
    assert calls == []


def test_source_credentials_are_separate_from_user_session(intake):
    client, _, _ = intake
    for headers in ({}, {"Authorization": "Bearer ordinary-user-jwt"},
                    {"Authorization": "Bearer " + "z" * 43}):
        assert client.post("/api/v1/ingestion/events", headers=headers, json=event()).status_code == 401


def test_accept_replay_conflict_and_lost_ack_lookup(intake):
    client, calls, stored = intake
    original = event()
    first = client.post("/api/v1/ingestion/events", headers=HEADERS, json=original)
    assert first.status_code == 202
    assert first.json()["processing_status"] == "PENDING"
    assert stored["envelope"] == original
    replay = client.post("/api/v1/ingestion/events", headers=HEADERS, json=dict(reversed(list(original.items()))))
    assert replay.status_code == 200
    assert replay.json()["duplicate"] is True
    submitted = [p for n, p in calls if n == "submit_ingestion_event"]
    assert submitted[0]["p_fingerprint"] == submitted[1]["p_fingerprint"]
    changed = event()
    changed["original_record"]["amount"] = "100"
    assert client.post("/api/v1/ingestion/events", headers=HEADERS, json=changed).status_code == 409
    assert stored["envelope"] == original
    assert client.get("/api/v1/ingestion/receipts", headers=HEADERS, params={"event_id": "event-1"}).json()["total"] == 1
    assert client.get(f"/api/v1/ingestion/receipts/{RECEIPT}", headers=HEADERS).status_code == 200


def test_opt_in_timing_headers_preserve_payload_and_hide_source_details(intake, monkeypatch):
    from itertools import count
    client, _, _ = intake
    monkeypatch.delenv("INGESTION_TIMING_ENABLED", raising=False)
    first = client.post("/api/v1/ingestion/events", headers=HEADERS, json=event())
    assert "server-timing" not in first.headers
    monkeypatch.setenv("INGESTION_TIMING_ENABLED", "true")
    clock = count(0, .01)
    monkeypatch.setattr(api, "perf_counter", lambda: next(clock))
    replay = client.post("/api/v1/ingestion/events", headers=HEADERS, json=event())
    assert replay.status_code == 200 and replay.json()["duplicate"] is True
    timings = dict(part.strip().split(";dur=") for part in replay.headers["server-timing"].split(","))
    assert set(timings) == {"auth_rpc", "parse", "persist_rpc", "app"}
    assert all(float(value) >= 0 for value in timings.values())
    assert float(timings["app"]) >= sum(float(timings[key]) for key in ("auth_rpc", "parse", "persist_rpc"))
    assert TOKEN not in replay.headers["server-timing"] and "source-A" not in replay.headers["server-timing"]
    assert len(replay.headers["x-ingestion-instance"]) == 32
    assert float(replay.headers["x-ingestion-uptime"]) >= 0
    for path, params in [(f"/api/v1/ingestion/receipts/{RECEIPT}", {}),
                         ("/api/v1/ingestion/receipts", {"event_id": "event-1"})]:
        read = client.get(path, headers=HEADERS, params=params)
        assert read.status_code == 200
        assert read.headers["x-ingestion-instance"] == replay.headers["x-ingestion-instance"]
        assert {part.strip().split(";dur=")[0] for part in read.headers["server-timing"].split(",")} == {"auth_rpc", "read_rpc", "app"}
    assert "server-timing" not in client.get(f"/api/v1/ingestion/receipts/{RECEIPT}").headers


@pytest.mark.parametrize("change", [
    {"source_id": "another-source"}, {"event_id": " "}, {"event_id": 1},
    {"schema_version": "2.0"}, {"event_type": "transaction.updated"},
    {"organization_id": "caller-supplied"}, {"original_record": []},
    {"original_record": {str(i): i for i in range(65)}},
    {"original_record": {"large": "x" * 16385}},
    {"original_record": {"x": {"x": {"x": {"x": {"x": 1}}}}}},
])
def test_envelope_boundaries_do_not_write(intake, change):
    client, calls, _ = intake
    response = client.post("/api/v1/ingestion/events", headers=HEADERS, json=event() | change)
    assert response.status_code in {403, 422}
    assert not any(name == "submit_ingestion_event" for name, _ in calls)
    assert "caller-supplied" not in response.text


@pytest.mark.parametrize("body", [b'{', b'[]', b'\xff',
    json.dumps(event()).replace('"unknown"', 'NaN').encode(),
    json.dumps(event()).replace('"unknown"', '1e1001').encode(),
    json.dumps(event()).replace('"unfamiliar_column": "unknown"', '"a":1,"a":2').encode(),
    json.dumps(event()).replace('"unknown"', '"\\ud800"').encode(),
    json.dumps(event()).replace('"unknown"', '"\\u0000"').encode()])
def test_invalid_json_is_safe(intake, body):
    client, calls, _ = intake
    response = client.post("/api/v1/ingestion/events", headers=HEADERS | {"Content-Type": "application/json"}, content=body)
    assert response.status_code == 422
    assert response.json()["detail"]["code"] == "INVALID_ENVELOPE"
    assert not any(name == "submit_ingestion_event" for name, _ in calls)


def test_body_size_content_type_and_encoding(intake):
    client, _, _ = intake
    assert client.post("/api/v1/ingestion/events", headers=HEADERS, content="{}").status_code == 415
    assert client.post("/api/v1/ingestion/events", headers=HEADERS | {"Content-Encoding": "gzip"}, json=event()).status_code == 415
    response = client.post("/api/v1/ingestion/events", headers=HEADERS | {"Content-Type": "application/json"}, content=b" " * (api.MAX_BODY + 1))
    assert response.status_code == 413


def test_revocation_rate_limit_storage_failure_and_missing_receipt(intake, monkeypatch):
    client, _, _ = intake
    assert client.get(f"/api/v1/ingestion/receipts/{RECEIPT}", headers=HEADERS).status_code == 404
    assert client.get("/api/v1/ingestion/receipts", headers=HEADERS, params={"event_id": "lost"}).json()["items"] == []
    for code, expected in [("UNAUTHORIZED", 401), ("RATE_LIMITED", 429)]:
        def fail(name, payload):
            return {"source_id": "source-A"} if name == "ingestion_source" else {"error": code}
        monkeypatch.setattr(repository, "rpc", fail)
        response = client.post("/api/v1/ingestion/events", headers=HEADERS, json=event())
        assert response.status_code == expected
        if expected == 429:
            assert response.headers["retry-after"] == "1"
    def unavailable(name, payload):
        raise SupabasePersistenceError("secret provider body must not leak")
    monkeypatch.setattr(repository, "rpc", unavailable)
    response = client.post("/api/v1/ingestion/events", headers=HEADERS, json=event())
    assert response.status_code == 503
    assert "secret" not in response.text


@pytest.mark.parametrize("status", [302, 503])
def test_repository_never_follows_redirect_or_exposes_body(monkeypatch, status):
    monkeypatch.setattr(repository, "_get_configuration", lambda: ("https://example.test", "secret"))
    monkeypatch.setattr(repository, "_get_headers", lambda: {"apikey": "secret"})
    def handler(request):
        return httpx.Response(status, text="sensitive provider response", headers={"Location": "https://untrusted.test"})
    real_client = httpx.Client
    monkeypatch.setattr(repository.httpx, "Client", lambda **kw: real_client(transport=httpx.MockTransport(handler), **kw))
    with pytest.raises(SupabasePersistenceError, match="Ingestion storage unavailable"):
        repository.rpc("ingestion_source", {"p_credential_hash": "a" * 64})


def test_repository_reuses_connection_client_but_refreshes_destination_and_headers(monkeypatch):
    real_client = httpx.Client
    clients, requests = [], []
    configuration = {"url": "https://first.test", "key": "first-key"}
    monkeypatch.setattr(repository, "_get_configuration", lambda: (configuration["url"], configuration["key"]))
    monkeypatch.setattr(repository, "_get_headers", lambda: {"apikey": configuration["key"]})
    def handler(request):
        requests.append((request.url.host, request.headers["apikey"]))
        return httpx.Response(200, json={"ok": True})
    def factory(**options):
        assert options == {"timeout": 10, "follow_redirects": False}
        client = real_client(transport=httpx.MockTransport(handler), **options)
        clients.append(client)
        return client
    monkeypatch.setattr(repository.httpx, "Client", factory)
    assert repository.rpc("ingestion_source", {}) == {"ok": True}
    configuration.update(url="https://second.test", key="rotated-key")
    repository.rpc("ingestion_source", {})
    assert len(clients) == 1
    assert requests == [("first.test", "first-key"), ("second.test", "rotated-key")]
    repository.close_rpc_client()
    assert clients[0].is_closed
    repository.rpc("ingestion_source", {})
    assert len(clients) == 2


def test_transport_shutdown_waits_for_inflight_request(monkeypatch):
    import threading
    entered, release, closed = threading.Event(), threading.Event(), threading.Event()
    outcomes = []
    class Client:
        def post(self, *args, **kwargs):
            entered.set()
            assert release.wait(timeout=5)
            assert not closed.is_set()
            return httpx.Response(200, json=True, request=httpx.Request("POST", "https://example.test"))
        def close(self):
            closed.set()
    monkeypatch.setattr(repository.httpx, "Client", lambda **kwargs: Client())
    monkeypatch.setattr(repository, "_get_configuration", lambda: ("https://example.test", "secret"))
    monkeypatch.setattr(repository, "_get_headers", lambda: {})
    request = threading.Thread(target=lambda: outcomes.append(repository.rpc("ingestion_source", {})))
    shutdown = threading.Thread(target=repository.close_rpc_client)
    request.start()
    try:
        assert entered.wait(timeout=5)
        shutdown.start()
        assert not closed.wait(timeout=.1)
    finally:
        release.set()
        request.join(timeout=5)
        if shutdown.ident is not None:
            shutdown.join(timeout=5)
    assert outcomes == [True] and closed.is_set()


def test_original_numeric_precision_is_forwarded_without_float_conversion(intake):
    client, calls, _ = intake
    body = json.dumps(event()).replace('"000.10"', '0.12345678901234567890123456789')
    response = client.post("/api/v1/ingestion/events", headers=HEADERS | {"Content-Type": "application/json"}, content=body)
    assert response.status_code == 202
    forwarded = next(p for n, p in calls if n == "submit_ingestion_event")
    assert forwarded["p_payload_text"] == body
