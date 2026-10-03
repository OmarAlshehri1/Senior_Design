from datetime import datetime, timezone
from typing import Any

import pytest

from app.services import audit_reports


PERIOD_START = datetime(
    2026,
    10,
    3,
    tzinfo=timezone.utc,
)
PERIOD_END = datetime(
    2026,
    10,
    4,
    tzinfo=timezone.utc,
)


def build_summary() -> dict[str, Any]:
    return {
        "daily_summary": {
            "total_transactions": 3,
            "transactions_evaluated": 3,
            "high_risk_transactions": 1,
            "average_risk_score": 45.5,
            "active_alerts": 1,
            "reviewed_alerts": 0,
        },
        "risk_distribution": {
            "low": 1,
            "medium": 1,
            "high": 1,
        },
        "alert_summary": {
            "total": 1,
            "active": 1,
            "reviewed": 0,
            "high": 1,
            "medium": 0,
        },
        "rule_summary": [
            {
                "rule_key": "ghost_vendors",
                "rule_name": "Ghost Vendors",
                "violation_count": 1,
            }
        ],
        "high_risk_transactions": [
            {
                "id": "TX-HIGH-001",
                "timestamp": "2026-10-03T03:00:00+00:00",
                "vendor_name": "Test Vendor",
                "amount": 500,
                "currency": "SAR",
                "risk_score": 88,
                "risk_level": "HIGH",
            }
        ],
    }


def test_normalize_daily_period() -> None:
    start, end = audit_reports.normalize_daily_period(
        PERIOD_START,
        PERIOD_END,
    )

    assert start == PERIOD_START
    assert end == PERIOD_END


@pytest.mark.parametrize(
    ("period_start", "period_end"),
    [
        (
            datetime(2026, 10, 3),
            datetime(2026, 10, 4),
        ),
        (
            datetime(
                2026,
                10,
                3,
                1,
                tzinfo=timezone.utc,
            ),
            PERIOD_END,
        ),
        (
            PERIOD_START,
            datetime(
                2026,
                10,
                3,
                23,
                59,
                59,
                tzinfo=timezone.utc,
            ),
        ),
    ],
)
def test_rejects_invalid_daily_period(
    period_start: datetime,
    period_end: datetime,
) -> None:
    with pytest.raises(ValueError):
        audit_reports.normalize_daily_period(
            period_start,
            period_end,
        )


def test_generate_daily_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted: dict[str, Any] = {}
    summary = build_summary()

    monkeypatch.setattr(
        audit_reports,
        "get_daily_audit_summary",
        lambda **kwargs: summary,
    )

    def fake_persist_completed_report(
        **kwargs: Any,
    ) -> dict[str, Any]:
        persisted.update(kwargs)
        return {
            "id": kwargs["report_id"],
            "status": "COMPLETED",
            "summary": kwargs["summary"],
        }

    monkeypatch.setattr(
        audit_reports,
        "persist_completed_report",
        fake_persist_completed_report,
    )

    report = audit_reports.generate_daily_report(
        period_start=PERIOD_START,
        period_end=PERIOD_END,
    )

    assert report["id"] == "RPT-2026-10-03"
    assert persisted["period_start"] == PERIOD_START
    assert persisted["period_end"] == PERIOD_END
    assert persisted["summary"]["report_version"] == "1.0.0"


def test_build_report_csv() -> None:
    content = audit_reports.build_report_csv(
        {
            "id": "RPT-2026-10-03",
            "status": "COMPLETED",
            "summary": build_summary(),
        }
    )

    assert "daily_summary,total_transactions,,3" in content
    assert "rule_summary,ghost_vendors,Ghost Vendors,1" in content
    assert "TX-HIGH-001" in content
    assert "Test Vendor" in content
    assert "88" in content
