from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.repositories.supabase_reports import (
    get_daily_audit_summary,
    get_latest_transaction_period,
    persist_completed_report,
)


REPORT_VERSION = "1.0.0"


def normalize_daily_period(
    period_start: datetime,
    period_end: datetime,
) -> tuple[datetime, datetime]:
    if (
        period_start.tzinfo is None
        or period_end.tzinfo is None
    ):
        raise ValueError(
            "Report timestamps must include a timezone."
        )

    normalized_start = period_start.astimezone(timezone.utc)
    normalized_end = period_end.astimezone(timezone.utc)

    if normalized_start.time() != datetime.min.time():
        raise ValueError(
            "Daily reports must start at 00:00:00 UTC."
        )

    if normalized_end != normalized_start + timedelta(days=1):
        raise ValueError(
            "Daily reports must use a one-day half-open UTC period."
        )

    return normalized_start, normalized_end


def generate_daily_report(
    *,
    period_start: datetime,
    period_end: datetime,
) -> dict[str, Any]:
    normalized_start, normalized_end = (
        normalize_daily_period(period_start, period_end)
    )

    summary = get_daily_audit_summary(
        period_start=normalized_start,
        period_end=normalized_end,
    )
    summary["report_version"] = REPORT_VERSION

    report_id = (
        f"RPT-{normalized_start.date().isoformat()}"
    )

    return persist_completed_report(
        report_id=report_id,
        period_start=normalized_start,
        period_end=normalized_end,
        summary=summary,
    )


def generate_latest_activity_report() -> dict[str, Any]:
    """Generate a daily report for the day with the latest dated transaction."""
    period_start, period_end = get_latest_transaction_period()
    return generate_daily_report(
        period_start=period_start,
        period_end=period_end,
    )
