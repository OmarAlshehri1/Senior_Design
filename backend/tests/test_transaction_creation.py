"""Runtime insert semantics against an isolated constraint-backed transport.

SQLite supplies a real primary-key race for the local transport harness. This
tests HTTP/API conflict handling, not live PostgreSQL migration application.
"""
import json
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Barrier

import httpx
import pytest
from fastapi.testclient import TestClient

from app.api import transactions as api
from app.main import app
from app.repositories import supabase_transactions as repository


@pytest.mark.parametrize("parallel", [False, True])
def test_same_id_creates_once_without_overwrite_or_duplicate_processing(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, parallel: bool,
) -> None:
    database = tmp_path / "isolated-transactions.sqlite"
    with sqlite3.connect(database) as db:
        db.execute("create table transactions (id text primary key, body text)")
    barrier = Barrier(2) if parallel else None
    original_client = httpx.Client

    def handle(request: httpx.Request) -> httpx.Response:
        assert request.method == "POST"
        assert request.url.path == "/rest/v1/transactions"
        assert not request.url.query
        assert request.headers["Prefer"] == "return=minimal"
        row = json.loads(request.content)
        if barrier:
            barrier.wait(timeout=10)
        try:
            with sqlite3.connect(database, timeout=10) as db:
                db.execute("insert into transactions values (?, ?)",
                           (row["id"], json.dumps(row)))
        except sqlite3.IntegrityError:
            return httpx.Response(409, json={"code": "23505"})
        return httpx.Response(201)

    monkeypatch.setenv("SUPABASE_URL", "https://isolated.example")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "test-only-placeholder")
    monkeypatch.setattr(repository.httpx, "Client", lambda **kwargs:
                        original_client(transport=httpx.MockTransport(handle), **kwargs))
    monkeypatch.setattr(api, "insert_transaction", repository.insert_transaction)
    evaluations = []
    monkeypatch.setattr(api, "persist_transaction_evaluation",
                        lambda **evaluation: evaluations.append(evaluation))

    first = {"id": "TX-SAME-ID", "amount": 100, "currency": "SAR",
             "created_by": "creator", "approved_by": "approver"}
    second = {**first, "amount": 999}
    with TestClient(app) as client:
        if parallel:
            with ThreadPoolExecutor(max_workers=2) as pool:
                responses = list(pool.map(lambda payload:
                    client.post("/api/v1/transactions", json=payload), [first, second]))
        else:
            responses = [client.post("/api/v1/transactions", json=payload)
                         for payload in [first, second]]

    assert sorted(response.status_code for response in responses) == [201, 409]
    winner = next(response.json() for response in responses if response.status_code == 201)
    loser = next(response.json() for response in responses if response.status_code == 409)
    assert loser == {"detail": "Transaction ID already exists."}
    with sqlite3.connect(database) as db:
        rows = db.execute("select body from transactions").fetchall()
    assert len(rows) == 1
    assert json.loads(rows[0][0])["amount"] == winner["amount"]
    assert len(evaluations) == 1
    assert evaluations[0]["transaction_id"] == "TX-SAME-ID"


@pytest.mark.parametrize("status_code,body", [
    (409, {"code": "23505"}), (409, {"code": "23503"}),
    (500, {"code": "23505"}), (409, []), (409, "invalid-json"),
])
def test_insert_classifies_only_unique_conflicts(
    monkeypatch: pytest.MonkeyPatch, status_code: int, body: object,
) -> None:
    original_client = httpx.Client
    def handle(request: httpx.Request) -> httpx.Response:
        if body == "invalid-json":
            return httpx.Response(status_code, text="invalid-json")
        return httpx.Response(status_code, json=body)
    monkeypatch.setenv("SUPABASE_URL", "https://isolated.example")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "test-only-placeholder")
    monkeypatch.setattr(repository.httpx, "Client", lambda **kwargs:
                        original_client(transport=httpx.MockTransport(handle), **kwargs))
    with pytest.raises(repository.SupabasePersistenceError) as caught:
        repository.insert_transaction({"id": "TX-CONFLICT", "data_quality_status": "PARTIAL"})
    assert isinstance(caught.value, repository.TransactionAlreadyExistsError) == (
        status_code == 409 and body == {"code": "23505"})


@pytest.mark.parametrize("error,expected", [
    (repository.SupabaseConfigurationError("configuration"), 503),
    (repository.SupabasePersistenceError("storage"), 502),
    (repository.TransactionAlreadyExistsError("duplicate"), 409),
])
def test_creation_failure_never_starts_evaluation(
    monkeypatch: pytest.MonkeyPatch, error: Exception, expected: int,
) -> None:
    def fail(transaction):
        raise error
    def forbidden(*args, **kwargs):
        pytest.fail("Processing started after insert failure")
    monkeypatch.setattr(api, "insert_transaction", fail)
    monkeypatch.setattr(api, "get_duplicate_payment_counts", forbidden)
    monkeypatch.setattr(api, "persist_transaction_evaluation", forbidden)
    with TestClient(app) as client:
        response = client.post("/api/v1/transactions", json={"id": "TX-ERROR"})
    assert response.status_code == expected


def test_network_failure_is_storage_error(monkeypatch: pytest.MonkeyPatch) -> None:
    original_client = httpx.Client
    def handle(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("isolated network failure", request=request)
    monkeypatch.setenv("SUPABASE_URL", "https://isolated.example")
    monkeypatch.setenv("SUPABASE_SECRET_KEY", "test-only-placeholder")
    monkeypatch.setattr(repository.httpx, "Client", lambda **kwargs:
                        original_client(transport=httpx.MockTransport(handle), **kwargs))
    with pytest.raises(repository.SupabasePersistenceError) as caught:
        repository.insert_transaction({"id": "TX-NETWORK", "data_quality_status": "PARTIAL"})
    assert not isinstance(caught.value, repository.TransactionAlreadyExistsError)
