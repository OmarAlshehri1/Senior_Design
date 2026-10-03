from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import httpx
from fastapi.encoders import jsonable_encoder

from app.repositories.supabase_transactions import (
    REQUEST_TIMEOUT_SECONDS,
    SupabasePersistenceError,
    _get_configuration,
    _get_headers,
)


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


def _map_alert(row: dict[str, Any]) -> dict[str, Any]:
    return {
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


def create_high_risk_alert(
    *,
    transaction_id: str,
    risk_score: float,
    risk_scoring_version: str,
    request_received_at: datetime,
) -> dict[str, Any]:
    url, _ = _get_configuration()
    endpoint = f"{url}/rest/v1/alerts"

    headers = _get_headers()
    headers["Prefer"] = "return=representation"

    payload = {
        "transaction_id": transaction_id,
        "severity": "HIGH",
        "title": "High-risk transaction detected",
        "description": (
            "The transaction requires auditor review."
        ),
        "reason": (
            "Rule and anomaly results exceeded the "
            "high-risk threshold."
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


def list_alerts(
    *,
    page: int = 1,
    page_size: int = 25,
    status_filter: str | None = None,
) -> tuple[list[dict[str, Any]], int]:
    url, _ = _get_configuration()
    endpoint = f"{url}/rest/v1/alerts"

    params = {
        "select": ALERT_COLUMNS,
        "order": "created_at.desc,id.asc",
        "offset": str((page - 1) * page_size),
        "limit": str(page_size),
    }

    if status_filter is not None:
        params["status"] = f"eq.{status_filter}"

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.get(
                endpoint,
                headers=_get_headers(include_count=True),
                params=params,
            )
            response.raise_for_status()
            rows = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to retrieve alerts."
        ) from exc

    if not isinstance(rows, list):
        raise SupabasePersistenceError(
            "Supabase returned an invalid alerts response."
        )

    alerts = [
        _map_alert(row)
        for row in rows
        if isinstance(row, dict)
    ]
    total = _parse_total(
        response.headers.get("content-range"),
        len(alerts),
    )

    return alerts, total


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
