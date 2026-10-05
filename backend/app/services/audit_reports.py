from __future__ import annotations

import csv
from datetime import datetime, timedelta, timezone
from io import StringIO
from typing import Any

from app.repositories.supabase_reports import (
    get_daily_audit_summary,
    get_latest_transaction_period,
    persist_completed_report,
)


REPORT_VERSION = "1.0.0"
CSV_COLUMNS = [
    "section",
    "key",
    "label",
    "value",
    "transaction_id",
    "timestamp",
    "vendor_name",
    "amount",
    "currency",
    "risk_score",
    "risk_level",
]


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

    if normalized_end > datetime.now(timezone.utc):
        raise ValueError(
            "Daily reports can only be generated after their UTC period has ended."
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
    """Generate a report for the latest closed UTC day with activity."""
    period_start, period_end = get_latest_transaction_period()
    return generate_daily_report(
        period_start=period_start,
        period_end=period_end,
    )


def build_report_csv(report: dict[str, Any]) -> str:
    summary = report.get("summary")

    if not isinstance(summary, dict):
        raise ValueError(
            "Completed report summary is unavailable."
        )

    output = StringIO(newline="")
    writer = csv.DictWriter(
        output,
        fieldnames=CSV_COLUMNS,
        extrasaction="ignore",
    )
    writer.writeheader()

    for section_name in (
        "daily_summary",
        "risk_distribution",
        "alert_summary",
    ):
        section = summary.get(section_name, {})

        if not isinstance(section, dict):
            continue

        for key, value in section.items():
            writer.writerow(
                {
                    "section": section_name,
                    "key": key,
                    "value": value,
                }
            )

    rule_summary = summary.get("rule_summary", [])

    if isinstance(rule_summary, list):
        for rule in rule_summary:
            if not isinstance(rule, dict):
                continue

            writer.writerow(
                {
                    "section": "rule_summary",
                    "key": rule.get("rule_key"),
                    "label": rule.get("rule_name"),
                    "value": rule.get("violation_count"),
                }
            )

    high_risk_transactions = summary.get(
        "high_risk_transactions",
        [],
    )

    if isinstance(high_risk_transactions, list):
        for transaction in high_risk_transactions:
            if not isinstance(transaction, dict):
                continue

            writer.writerow(
                {
                    "section": "high_risk_transactions",
                    "transaction_id": transaction.get("id"),
                    "timestamp": transaction.get("timestamp"),
                    "vendor_name": transaction.get(
                        "vendor_name"
                    ),
                    "amount": transaction.get("amount"),
                    "currency": transaction.get("currency"),
                    "risk_score": transaction.get(
                        "risk_score"
                    ),
                    "risk_level": transaction.get(
                        "risk_level"
                    ),
                }
            )

    return output.getvalue()
