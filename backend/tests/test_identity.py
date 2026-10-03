from __future__ import annotations

import base64
import json
import time

from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.repositories.identity import IdentityError
from app.services.identity import get_current_user, require_active, verify_token


@pytest.fixture
def identity_client():
    # The shared domain fixture deliberately authenticates all ordinary API
    # tests. Identity tests remove that override so they exercise the boundary.
    app.dependency_overrides.clear()
    with TestClient(app) as client:
        yield client
    app.dependency_overrides.clear()


def test_protected_routes_reject_missing_and_invalid_bearer(identity_client, monkeypatch):
    response = identity_client.get("/api/v1/transactions")
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == "Bearer"

    def reject(_token):
        raise IdentityError("SESSION_EXPIRED", 401)

    monkeypatch.setattr("app.services.identity.authenticate_token", reject)
    response = identity_client.get(
        "/api/v1/transactions",
        headers={"Authorization": "Bearer invalid"},
    )
    assert response.status_code == 401
    assert response.json()["detail"] == "SESSION_EXPIRED"


def test_login_records_failed_credentials_and_returns_provider_session(identity_client, monkeypatch):
    from app.api import identity as api

    async def no_rate_limit(_request, _operation):
        return None

    monkeypatch.setattr(api, "limit", no_rate_limit)
    recorded = []

    def invalid(*_args, **_kwargs):
        raise IdentityError("INVALID_CREDENTIALS", 401)

    monkeypatch.setattr(api.store, "request", invalid)
    monkeypatch.setattr(api.store, "rpc", lambda *args, **kwargs: recorded.append((args, kwargs)))
    response = identity_client.post("/api/v1/auth/login", json={"email": "audit@example.test", "password": "bad"})
    assert response.status_code == 401
    assert recorded[0][0] == ("record_login",)
    assert recorded[0][1]["p_success"] is False

    monkeypatch.setattr(api.store, "request", lambda *_args, **_kwargs: {
        "access_token": "opaque-access", "refresh_token": "opaque-refresh", "expires_in": 3600,
    })
    monkeypatch.setattr(api, "register_session", lambda _token, login=False: {
        "id": "00000000-0000-0000-0000-000000000001", "name": "Auditor", "email": "audit@example.test",
        "role": "AUDITOR", "account_status": "ACTIVE",
    })
    response = identity_client.post("/api/v1/auth/login", json={"email": "audit@example.test", "password": "valid"})
    assert response.status_code == 200
    assert response.json()["user"]["role"] == "AUDITOR"
    assert response.json()["access_token"] == "opaque-access"


def test_access_request_does_not_accept_role_from_requester(identity_client, monkeypatch):
    from app.api import identity as api

    async def no_rate_limit(_request, _operation):
        return None

    monkeypatch.setattr(api, "limit", no_rate_limit)
    calls = []
    monkeypatch.setattr(api.store, "request", lambda method, path, **kwargs: calls.append((method, path, kwargs)))
    body = {
        "fullName": "Casey Morgan", "email": "casey@example.test", "department": "Internal Audit",
        "employeeId": "E-1", "reason": "Review audit alerts.",
    }
    assert identity_client.post("/api/v1/access-requests", json=body).status_code == 202
    assert calls[0][2]["body"]["email"] == "casey@example.test"
    assert "role" not in calls[0][2]["body"]
    body["role"] = "ADMIN"
    assert identity_client.post("/api/v1/access-requests", json=body).status_code == 422


def test_unlock_request_is_private_and_rate_limited(identity_client, monkeypatch):
    from app.api import identity as api

    async def no_rate_limit(_request, _operation):
        return None

    calls = []
    monkeypatch.setattr(api, "limit", no_rate_limit)
    monkeypatch.setattr(api.store, "request", lambda method, path, **kwargs: calls.append((method, path, kwargs)))
    response = identity_client.post("/api/v1/auth/unlock-request", json={"email": " Locked@Example.Test "})
    assert response.status_code == 202
    assert "If this address belongs to a locked account" in response.json()["message"]
    assert calls[0][0:2] == ("POST", "otp")
    assert calls[0][2]["auth"] is True
    assert calls[0][2]["body"] == {"email": "locked@example.test", "create_user": False}


def test_only_provider_verified_email_can_submit_unlock_request(identity_client, monkeypatch):
    from app.api import identity as api

    async def no_rate_limit(_request, _operation):
        return None

    calls = []
    monkeypatch.setattr(api, "limit", no_rate_limit)
    monkeypatch.setattr(api, "verify_token", lambda token: {"id": "verified-user", "email": "owner@example.test", "expires": 1})
    monkeypatch.setattr(api.store, "rpc", lambda name, **kwargs: calls.append((name, kwargs)))
    response = identity_client.post("/api/v1/auth/unlock-request/confirm", json={"access_token": "verified-token"})
    assert response.status_code == 202
    assert calls == [("request_account_unlock", {"p_email": "owner@example.test"})]


def test_password_reset_uses_only_the_server_configured_redirect(identity_client, monkeypatch):
    from app.api import identity as api

    async def no_rate_limit(_request, _operation):
        return None

    calls = []
    monkeypatch.setattr(api, "limit", no_rate_limit)
    monkeypatch.setenv("SUPABASE_AUTH_REDIRECT_URL", "https://approved.example.test/auth/callback")
    monkeypatch.setattr(api.store, "request", lambda method, path, **kwargs: calls.append((method, path, kwargs)))
    response = identity_client.post("/api/v1/auth/password-reset", json={"email": "person@example.test"})
    assert response.status_code == 202
    assert calls[0][2]["query"] == {"redirect_to": "https://approved.example.test/auth/callback"}
    response = identity_client.post("/api/v1/auth/password-reset", json={
        "email": "person@example.test", "redirect_to": "https://attacker.example.test"
    })
    assert response.status_code == 422


def test_transaction_creation_requires_supervisor_or_admin(identity_client):
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "auditor", "role": "AUDITOR", "account_status": "ACTIVE"
    }
    response = identity_client.post("/api/v1/transactions", json={})
    assert response.status_code == 403


@pytest.mark.parametrize(
    ("status", "role", "expected"),
    [
        ("ACTIVE", "AUDITOR", "ok"),
        ("ACTIVE", "SUPERVISOR", "ok"),
        ("ACTIVE", "ADMIN", "ok"),
        ("LOCKED", "ADMIN", "ACCOUNT_LOCKED"),
        ("DISABLED", "AUDITOR", "ACCOUNT_DISABLED"),
        ("ACTIVE", "UNKNOWN", "FORBIDDEN"),
    ],
)
def test_account_status_and_roles_are_authoritative(status, role, expected):
    row = {"account_status": status, "role": role}
    if expected == "ok":
        assert require_active(row) is row
    else:
        with pytest.raises(IdentityError, match=expected):
            require_active(row)


def test_jwt_claims_are_checked_after_provider_verification(monkeypatch):
    subject = "00000000-0000-0000-0000-000000000001"
    monkeypatch.setattr("app.services.identity._get_configuration", lambda: ("https://project.example", "unused"))
    monkeypatch.setattr("app.services.identity.store.request", lambda *_args, **_kwargs: {"id": subject, "email": "user@example.test"})

    def token(claims):
        payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
        return f"header.{payload}.signature"

    valid = {"iss": "https://project.example/auth/v1", "aud": "authenticated", "role": "authenticated",
             "sub": subject, "exp": time.time() + 60}
    assert verify_token(token(valid))["id"] == subject
    with pytest.raises(IdentityError, match="SESSION_EXPIRED"):
        verify_token(token({**valid, "exp": time.time() - 1}))
    with pytest.raises(IdentityError, match="SESSION_EXPIRED"):
        verify_token(token({**valid, "aud": "other"}))


def test_admin_routes_reject_other_active_roles(identity_client):
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "auditor", "role": "AUDITOR", "account_status": "ACTIVE"
    }
    response = identity_client.get("/api/v1/users")
    assert response.status_code == 403


def test_reports_reject_auditors_and_accept_supervisors(identity_client, monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "auditor", "role": "AUDITOR", "account_status": "ACTIVE"
    }
    assert identity_client.get("/api/v1/reports").status_code == 403

    app.dependency_overrides[get_current_user] = lambda: {
        "id": "supervisor", "role": "SUPERVISOR", "account_status": "ACTIVE"
    }
    monkeypatch.setattr("app.api.reports.repository_list_reports", lambda **_kwargs: ([], 0))
    response = identity_client.get("/api/v1/reports")
    assert response.status_code == 200
    assert response.json()["total"] == 0


def test_local_cors_preflight_allows_authorization_but_unknown_origin_is_denied(identity_client):
    allowed = identity_client.options(
        "/api/v1/transactions",
        headers={
            "Origin": "http://localhost:5173",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert allowed.status_code == 200
    assert "authorization" in allowed.headers["access-control-allow-headers"].lower()
    assert allowed.headers["access-control-allow-origin"] == "http://localhost:5173"

    denied = identity_client.options(
        "/api/v1/transactions",
        headers={
            "Origin": "https://unknown.example",
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
        },
    )
    assert denied.status_code == 400


def test_authenticated_websocket_requires_auth_message(identity_client, monkeypatch):
    monkeypatch.setattr(
        "app.api.alerts.authenticate_token",
        lambda token: {"id": "user-1", "role": "AUDITOR"} if token == "valid" else
        (_ for _ in ()).throw(IdentityError("SESSION_EXPIRED", 401)),
    )
    with identity_client.websocket_connect("/ws/alerts") as websocket:
        websocket.send_json({"type": "auth", "access_token": "valid"})
        assert websocket.receive_json() == {"type": "auth.ready"}


def test_websocket_rejects_invalid_session_before_subscription(identity_client, monkeypatch):
    monkeypatch.setattr("app.api.alerts.authenticate_token", lambda _token: (_ for _ in ()).throw(IdentityError("SESSION_EXPIRED", 401)))
    with identity_client.websocket_connect("/ws/alerts") as websocket:
        websocket.send_json({"type": "auth", "access_token": "invalid"})
        with pytest.raises(Exception):
            websocket.receive_json()


def test_account_lifecycle_revokes_old_sessions_in_sql():
    from pathlib import Path

    migration = Path(__file__).parents[1] / "migrations" / "013_create_identity_access.sql"
    sql = migration.read_text(encoding="utf-8")
    assert "update public.app_sessions set revoked_at=clock_timestamp() where user_id=p_user_id" in sql
    assert "Three consecutive unsuccessful application sign-ins" in sql
    assert "public.request_account_unlock(text)" in sql
    assert "public.decide_account_unlock(uuid,uuid,boolean,text)" in sql
    assert "revoke all on public.user_profiles,public.login_history,public.app_sessions,public.access_requests,public.account_unlock_requests from anon,authenticated" in sql
