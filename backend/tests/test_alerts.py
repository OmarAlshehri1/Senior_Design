from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repositories.identity import IdentityError


client = TestClient(app)


def build_alert() -> dict[str, Any]:
    return {
        "id": "AL-001",
        "transaction_id": "TX-HIGH-001",
        "created_at": "2026-10-03T03:00:01+00:00",
        "severity": "HIGH",
        "title": "High-risk transaction detected",
        "description": (
            "The transaction requires auditor review."
        ),
        "reason": (
            "Rule and anomaly results exceeded the "
            "high-risk threshold."
        ),
        "status": "ACTIVE",
        "reviewed_at": None,
        "risk_score": 82.5,
        "risk_scoring_version": "1.0.0",
        "latency_ms": 420.0,
    }


def test_list_alerts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: dict[str, object] = {}

    def fake_list_alerts(
        *,
        actor_id: str,
        page: int,
        page_size: int,
        status_filter: str | None,
    ) -> tuple[list[dict[str, Any]], int]:
        received.update(
            {
                "page": page,
                "actor_id": actor_id,
                "page_size": page_size,
                "status_filter": status_filter,
            }
        )
        return [build_alert()], 1

    monkeypatch.setattr(
        "app.api.alerts.repository_list_alerts",
        fake_list_alerts,
    )

    response = client.get(
        "/api/v1/alerts?page=2&page_size=10&status=ACTIVE"
    )

    assert response.status_code == 200
    body = response.json()
    assert body["total"] == 1
    assert body["items"][0]["id"] == "AL-001"
    assert body["page"] == 2
    assert body["page_size"] == 10
    assert received["status_filter"] == "ACTIVE"
    assert received["actor_id"] == "00000000-0000-0000-0000-000000000001"


def test_review_alert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    reviewed_alert = {
        **build_alert(),
        "status": "REVIEWED",
        "reviewed_at": "2026-10-03T03:05:00+00:00",
    }

    monkeypatch.setattr(
        "app.api.alerts.accountability.record_review",
        lambda **kwargs: {"alert": reviewed_alert, "record": {"id": 1}},
    )

    response = client.patch(
        "/api/v1/alerts/AL-001/review",
        json={"status": "REVIEWED"},
    )

    assert response.status_code == 200
    assert response.json()["status"] == "REVIEWED"
    assert response.json()["reviewed_at"] is not None


def test_review_missing_alert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        "app.api.alerts.accountability.record_review",
        lambda **kwargs: (_ for _ in ()).throw(IdentityError("NOT_FOUND", 404)),
    )

    response = client.patch(
        "/api/v1/alerts/AL-MISSING/review",
        json={"status": "REVIEWED"},
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "NOT_FOUND"


def test_reopening_alert_preserves_alert_response_contract(monkeypatch: pytest.MonkeyPatch) -> None:
    active_alert = {**build_alert(), "status": "ACTIVE", "reviewed_at": None}
    received = {}
    def record(**kwargs):
        received.update(kwargs)
        return {"alert": active_alert, "record": {"id": 2}}
    monkeypatch.setattr("app.api.alerts.accountability.record_review", record)
    response = client.patch("/api/v1/alerts/AL-001/review", json={"status": "ACTIVE", "note": "Needs evidence"})
    assert response.status_code == 200
    assert response.json()["id"] == "AL-001"
    assert response.json()["status"] == "ACTIVE"
    assert received["action"] == "REOPENED"
    assert received["note"] == "Needs evidence"


def test_assignment_api_uses_authenticated_actor_and_database_history(monkeypatch: pytest.MonkeyPatch) -> None:
    received = {}
    monkeypatch.setattr("app.api.alerts.identity.rpc", lambda name, **kwargs: received.update({"name": name, **kwargs}) or {
        "assignment": {"alertId": "AL-001", "assigneeId": "auditor-2"}, "history": [], "eligible_users": []})
    bundle = client.get("/api/v1/alerts/AL-001/assignment")
    assert bundle.status_code == 200
    assert received["name"] == "get_alert_assignment_bundle"
    assert received["p_actor"] == "00000000-0000-0000-0000-000000000001"

    response = client.post("/api/v1/alerts/AL-001/assignment", json={
        "action": "ASSIGNED", "assignee_id": "auditor-2", "note": "Queue triage",
    })
    assert response.status_code == 200
    assert received == {"name": "record_alert_assignment", "p_actor": "00000000-0000-0000-0000-000000000001",
                        "p_alert_id": "AL-001", "p_action": "ASSIGNED", "p_assignee_id": "auditor-2", "p_note": "Queue triage"}


def test_auditor_cannot_call_assignment_mutation(monkeypatch: pytest.MonkeyPatch) -> None:
    called = False
    def unexpected(*_args, **_kwargs):
        nonlocal called
        called = True
    monkeypatch.setattr("app.api.alerts.identity.rpc", unexpected)
    from app.services.identity import get_current_user
    from app.main import app
    app.dependency_overrides[get_current_user] = lambda: {"id": "auditor-1", "role": "AUDITOR", "account_status": "ACTIVE"}
    try:
        response = client.post("/api/v1/alerts/AL-001/assignment", json={"action": "UNASSIGNED"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 403
    assert not called


def test_review_rejects_invalid_status() -> None:
    response = client.patch(
        "/api/v1/alerts/AL-001/review",
        json={"status": "PENDING"},
    )

    assert response.status_code == 422


def test_patch_is_allowed_by_cors() -> None:
    response = client.options(
        "/api/v1/alerts/AL-001/review",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "PATCH",
        },
    )

    assert response.status_code == 200
    assert (
        response.headers["access-control-allow-origin"]
        == "http://localhost:5173"
    )


def test_delete_is_allowed_by_cors_for_team_administration() -> None:
    response = client.options(
        "/api/v1/teams/00000000-0000-0000-0000-000000000001",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "DELETE"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
