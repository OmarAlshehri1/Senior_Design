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


REPORT_COLUMNS = ",".join(
    [
        "id",
        "report_type",
        "status",
        "period_start",
        "period_end",
        "summary",
        "created_at",
        "completed_at",
        "failure_reason",
    ]
)


def _map_report(row: dict[str, Any]) -> dict[str, Any]:
    report_id = row.get("id")

    return {
        "id": report_id,
        "type": row.get("report_type"),
        "status": row.get("status"),
        "period_start": row.get("period_start"),
        "period_end": row.get("period_end"),
        "created_at": row.get("created_at"),
        "completed_at": row.get("completed_at"),
        "failure_reason": row.get("failure_reason"),
        "summary": row.get("summary", {}),
        "download_url": (
            f"/api/v1/reports/{report_id}/download"
            if report_id and row.get("status") == "COMPLETED"
            else None
        ),
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


def get_daily_audit_summary(
    *,
    period_start: datetime,
    period_end: datetime,
) -> dict[str, Any]:
    url, _ = _get_configuration()
    endpoint = (
        f"{url}/rest/v1/rpc/get_daily_audit_summary"
    )

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=_get_headers(),
                json=jsonable_encoder(
                    {
                        "p_period_start": period_start,
                        "p_period_end": period_end,
                    }
                ),
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to calculate the daily audit summary."
        ) from exc

    if isinstance(payload, list) and len(payload) == 1:
        payload = payload[0]

    if not isinstance(payload, dict):
        raise SupabasePersistenceError(
            "Supabase returned an invalid report summary."
        )

    return payload


def persist_completed_report(
    *,
    report_id: str,
    period_start: datetime,
    period_end: datetime,
    summary: dict[str, Any],
) -> dict[str, Any]:
    url, _ = _get_configuration()
    endpoint = f"{url}/rest/v1/audit_reports"

    headers = _get_headers()
    headers["Prefer"] = (
        "resolution=merge-duplicates,return=representation"
    )

    payload = {
        "id": report_id,
        "report_type": "DAILY",
        "status": "COMPLETED",
        "period_start": period_start,
        "period_end": period_end,
        "summary": summary,
        "completed_at": datetime.now(timezone.utc),
        "failure_reason": None,
    }

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=headers,
                params={
                    "on_conflict": "period_start,period_end",
                    "select": REPORT_COLUMNS,
                },
                json=jsonable_encoder(payload),
            )
            response.raise_for_status()
            rows = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to persist the audit report."
        ) from exc

    if (
        not isinstance(rows, list)
        or not rows
        or not isinstance(rows[0], dict)
    ):
        raise SupabasePersistenceError(
            "Supabase returned an invalid report response."
        )

    return _map_report(rows[0])


def list_reports(
    *,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[dict[str, Any]], int]:
    url, _ = _get_configuration()
    endpoint = f"{url}/rest/v1/audit_reports"

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.get(
                endpoint,
                headers=_get_headers(include_count=True),
                params={
                    "select": REPORT_COLUMNS,
                    "order": "created_at.desc,id.asc",
                    "offset": str((page - 1) * page_size),
                    "limit": str(page_size),
                },
            )
            response.raise_for_status()
            rows = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to retrieve audit reports."
        ) from exc

    if not isinstance(rows, list):
        raise SupabasePersistenceError(
            "Supabase returned an invalid reports response."
        )

    reports = [
        _map_report(row)
        for row in rows
        if isinstance(row, dict)
    ]

    return reports, _parse_total(
        response.headers.get("content-range"),
        len(reports),
    )


def get_report_by_id(
    report_id: str,
) -> dict[str, Any] | None:
    url, _ = _get_configuration()
    endpoint = f"{url}/rest/v1/audit_reports"

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.get(
                endpoint,
                headers=_get_headers(),
                params={
                    "select": REPORT_COLUMNS,
                    "id": f"eq.{report_id}",
                    "limit": "1",
                },
            )
            response.raise_for_status()
            rows = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to retrieve the audit report."
        ) from exc

    if not isinstance(rows, list):
        raise SupabasePersistenceError(
            "Supabase returned an invalid report response."
        )

    if not rows:
        return None

    if not isinstance(rows[0], dict):
        raise SupabasePersistenceError(
            "Supabase returned an invalid report record."
        )

    return _map_report(rows[0])
