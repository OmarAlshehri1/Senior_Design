from fastapi.testclient import TestClient

from app.main import app
from app.repositories.identity import IdentityError
from app.services.identity import get_current_user

client = TestClient(app)


def test_team_activity_calls_scoped_database_rpc(monkeypatch):
    received = {}
    monkeypatch.setattr("app.api.teams.identity.rpc", lambda name, **kwargs: received.update({"name": name, **kwargs}) or {"workload": []})
    app.dependency_overrides[get_current_user] = lambda: {"id": "supervisor-1", "role": "SUPERVISOR", "account_status": "ACTIVE"}
    try:
        response = client.get("/api/v1/teams/activity?team_id=team-1")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 200
    assert received == {"name": "get_team_activity", "p_actor": "supervisor-1", "p_team_id": "team-1"}


def test_member_candidates_are_requested_for_the_selected_team(monkeypatch):
    received = {}
    monkeypatch.setattr("app.api.teams.identity.rpc", lambda name, **kwargs: received.update({"name": name, **kwargs}) or [])
    app.dependency_overrides[get_current_user] = lambda: {"id": "supervisor-1", "role": "SUPERVISOR", "account_status": "ACTIVE"}
    try:
        response = client.get("/api/v1/teams/team-1/member-candidates")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 200
    assert received == {"name": "list_team_member_candidates", "p_actor": "supervisor-1", "p_team_id": "team-1"}


def test_only_admin_can_manage_teams():
    app.dependency_overrides[get_current_user] = lambda: {"id": "supervisor-1", "role": "SUPERVISOR", "account_status": "ACTIVE"}
    try:
        response = client.post("/api/v1/teams", json={"name": "Team A", "supervisor_id": "supervisor-1"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 403


def test_membership_uses_database_policy_and_maps_denial(monkeypatch):
    monkeypatch.setattr("app.api.teams.identity.rpc", lambda *_args, **_kwargs: (_ for _ in ()).throw(IdentityError("FORBIDDEN", 403)))
    app.dependency_overrides[get_current_user] = lambda: {"id": "supervisor-1", "role": "SUPERVISOR", "account_status": "ACTIVE"}
    try:
        response = client.post("/api/v1/teams/team-1/members", json={"action": "TRANSFER", "user_id": "auditor-1"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 403
    assert response.json()["detail"] == "FORBIDDEN"


def test_team_payload_rejects_unknown_fields():
    response = client.post("/api/v1/teams", json={"name": "Team A", "supervisor_id": "s-1", "is_admin": True})
    assert response.status_code == 422
