from __future__ import annotations

import time
from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi.encoders import jsonable_encoder

from app.repositories.supabase_transactions import (
    REQUEST_TIMEOUT_SECONDS,
    SupabaseConfigurationError,
    SupabasePersistenceError,
    _get_configuration,
    _get_headers,
)
from app.repositories import identity


ALERT_COLUMNS = ",".join(
    [
        "id",
        "transaction_id",
        "created_at",
        "severity",
        "title",
        "description",
        "reason",
        "status",
        "reviewed_at",
        "risk_score",
        "risk_scoring_version",
        "latency_ms",
    ]
)
# Stored rule keys (see 20261031120000_alert_rule_filter.sql), never alert titles.
ALERT_RULE_KEYS = (
    "segregation_of_duties",
    "approval_limits",
    "duplicate_payment",
    "invoice_splitting",
    "ghost_vendors",
)
RULE_CAPABILITY_TTL_SECONDS = 60.0
_rule_capability: dict[str, tuple[float, bool]] = {}


def _map_alert(row: dict[str, Any]) -> dict[str, Any]:
    result = {
        "id": row.get("id"),
        "transaction_id": row.get("transaction_id"),
        "created_at": row.get("created_at"),
        "severity": row.get("severity"),
        "title": row.get("title"),
        "description": row.get("description"),
        "reason": row.get("reason"),
        "status": row.get("status"),
        "reviewed_at": row.get("reviewed_at"),
        "risk_score": row.get("risk_score"),
        "risk_scoring_version": row.get(
            "risk_scoring_version"
        ),
        "latency_ms": row.get("latency_ms"),
    }
    if "assignment" in row:
        assignment = row.get("assignment")
        result["assignment"] = ({
            "alert_id": assignment.get("alert_id"),
            "team_id": assignment.get("team_id"),
            "assignee_id": assignment.get("assignee_id"),
            "assignee_name": assignment.get("assignee_name"),
            "assigned_by_id": assignment.get("assigned_by_id"),
            "assigned_at": assignment.get("assigned_at"),
            "status": assignment.get("status"),
        } if isinstance(assignment, dict) else None)
    if isinstance(row.get("rule_keys"), list):
        result["rule_keys"] = [key for key in row["rule_keys"] if key in ALERT_RULE_KEYS]
    return result


def _parse_total(
    content_range: str | None,
    returned_rows: int,
) -> int:
    if not content_range or "/" not in content_range:
        return returned_rows

    total_value = content_range.rsplit("/", maxsplit=1)[-1]

    try:
        return int(total_value)
    except ValueError:
        return returned_rows


def create_risk_alert(
    *,
    transaction_id: str,
    severity: str,
    risk_score: float,
    risk_scoring_version: str,
    request_received_at: datetime,
) -> dict[str, Any]:
    if severity not in {"MEDIUM", "HIGH"}:
        raise ValueError("Risk alerts support MEDIUM or HIGH severity.")

    url, _ = _get_configuration()
    endpoint = f"{url}/rest/v1/alerts"

    headers = _get_headers()
    headers["Prefer"] = "return=representation"

    payload = {
        "transaction_id": transaction_id,
        "severity": severity,
        "title": (
            "High-risk transaction detected"
            if severity == "HIGH"
            else "Medium-risk transaction detected"
        ),
        "description": (
            "The transaction requires auditor review."
            if severity == "HIGH"
            else "The transaction should be reviewed according to policy."
        ),
        "reason": (
            "Rule and anomaly results exceeded the "
            f"{severity.lower()}-risk threshold."
        ),
        "status": "ACTIVE",
        "risk_score": risk_score,
        "risk_scoring_version": risk_scoring_version,
        "request_received_at": request_received_at,
    }

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=headers,
                params={"select": ALERT_COLUMNS},
                json=jsonable_encoder(payload),
            )
            response.raise_for_status()
            rows = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to create the transaction alert."
        ) from exc

    if (
        not isinstance(rows, list)
        or not rows
        or not isinstance(rows[0], dict)
    ):
        raise SupabasePersistenceError(
            "Supabase returned an invalid alert response."
        )

    return _map_alert(rows[0])


def create_high_risk_alert(
    *,
    transaction_id: str,
    risk_score: float,
    risk_scoring_version: str,
    request_received_at: datetime,
) -> dict[str, Any]:
    """Backward-compatible wrapper for existing high-risk callers."""
    return create_risk_alert(
        transaction_id=transaction_id,
        severity="HIGH",
        risk_score=risk_score,
        risk_scoring_version=risk_scoring_version,
        request_received_at=request_received_at,
    )


def list_alerts(
    *,
    actor_id: str,
    page: int = 1,
    page_size: int = 25,
    status_filter: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    result = identity.rpc("list_accessible_alerts", p_actor=actor_id, p_page=page,
                          p_page_size=page_size, p_status=status_filter)
    if not isinstance(result, dict) or not isinstance(result.get("items"), list):
        raise SupabasePersistenceError(
            "Supabase returned an invalid alerts response."
        )
    return [_map_alert(row) for row in result["items"] if isinstance(row, dict)], int(result.get("total", 0))


def list_alerts_filtered(
    *,
    actor_id: str,
    page: int = 1,
    page_size: int = 25,
    status_filter: str | None = None,
    severity: str | None = None,
    alert_type: str | None = None,
    search: str | None = None,
    sort: str = "NEWEST",
    rule: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    filters = dict(p_actor=actor_id, p_page=page, p_page_size=page_size, p_status=status_filter,
                   p_severity=severity, p_title=alert_type, p_search=search, p_sort=sort)
    result = (identity.rpc("list_accessible_alerts_by_rule", p_rule=rule, **filters) if rule
              else identity.rpc("list_accessible_alerts_filtered", **filters))
    if not isinstance(result, dict) or not isinstance(result.get("items"), list):
        raise SupabasePersistenceError(
            "Supabase returned an invalid alerts response."
        )
    return [_map_alert(row) for row in result["items"] if isinstance(row, dict)], int(result.get("total", 0))


def get_alert_filter_options(*, actor_id: str) -> dict[str, Any]:
    result = identity.rpc("get_alert_filter_options", p_actor=actor_id)
    if not isinstance(result, dict) or not isinstance(result.get("types"), list) or not isinstance(result.get("counts"), dict):
        raise SupabasePersistenceError("Supabase returned invalid alert filter options.")
    return {"types": [value for value in result["types"] if isinstance(value, str)],
            "counts": {key: int(result["counts"].get(key, 0)) for key in
                       ("total", "active", "reviewed", "active_high", "active_medium")}}


def rule_filter_supported() -> bool:
    # Cached probe of the additive migration; an empty lookup reads no rows.
    now = time.monotonic()
    cached = _rule_capability.get("supported")
    if cached and now - cached[0] < RULE_CAPABILITY_TTL_SECONDS:
        return cached[1]
    try:
        supported = isinstance(identity.rpc("get_transaction_failed_rule_keys", p_transaction_ids=[]), dict)
    except (identity.IdentityError, SupabaseConfigurationError):
        supported = False
    _rule_capability["supported"] = (now, supported)
    return supported


def attach_alert_rule_keys(alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Page enrichment for alerts already returned by a scoped list function.
    missing = list(dict.fromkeys(alert["transaction_id"] for alert in alerts
                                 if "rule_keys" not in alert and isinstance(alert.get("transaction_id"), str)))
    if not missing or not rule_filter_supported():
        return alerts
    try:
        keys = identity.rpc("get_transaction_failed_rule_keys", p_transaction_ids=missing)
    except identity.IdentityError:
        return alerts
    if not isinstance(keys, dict):
        return alerts
    for alert in alerts:
        values = keys.get(alert.get("transaction_id"))
        if "rule_keys" not in alert and isinstance(values, list):
            alert["rule_keys"] = [key for key in values if key in ALERT_RULE_KEYS]
    return alerts


def mark_alert_reviewed(
    alert_id: str,
) -> dict[str, Any] | None:
    url, _ = _get_configuration()
    endpoint = f"{url}/rest/v1/alerts"

    headers = _get_headers()
    headers["Prefer"] = "return=representation"

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.patch(
                endpoint,
                headers=headers,
                params={
                    "id": f"eq.{alert_id}",
                    "select": ALERT_COLUMNS,
                },
                json=jsonable_encoder(
                    {
                        "status": "REVIEWED",
                        "reviewed_at": datetime.now(
                            timezone.utc
                        ),
                    }
                ),
            )
            response.raise_for_status()
            rows = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to review the alert."
        ) from exc

    if not isinstance(rows, list):
        raise SupabasePersistenceError(
            "Supabase returned an invalid alert response."
        )

    if not rows:
        return None

    if not isinstance(rows[0], dict):
        raise SupabasePersistenceError(
            "Supabase returned an invalid alert record."
        )

    return _map_alert(rows[0])
