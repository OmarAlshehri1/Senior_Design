"""Append-only transaction/alert review and audit event access."""
from app.repositories import identity


def record_review(*, actor_id: str, resource_type: str, resource_id: str,
                  action: str, note: str | None) -> dict:
    row = identity.rpc("record_review_action", p_actor=actor_id,
                       p_resource_type=resource_type, p_resource_id=resource_id,
                       p_action=action, p_note=note)
    if not isinstance(row, dict) or not isinstance(row.get("record"), dict):
        raise identity.IdentityError("ACCOUNTABILITY_UNAVAILABLE")
    row["record"] = map_review_record(row["record"])
    return row


def review_history(*, actor_id: str, resource_type: str, resource_id: str,
                   page: int = 1, page_size: int = 25) -> dict:
    result = identity.rpc("list_scoped_review_records", p_actor=actor_id,
        p_resource_type=resource_type, p_resource_id=resource_id, p_page=page, p_page_size=page_size)
    if not isinstance(result, dict) or not isinstance(result.get("items"), list):
        raise identity.IdentityError("ACCOUNTABILITY_UNAVAILABLE")
    result["items"] = [map_review_record(row) for row in result["items"]]
    return result


def list_audit_events(*, page: int = 1, page_size: int = 25,
                      actor: str | None = None, action: str | None = None,
                      resource_type: str | None = None, outcome: str | None = None,
                      date: str | None = None, search: str | None = None,
                      actor_id: str, sort: str = "NEWEST") -> dict:
    result = identity.rpc("list_scoped_audit_events", p_actor=actor_id, p_page=page, p_page_size=page_size,
        p_actor_name=actor, p_action=action, p_resource_type=resource_type, p_outcome=outcome,
        p_date=date, p_search=search, p_sort=sort)
    result["items"] = [_map_audit_event(row) for row in result["items"]]
    return result


def map_review_record(row: dict) -> dict:
    return {
        "id": row["id"], "transaction_id": row["transaction_id"],
        "resource_type": row["resource_type"], "resource_id": row["resource_id"],
        "actor_id": row["actor_id"], "actor_name": row.get("actor_name"),
        "actor_role": row["actor_role"], "action": row["action"],
        "note": row.get("note"), "created_at": row["created_at"],
    }


def _map_audit_event(row: dict) -> dict:
    return {**row, "details": row.get("details") or {}}
