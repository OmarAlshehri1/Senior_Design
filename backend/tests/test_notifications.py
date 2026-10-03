from fastapi.testclient import TestClient

from app.main import app
from app.repositories.identity import IdentityError
from app.services.identity import get_current_user


client = TestClient(app)


def test_notification_list_uses_authenticated_actor_scope(monkeypatch):
    received = {}

    def rpc(name, **kwargs):
        received.update(name=name, **kwargs)
        return {"items": [], "total": 0, "unread_count": 0, "page": 2, "page_size": 10}

    monkeypatch.setattr("app.api.notifications.identity.rpc", rpc)
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "user-1", "role": "AUDITOR", "account_status": "ACTIVE"}
    try:
        response = client.get("/api/v1/notifications?page=2&page_size=10&unread_only=true")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200
    assert received == {"name": "list_user_notifications", "p_actor": "user-1",
        "p_page": 2, "p_page_size": 10, "p_unread_only": True}


def test_mark_notification_read_maps_cross_user_not_found(monkeypatch):
    monkeypatch.setattr("app.api.notifications.identity.rpc", lambda *_args, **_kwargs:
        (_ for _ in ()).throw(IdentityError("NOT_FOUND", 404)))
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "user-1", "role": "AUDITOR", "account_status": "ACTIVE"}
    try:
        response = client.patch("/api/v1/notifications/00000000-0000-4000-8000-000000000001/read")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 404
    assert response.json()["detail"] == "NOT_FOUND"


def test_mark_all_notifications_read_calls_authenticated_actor(monkeypatch):
    received = {}
    monkeypatch.setattr("app.api.notifications.identity.rpc", lambda name, **kwargs:
        received.update(name=name, **kwargs) or {"updated": 3})
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "user-2", "role": "ADMIN", "account_status": "ACTIVE"}
    try:
        response = client.post("/api/v1/notifications/read-all")
    finally:
        app.dependency_overrides.pop(get_current_user, None)

    assert response.status_code == 200
    assert received == {"name": "mark_all_user_notifications_read", "p_actor": "user-2"}
