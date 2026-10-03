from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repositories.identity import IdentityError
from app.services.identity import get_current_user
from app.services.case_evidence import EvidenceError, scan_clean_file, validate_filename


client = TestClient(app)
CASE_ID = str(uuid4())


def test_evidence_validation_checks_signature_and_normalizes_path(monkeypatch):
    assert validate_filename(r"folder\report.pdf", "application/pdf", b"%PDF-1.7") == ("report.pdf", ".pdf")
    with pytest.raises(EvidenceError) as invalid_type:
        validate_filename("payload.exe", "application/octet-stream", b"MZ")
    assert invalid_type.value.code == "UNSAFE_EVIDENCE_TYPE"
    with pytest.raises(EvidenceError) as mismatch:
        validate_filename("report.pdf", "application/pdf", b"not a pdf")
    assert mismatch.value.code == "EVIDENCE_MIME_MISMATCH"


def test_evidence_scanner_rejects_infected_files_without_shell(monkeypatch):
    monkeypatch.setenv("CASE_ANTIVIRUS_EXECUTABLE", "clamscan")
    seen = {}

    def infected(arguments, **kwargs):
        seen["arguments"] = arguments
        seen["kwargs"] = kwargs
        return type("Result", (), {"returncode": 1})()

    monkeypatch.setattr("app.services.case_evidence.subprocess.run", infected)
    with pytest.raises(EvidenceError) as rejected:
        scan_clean_file(b"%PDF-1.7", ".pdf")
    assert rejected.value.code == "EVIDENCE_REJECTED_BY_SCANNER"
    assert seen["arguments"][1] == "--no-summary"
    assert seen["kwargs"].get("shell", False) is False


def test_case_list_uses_authenticated_actor_and_scoped_rpc(monkeypatch):
    received = {}
    monkeypatch.setattr("app.api.cases.cases.list_cases", lambda **kwargs: received.update(kwargs) or {"items": [], "total": 0})
    app.dependency_overrides[get_current_user] = lambda: {"id": "auditor-1", "role": "AUDITOR", "account_status": "ACTIVE"}
    try:
        response = client.get("/api/v1/cases?page=2&page_size=20&status=OPEN&priority=HIGH&search=case")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 200
    assert received == {"actor_id": "auditor-1", "page": 2, "page_size": 20,
                        "status": "OPEN", "priority": "HIGH", "search": "case"}


def test_case_creation_forwards_only_validated_explicit_source(monkeypatch):
    received = {}
    monkeypatch.setattr("app.api.cases.cases.create_case", lambda **kwargs: received.update(kwargs) or {"id": "case-1"})
    app.dependency_overrides[get_current_user] = lambda: {"id": "supervisor-1", "role": "SUPERVISOR", "account_status": "ACTIVE"}
    try:
        response = client.post("/api/v1/cases", json={
            "source_type": "ALERT", "source_id": "AL-1", "title": "Review issue",
            "description": "Investigate the issue", "priority": "HIGH", "department": "Audit",
        })
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 200
    assert received == {"actor_id": "supervisor-1", "p_source_type": "ALERT", "p_source_id": "AL-1",
                        "p_title": "Review issue", "p_description": "Investigate the issue",
                        "p_priority": "HIGH", "p_department": "Audit", "p_assigned_to": None}


def test_case_closure_decision_is_supervisor_or_admin_only():
    app.dependency_overrides[get_current_user] = lambda: {"id": "auditor-1", "role": "AUDITOR", "account_status": "ACTIVE"}
    try:
        response = client.post(f"/api/v1/cases/{CASE_ID}/closure-decision", json={"approve": True})
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 403


def test_case_closure_request_is_auditor_only():
    app.dependency_overrides[get_current_user] = lambda: {"id": "supervisor-1", "role": "SUPERVISOR", "account_status": "ACTIVE"}
    try:
        response = client.post(f"/api/v1/cases/{CASE_ID}/closure-request", json={
            "outcome": "NO_ISSUE_FOUND", "note": "Investigation complete",
        })
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 403


def test_evidence_upload_fails_closed_without_private_storage_and_scanner(monkeypatch):
    monkeypatch.delenv("CASE_EVIDENCE_BUCKET", raising=False)
    monkeypatch.delenv("CASE_ANTIVIRUS_EXECUTABLE", raising=False)
    app.dependency_overrides[get_current_user] = lambda: {"id": "auditor-1", "role": "AUDITOR", "account_status": "ACTIVE"}
    try:
        response = client.post(f"/api/v1/cases/{CASE_ID}/evidence?category=DOCUMENT", content=b"%PDF-1.7",
            headers={"X-File-Name": "evidence.pdf", "Content-Type": "application/pdf"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 503
    assert response.json()["detail"] == "EVIDENCE_STORAGE_OR_SCANNER_UNAVAILABLE"


def test_evidence_upload_rejects_public_or_unavailable_bucket(monkeypatch):
    monkeypatch.setenv("CASE_EVIDENCE_BUCKET", "case-evidence")
    monkeypatch.setenv("CASE_ANTIVIRUS_EXECUTABLE", "clamscan")
    monkeypatch.setattr("app.api.cases.case_storage.bucket_available", lambda _bucket: False)
    app.dependency_overrides[get_current_user] = lambda: {"id": "auditor-1", "role": "AUDITOR", "account_status": "ACTIVE"}
    try:
        response = client.post(f"/api/v1/cases/{CASE_ID}/evidence?category=DOCUMENT", content=b"%PDF-1.7",
            headers={"X-File-Name": "evidence.pdf", "Content-Type": "application/pdf"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 503
    assert response.json()["detail"] == "PRIVATE_EVIDENCE_BUCKET_UNAVAILABLE"


def test_case_storage_denial_maps_to_safe_http_error(monkeypatch):
    monkeypatch.setattr("app.api.cases.cases.list_cases", lambda **_kwargs: (_ for _ in ()).throw(IdentityError("FORBIDDEN", 403)))
    app.dependency_overrides[get_current_user] = lambda: {"id": "auditor-1", "role": "AUDITOR", "account_status": "ACTIVE"}
    try:
        response = client.get("/api/v1/cases")
    finally:
        app.dependency_overrides.pop(get_current_user, None)
    assert response.status_code == 403
    assert response.json()["detail"] == "FORBIDDEN"


def test_case_payload_rejects_unknown_fields():
    response = client.post("/api/v1/cases", json={
        "source_type": "ALERT", "source_id": "AL-1", "title": "Case",
        "description": "Description", "priority": "HIGH", "is_admin": True,
    })
    assert response.status_code == 422
