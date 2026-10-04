from fastapi.testclient import TestClient

from app.main import app
from app.services.identity import get_current_user


def test_settings_contract_and_role_boundaries(monkeypatch):
    calls = []
    monkeypatch.setattr("app.api.settings.settings.get_organization_settings", lambda **kwargs: calls.append(("get", kwargs)) or {"organization_name": "Northwind", "updated_at": "now"})
    monkeypatch.setattr("app.api.settings.settings.update_organization_name", lambda **kwargs: calls.append(("update", kwargs)) or {"organization_name": kwargs["organization_name"], "updated_at": "later"})
    client = TestClient(app)
    app.dependency_overrides[get_current_user] = lambda: {"id": "auditor-id", "role": "AUDITOR", "account_status": "ACTIVE"}
    try:
        assert client.get("/api/v1/settings").json()["organization_name"] == "Northwind"
        assert client.patch("/api/v1/settings/organization", json={"organization_name": "Blocked"}).status_code == 403
        app.dependency_overrides[get_current_user] = lambda: {"id": "admin-id", "role": "ADMIN", "account_status": "ACTIVE"}
        assert client.patch("/api/v1/settings/organization", json={"organization_name": "  Contoso  "}).json()["organization_name"] == "Contoso"
        for value in (" ", "x", "x" * 121):
            assert client.patch("/api/v1/settings/organization", json={"organization_name": value}).status_code == 422
        assert client.patch("/api/v1/settings/organization", json={"organization_name": "Contoso", "currency": "USD"}).status_code == 422
        assert calls == [
            ("get", {"actor_id": "auditor-id"}),
            ("update", {"actor_id": "admin-id", "organization_name": "Contoso"}),
        ]
    finally:
        app.dependency_overrides.clear()
