"""Case workflows are persisted and authorized by database RPCs."""

import os

from app.repositories import identity


def _rpc(name: str, **payload):
    result = identity.rpc(name, **payload)
    if result is None:
        raise identity.IdentityError("CASE_STORAGE_UNAVAILABLE")
    return result


def list_cases(*, actor_id: str, page: int = 1, page_size: int = 25,
               status: str | None = None, priority: str | None = None,
               search: str | None = None) -> dict:
    result = _rpc("list_cases", p_actor=actor_id, p_page=page, p_page_size=page_size,
                  p_status=status, p_priority=priority, p_search=search)
    if not isinstance(result, dict) or not isinstance(result.get("items"), list):
        raise identity.IdentityError("CASE_STORAGE_UNAVAILABLE")
    return result


def get_case(*, actor_id: str, case_id: str) -> dict:
    result = _rpc("get_case_bundle", p_actor=actor_id, p_case=case_id)
    if not isinstance(result, dict) or not isinstance(result.get("case"), dict):
        raise identity.IdentityError("CASE_STORAGE_UNAVAILABLE")
    return result


def create_case(*, actor_id: str, **values) -> dict:
    return _rpc("create_case", p_actor=actor_id, **values)


def update_status(*, actor_id: str, case_id: str, status: str, note: str | None) -> dict:
    return _rpc("update_case_status", p_actor=actor_id, p_case=case_id,
                p_status=status, p_note=note)


def assign(*, actor_id: str, case_id: str, assignee_id: str, note: str | None) -> dict:
    return _rpc("assign_case", p_actor=actor_id, p_case=case_id,
                p_assignee=assignee_id, p_note=note)


def add_comment(*, actor_id: str, case_id: str, message: str) -> dict:
    return _rpc("add_case_comment", p_actor=actor_id, p_case=case_id, p_message=message)


def request_closure(*, actor_id: str, case_id: str, outcome: str, note: str,
                    evidence_summary: str | None) -> dict:
    return _rpc("request_case_closure", p_actor=actor_id, p_case=case_id,
                p_outcome=outcome, p_note=note, p_evidence_summary=evidence_summary)


def decide_closure(*, actor_id: str, case_id: str, approve: bool, note: str | None) -> dict:
    return _rpc("decide_case_closure", p_actor=actor_id, p_case=case_id,
                p_approve=approve, p_note=note)


def add_evidence(*, actor_id: str, case_id: str, **values) -> dict:
    return _rpc("add_case_evidence", p_actor=actor_id, p_case=case_id, **values)


def get_evidence(*, actor_id: str, case_id: str, evidence_id: str) -> dict:
    result = _rpc("get_case_evidence", p_actor=actor_id, p_case=case_id, p_evidence=evidence_id)
    if not isinstance(result, dict):
        raise identity.IdentityError("CASE_STORAGE_UNAVAILABLE")
    return result


def record_evidence_rejection(*, actor_id: str, case_id: str, reason: str) -> None:
    identity.rpc("record_case_evidence_rejection", p_actor=actor_id, p_case=case_id, p_reason=reason)


def capabilities() -> dict:
    from app.repositories import case_storage
    from app.services.case_evidence import scanner_available
    bucket = os.getenv("CASE_EVIDENCE_BUCKET", "").strip()
    return {"evidence_uploads_enabled": bool(bucket and scanner_available() and case_storage.bucket_available(bucket))}


def escalate_overdue(*, batch: int = 100) -> int:
    result = _rpc("escalate_overdue_cases", p_batch=batch)
    if not isinstance(result, dict) or not isinstance(result.get("escalated"), int):
        raise identity.IdentityError("CASE_STORAGE_UNAVAILABLE")
    return result["escalated"]
