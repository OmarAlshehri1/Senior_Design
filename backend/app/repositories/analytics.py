"""Authoritative database-backed summaries and analytics."""

from app.repositories import identity
from app.services.audit_rules import RULE_VERSIONS
from app.services.rule_eligibility import RULE_DEFINITIONS


RULE_METADATA = {
    "segregation_of_duties": ("Segregation of Duties", "Internal Control", "Detects when conflicting transaction responsibilities belong to the same actor."),
    "approval_limits": ("Approval Limits", "Authorization Control", "Compares transaction amounts with the configured approval limit."),
    "duplicate_payment": ("Duplicate Payments", "Payment Control", "Compares vendor, invoice, and amount against transaction history."),
    "invoice_splitting": ("Invoice Splitting", "Approval Control", "Checks related vendor transactions in the preceding 24 hours against the approval limit."),
    "ghost_vendors": ("Ghost Vendors", "Vendor Control", "Checks the vendor against the authoritative approved-vendor registry."),
}


def get_dashboard_summary(*, actor_id: str) -> dict:
    result = identity.rpc("get_dashboard_summary", p_actor=actor_id)
    if not isinstance(result, dict):
        raise identity.IdentityError("ANALYTICS_UNAVAILABLE")
    return result


def get_analytics(*, actor_id: str, period_days: int) -> dict:
    result = identity.rpc("get_authoritative_analytics", p_actor=actor_id, p_period_days=period_days)
    if not isinstance(result, dict):
        raise identity.IdentityError("ANALYTICS_UNAVAILABLE")
    return result


def list_audit_rules() -> dict:
    items = []
    for index, definition in enumerate(RULE_DEFINITIONS, start=1):
        key = definition["key"]
        name, category, description = RULE_METADATA[key]
        items.append({
            "id": f"RULE-{index:03d}", "key": key, "name": name,
            "category": category, "description": description,
            "required_fields": list(definition["required_fields"]),
            "required_any_of": [list(group) for group in definition["required_any_of"]],
            "enabled": True, "version": RULE_VERSIONS[key],
        })
    return {"items": items}
