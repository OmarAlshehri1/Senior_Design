from fastapi.testclient import TestClient

from app.main import app
from app.repositories.identity import IdentityError
from app.repositories import accountability as repository
from app.services.identity import get_current_user


client = TestClient(app)


def test_review_action_is_attributed_and_returns_record_and_state(monkeypatch):
    received = {}
    monkeypatch.setattr("app.api.accountability.accountability.record_review", lambda **kwargs: (
        received.update(kwargs) or {
            "record": {"id": 8, "resource_type": "TRANSACTION", "resource_id": "TX-8",
                       "actor_id": kwargs["actor_id"], "actor_name": "Admin",
                       "actor_role": "ADMIN", "action": kwargs["action"],
                       "note": kwargs["note"], "created_at": "2026-10-03T10:00:00Z"},
            "transaction_review_status": "REVIEWED", "alert": None,
        }
    ))
    response = client.post("/api/v1/reviews/TRANSACTION/TX-8", json={"action": "REVIEWED"})
    assert response.status_code == 200
    assert response.json()["record"]["actor_role"] == "ADMIN"
    assert response.json()["status"] == "REVIEWED"
    assert received["resource_id"] == "TX-8"
    assert received["actor_id"] == "00000000-0000-0000-0000-000000000001"


def test_review_history_is_paginated_and_mapped(monkeypatch):
    monkeypatch.setattr("app.api.accountability.accountability.review_history", lambda **kwargs: {
        "items": [{"id": 3, "resource_type": "TRANSACTION", "resource_id": "TX-3",
                   "actor_id": "u1", "actor_name": "A", "actor_role": "AUDITOR",
                   "action": "REOPENED", "note": None, "created_at": "now"}],
        "total": 8, "page": kwargs["page"], "page_size": kwargs["page_size"],
    })
    response = client.get("/api/v1/reviews/TRANSACTION/TX-3?page=2&page_size=4")
    assert response.status_code == 200
    assert response.json()["total"] == 8
    assert response.json()["items"][0]["action"] == "REOPENED"


def test_audit_events_filters_and_supervisor_scope(monkeypatch):
    received = {}
    monkeypatch.setattr("app.api.accountability.accountability.list_audit_events", lambda **kwargs: (
        received.update(kwargs) or {"items": [], "total": 0, "page": kwargs["page"], "page_size": kwargs["page_size"]}
    ))
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "supervisor-id", "role": "SUPERVISOR", "account_status": "ACTIVE"
    }
    try:
        response = client.get("/api/v1/audit-events?page=3&page_size=20&action=LOGIN_SUCCESS&date=2026-10-03")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 200
    assert received["scope_actor_id"] == "supervisor-id"
    assert received["action"] == "LOGIN_SUCCESS"
    assert received["date"] == "2026-10-03"
    assert received["page"] == 3


def test_auditor_cannot_read_audit_events():
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "auditor-id", "role": "AUDITOR", "account_status": "ACTIVE"
    }
    try:
        response = client.get("/api/v1/audit-events")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 403


def test_review_database_conflict_is_returned_as_conflict(monkeypatch):
    def conflict(**_kwargs):
        raise IdentityError("CONFLICT", 409)
    monkeypatch.setattr("app.api.accountability.accountability.record_review", conflict)
    response = client.post("/api/v1/reviews/TRANSACTION/TX-8", json={"action": "REVIEWED"})
    assert response.status_code == 409
    assert response.json()["detail"] == "CONFLICT"


def test_review_payload_rejects_unknown_action():
    response = client.post("/api/v1/reviews/TRANSACTION/TX-8", json={"action": "DELETE"})
    assert response.status_code == 422


def test_audit_repository_builds_bounded_filters_and_newest_or_oldest_order(monkeypatch):
    received = {}
    monkeypatch.setattr(repository.identity, "collection", lambda table, **kwargs: (
        received.update({"table": table, **kwargs}) or {"items": [], "total": 0, "page": kwargs["page"], "page_size": kwargs["page_size"]}
    ))
    result = repository.list_audit_events(
        page=2, page_size=50, actor="Reviewer", action="ALERT_REOPENED",
        resource_type="ALERT", outcome="SUCCESS", date="2026-10-03",
        search="AL-4", scope_actor_id="actor-id", sort="OLDEST",
    )
    assert result["total"] == 0
    assert received["table"] == "audit_events"
    assert received["filters"]["actor_id"] == "eq.actor-id"
    assert received["filters"]["actor_name"] == "ilike.*Reviewer*"
    assert received["filters"]["created_at.lte"].startswith("2026-10-03")
    assert received["filters"]["or"].startswith("(actor_name.ilike.*AL-4*")
    assert received["order"] == "created_at.asc,id.asc"
    assert received["page"] == 2 and received["page_size"] == 50
