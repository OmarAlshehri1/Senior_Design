from datetime import datetime
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.api import reports as reports_api
from app.main import app
from app.services.identity import get_current_user


client = TestClient(app)


def build_report() -> dict[str, Any]:
    return {
        "id": "RPT-2026-10-03",
        "type": "DAILY",
        "status": "COMPLETED",
        "period_start": "2026-10-03T00:00:00+00:00",
        "period_end": "2026-10-04T00:00:00+00:00",
        "created_at": "2026-10-03T07:00:00+00:00",
        "completed_at": "2026-10-03T07:00:01+00:00",
        "failure_reason": None,
        "summary": {
            "report_version": "1.0.0",
            "daily_summary": {
                "transaction_count": 3,
            },
        },
        "download_url": (
            "/api/v1/reports/RPT-2026-10-03/download"
        ),
    }


def test_list_reports(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, int] = {}
    report = build_report()

    def fake_list_reports(
        *,
        page: int,
        page_size: int,
    ) -> tuple[list[dict[str, Any]], int]:
        request["page"] = page
        request["page_size"] = page_size
        return [report], 1

    monkeypatch.setattr(
        reports_api,
        "repository_list_reports",
        fake_list_reports,
    )

    response = client.get(
        "/api/v1/reports?page=2&page_size=10"
    )

    assert response.status_code == 200
    assert response.json() == {
        "items": [report],
        "total": 1,
        "page": 2,
        "page_size": 10,
    }
    assert request == {
        "page": 2,
        "page_size": 10,
    }


def test_create_daily_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, datetime] = {}
    report = build_report()

    def fake_generate_daily_report(
        *,
        period_start: datetime,
        period_end: datetime,
    ) -> dict[str, Any]:
        request["period_start"] = period_start
        request["period_end"] = period_end
        return report

    monkeypatch.setattr(
        reports_api,
        "generate_daily_report",
        fake_generate_daily_report,
    )

    response = client.post(
        "/api/v1/reports",
        json={
            "type": "DAILY",
            "period_start": "2026-10-03T00:00:00Z",
            "period_end": "2026-10-04T00:00:00Z",
        },
    )

    assert response.status_code == 201
    assert response.json() == report
    assert request["period_start"].isoformat() == (
        "2026-10-03T00:00:00+00:00"
    )
    assert request["period_end"].isoformat() == (
        "2026-10-04T00:00:00+00:00"
    )


def test_create_report_rejects_invalid_period(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def reject_period(
        *,
        period_start: datetime,
        period_end: datetime,
    ) -> dict[str, Any]:
        raise ValueError(
            "Daily report periods must cover one UTC day."
        )

    monkeypatch.setattr(
        reports_api,
        "generate_daily_report",
        reject_period,
    )

    response = client.post(
        "/api/v1/reports",
        json={
            "type": "DAILY",
            "period_start": "2026-10-03T01:00:00Z",
            "period_end": "2026-10-04T00:00:00Z",
        },
    )

    assert response.status_code == 422
    assert response.json()["detail"] == (
        "Daily report periods must cover one UTC day."
    )


def test_download_completed_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    report = build_report()

    monkeypatch.setattr(
        reports_api,
        "get_report_by_id",
        lambda report_id: report,
    )
    monkeypatch.setattr(
        reports_api,
        "build_report_csv",
        lambda selected_report: (
            "section,metric,value\n"
            "daily_summary,transaction_count,3\n"
        ),
    )

    response = client.get(
        "/api/v1/reports/RPT-2026-10-03/download"
    )

    assert response.status_code == 200
    assert response.headers["content-type"].startswith(
        "text/csv"
    )
    assert response.headers["content-disposition"] == (
        'attachment; filename="RPT-2026-10-03.csv"'
    )
    assert (
        "daily_summary,transaction_count,3"
        in response.text
    )


def test_download_missing_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        reports_api,
        "get_report_by_id",
        lambda report_id: None,
    )

    response = client.get(
        "/api/v1/reports/RPT-NOT-FOUND/download"
    )

    assert response.status_code == 404
    assert response.json()["detail"] == "Report not found."


def test_download_incomplete_report(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    report = build_report()
    report["status"] = "PENDING"
    report["download_url"] = None

    monkeypatch.setattr(
        reports_api,
        "get_report_by_id",
        lambda report_id: report,
    )

    response = client.get(
        "/api/v1/reports/RPT-2026-10-03/download"
    )

    assert response.status_code == 409
    assert response.json()["detail"] == (
        "Report is not ready for download."
    )


def test_report_schedule_status_is_admin_only_and_reports_runtime_flag(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(reports_api, "get_daily_report_schedule_status", lambda *, actor_id: {
        "next_period_start": "2026-10-04", "runs": []})
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "admin-1", "role": "ADMIN", "account_status": "ACTIVE"}
    monkeypatch.setenv("DAILY_REPORT_SCHEDULER_ENABLED", "true")
    try:
        response = client.get("/api/v1/reports/schedule")
        assert response.status_code == 200
        assert response.json() == {"enabled": True, "next_period_start": "2026-10-04", "runs": []}
        app.dependency_overrides[get_current_user] = lambda: {
            "id": "supervisor-1", "role": "SUPERVISOR", "account_status": "ACTIVE"}
        assert client.get("/api/v1/reports/schedule").status_code == 403
    finally:
        app.dependency_overrides.pop(get_current_user, None)
