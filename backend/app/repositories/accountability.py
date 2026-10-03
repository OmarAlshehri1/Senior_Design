"""Append-only transaction/alert review and audit event access."""
from app.repositories import identity
import re


def record_review(*, actor_id: str, resource_type: str, resource_id: str,
                  action: str, note: str | None) -> dict:
    row = identity.rpc("record_review_action", p_actor=actor_id,
                       p_resource_type=resource_type, p_resource_id=resource_id,
                       p_action=action, p_note=note)
    if not isinstance(row, dict) or not isinstance(row.get("record"), dict):
        raise identity.IdentityError("ACCOUNTABILITY_UNAVAILABLE")
    row["record"] = map_review_record(row["record"])
    return row


def review_history(*, resource_type: str, resource_id: str,
                   page: int = 1, page_size: int = 25) -> dict:
    result = identity.collection(
        "review_records", page=page, page_size=page_size,
        filters={"resource_type": f"eq.{resource_type}",
                 "resource_id": f"eq.{resource_id}"},
        order="created_at.desc,id.desc",
    )
    result["items"] = [map_review_record(row) for row in result["items"]]
    return result


def list_audit_events(*, page: int = 1, page_size: int = 25,
                      actor: str | None = None, action: str | None = None,
                      resource_type: str | None = None, outcome: str | None = None,
                      date: str | None = None, search: str | None = None,
                      scope_actor_id: str | None = None, sort: str = "NEWEST") -> dict:
    filters = {}
    if scope_actor_id:
        filters["actor_id"] = f"eq.{scope_actor_id}"
    if actor:
        # Escape PostgREST pattern metacharacters so a filter cannot widen scope.
        pattern = actor.strip().replace("\\", "\\\\").replace("*", "\\*").replace("%", "\\%").replace("_", "\\_")
        filters["actor_name"] = f"ilike.*{pattern}*"
    if action:
        filters["action"] = f"eq.{action}"
    if resource_type:
        filters["resource_type"] = f"eq.{resource_type}"
    if outcome:
        filters["outcome"] = f"eq.{outcome}"
    if date:
        filters["created_at"] = f"gte.{date}T00:00:00Z"
        filters["created_at.lte"] = f"{date}T23:59:59.999999Z"
    if search:
        term = re.sub(r"[^A-Za-z0-9 _.-]", "", search.strip())[:100]
        if term:
            filters["or"] = f"(actor_name.ilike.*{term}*,action.ilike.*{term}*,resource_id.ilike.*{term}*)"
    result = identity.collection("audit_events", page=page, page_size=page_size,
                                 filters=filters,
                                 order="created_at.asc,id.asc" if sort == "OLDEST" else "created_at.desc,id.desc")
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
