from fastapi.testclient import TestClient

from app.main import app


def test_vendor_endpoints_bind_authenticated_actor_and_filters(monkeypatch):
    from app.repositories import vendors

    monkeypatch.setattr(vendors, "list_vendors", lambda **kwargs: {"items": [], "total": 0, **kwargs})
    monkeypatch.setattr(vendors, "get_vendor", lambda **kwargs: {"vendor": {"id": kwargs["vendor_id"]}})
    client = TestClient(app)
    page = client.get("/api/v1/vendors?page=2&page_size=10&status=WATCHLISTED&search=acme&risk=HIGH")
    assert page.status_code == 200
    assert page.json()["actor_id"] == "00000000-0000-0000-0000-000000000001"
    assert page.json()["page"] == 2
    assert page.json()["status"] == "WATCHLISTED"
    assert page.json()["search"] == "acme"
    assert page.json()["risk"] == "HIGH"
    assert client.get("/api/v1/vendors/V-1").json()["vendor"]["id"] == "V-1"


def test_vendor_workflow_routes_restrict_request_and_decision_roles(monkeypatch):
    from app.repositories import vendors
    from app.services.identity import get_current_user

    monkeypatch.setattr(vendors, "request", lambda **kwargs: kwargs)
    monkeypatch.setattr(vendors, "decide", lambda **kwargs: kwargs)
    monkeypatch.setattr(vendors, "change", lambda **kwargs: kwargs)
    client = TestClient(app)

    app.dependency_overrides[get_current_user] = lambda: {
        "id": "auditor-1", "role": "AUDITOR", "account_status": "ACTIVE"}
    assert client.post("/api/v1/vendors/V-1/watchlist-requests", json={"reason": "Review risk"}).status_code == 200
    assert client.post("/api/v1/vendors/V-1/block-requests", json={"reason": "Review risk"}).status_code == 403
    assert client.post("/api/v1/vendors/requests/00000000-0000-0000-0000-000000000001/decision", json={"approve": True}).status_code == 403

    app.dependency_overrides[get_current_user] = lambda: {
        "id": "admin-1", "role": "ADMIN", "account_status": "ACTIVE"}
    assert client.post("/api/v1/vendors/requests/00000000-0000-0000-0000-000000000001/decision", json={"approve": True}).status_code == 200
    assert client.post("/api/v1/vendors/V-1/monitoring", json={"action": "UNBLOCK"}).status_code == 200
    app.dependency_overrides.pop(get_current_user, None)
