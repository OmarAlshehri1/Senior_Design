from fastapi.testclient import TestClient

from app.main import app
from app.repositories.analytics import list_audit_rules
from app.services.identity import get_current_user


def test_analytics_routes_require_authentication():
    app.dependency_overrides.clear()
    try:
        with TestClient(app) as client:
            for path in ("/api/v1/dashboard/summary", "/api/v1/audit-rules", "/api/v1/analytics"):
                assert client.get(path).status_code == 401
    finally:
        app.dependency_overrides.clear()


def test_analytics_routes_bind_actor_and_validate_period(monkeypatch):
    actor_id = "00000000-0000-0000-0000-000000000111"
    app.dependency_overrides[get_current_user] = lambda: {"id": actor_id, "role": "AUDITOR", "account_status": "ACTIVE"}
    calls = []
    monkeypatch.setattr("app.api.analytics.analytics.get_dashboard_summary", lambda **values: calls.append(("summary", values)) or {"total_transactions": 2})
    monkeypatch.setattr("app.api.analytics.analytics.get_analytics", lambda **values: calls.append(("analytics", values)) or {"period_days": values["period_days"]})
    monkeypatch.setattr("app.api.analytics.analytics.list_audit_rules", lambda: {"items": []})
    try:
        with TestClient(app) as client:
            assert client.get("/api/v1/dashboard/summary").json()["total_transactions"] == 2
            assert client.get("/api/v1/audit-rules").json() == {"items": []}
            assert client.get("/api/v1/analytics?period=7_DAYS").json() == {"period_days": 7}
            assert client.get("/api/v1/analytics?period=14_DAYS").status_code == 422
        assert calls == [
            ("summary", {"actor_id": actor_id}),
            ("analytics", {"actor_id": actor_id, "period_days": 7}),
        ]
    finally:
        app.dependency_overrides.clear()


def test_audit_rule_catalog_matches_the_five_versioned_rule_definitions():
    items = list_audit_rules()["items"]
    assert {item["key"] for item in items} == {
        "segregation_of_duties", "approval_limits", "duplicate_payment",
        "invoice_splitting", "ghost_vendors",
    }
    assert all(item["enabled"] and item["version"] and (item["required_fields"] or item["required_any_of"]) for item in items)
