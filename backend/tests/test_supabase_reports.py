from datetime import datetime, timezone
from typing import Any

import pytest

from app.repositories import supabase_reports as repository


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


def build_report_row() -> dict[str, Any]:
    return {
        "id": "RPT-2026-10-03",
        "report_type": "DAILY",
        "status": "COMPLETED",
        "period_start": "2026-10-03T00:00:00+00:00",
        "period_end": "2026-10-04T00:00:00+00:00",
        "summary": {
            "report_version": "1.0.0",
            "daily_summary": {
                "transaction_count": 3,
            },
        },
        "created_at": "2026-10-03T07:00:00+00:00",
        "completed_at": "2026-10-03T07:00:01+00:00",
        "failure_reason": None,
    }


@pytest.fixture
def supabase_environment(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        "SUPABASE_URL",
        "https://example.supabase.co",
    )
    monkeypatch.setenv(
        "SUPABASE_SECRET_KEY",
        "sb_secret_test",
    )


def test_get_daily_audit_summary(
    monkeypatch: pytest.MonkeyPatch,
    supabase_environment: None,
) -> None:
    request: dict[str, Any] = {}
    summary = {
        "daily_summary": {
            "transaction_count": 3,
        },
        "risk_distribution": {
            "LOW": 1,
            "MEDIUM": 0,
            "HIGH": 2,
        },
    }

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return summary

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            request["timeout"] = timeout

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(
            self,
            exc_type: object,
            exc_value: object,
            traceback: object,
        ) -> None:
            return None

        def post(
            self,
            endpoint: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            request.update(
                {
                    "endpoint": endpoint,
                    "headers": headers,
                    "json": json,
                }
            )
            return FakeResponse()

    monkeypatch.setattr(
        repository.httpx,
        "Client",
        FakeClient,
    )

    result = repository.get_daily_audit_summary(
        period_start=PERIOD_START,
        period_end=PERIOD_END,
    )

    assert result == summary
    assert request["endpoint"] == (
        "https://example.supabase.co/rest/v1/rpc/"
        "get_daily_audit_summary"
    )
    assert request["json"] == {
        "p_period_start": "2026-10-03T00:00:00+00:00",
        "p_period_end": "2026-10-04T00:00:00+00:00",
    }
    assert request["headers"]["apikey"] == "sb_secret_test"


def test_persist_completed_report(
    monkeypatch: pytest.MonkeyPatch,
    supabase_environment: None,
) -> None:
    request: dict[str, Any] = {}
    report_row = build_report_row()

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [report_row]

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            request["timeout"] = timeout

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(
            self,
            exc_type: object,
            exc_value: object,
            traceback: object,
        ) -> None:
            return None

        def post(
            self,
            endpoint: str,
            *,
            headers: dict[str, str],
            params: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            request.update(
                {
                    "endpoint": endpoint,
                    "headers": headers,
                    "params": params,
                    "json": json,
                }
            )
            return FakeResponse()

    monkeypatch.setattr(
        repository.httpx,
        "Client",
        FakeClient,
    )

    report = repository.persist_completed_report(
        report_id="RPT-2026-10-03",
        period_start=PERIOD_START,
        period_end=PERIOD_END,
        summary=report_row["summary"],
    )

    assert report["id"] == "RPT-2026-10-03"
    assert report["type"] == "DAILY"
    assert report["status"] == "COMPLETED"
    assert report["download_url"] == (
        "/api/v1/reports/RPT-2026-10-03/download"
    )

    assert request["endpoint"] == (
        "https://example.supabase.co/rest/v1/audit_reports"
    )
    assert request["params"] == {
        "on_conflict": "period_start,period_end",
        "select": repository.REPORT_COLUMNS,
    }
    assert request["headers"]["Prefer"] == (
        "resolution=ignore-duplicates,return=representation"
    )
    assert request["json"]["id"] == "RPT-2026-10-03"
    assert request["json"]["report_type"] == "DAILY"
    assert request["json"]["status"] == "COMPLETED"
    assert isinstance(request["json"]["completed_at"], str)


def test_persist_completed_report_does_not_replace_an_existing_daily_report(
    monkeypatch: pytest.MonkeyPatch,
    supabase_environment: None,
) -> None:
    requests: list[str] = []
    report_row = build_report_row()

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [] if requests[-1] == "POST" else [report_row]

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            pass

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(self, exc_type: object, exc_value: object, traceback: object) -> None:
            return None

        def post(self, endpoint: str, **_kwargs: Any) -> FakeResponse:
            requests.append("POST")
            return FakeResponse()

        def get(self, endpoint: str, *, headers: dict[str, str], params: dict[str, str]) -> FakeResponse:
            requests.append("GET")
            assert params["id"] == "eq.RPT-2026-10-03"
            return FakeResponse()

    monkeypatch.setattr(repository.httpx, "Client", FakeClient)
    original = repository.persist_completed_report(
        report_id="RPT-2026-10-03", period_start=PERIOD_START, period_end=PERIOD_END,
        summary={"daily_summary": {"transaction_count": 999}},
    )

    assert requests == ["POST", "GET"]
    assert original["summary"]["daily_summary"]["transaction_count"] == 3


def test_list_reports_maps_rows_and_total(
    monkeypatch: pytest.MonkeyPatch,
    supabase_environment: None,
) -> None:
    request: dict[str, Any] = {}
    report_row = build_report_row()

    class FakeResponse:
        headers = {
            "content-range": "25-25/40",
        }

        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [report_row]

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            request["timeout"] = timeout

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(
            self,
            exc_type: object,
            exc_value: object,
            traceback: object,
        ) -> None:
            return None

        def get(
            self,
            endpoint: str,
            *,
            headers: dict[str, str],
            params: dict[str, str],
        ) -> FakeResponse:
            request.update(
                {
                    "endpoint": endpoint,
                    "headers": headers,
                    "params": params,
                }
            )
            return FakeResponse()

    monkeypatch.setattr(
        repository.httpx,
        "Client",
        FakeClient,
    )

    reports, total = repository.list_reports(
        page=2,
        page_size=25,
    )

    assert total == 40
    assert len(reports) == 1
    assert reports[0]["id"] == "RPT-2026-10-03"
    assert reports[0]["download_url"] == (
        "/api/v1/reports/RPT-2026-10-03/download"
    )

    assert request["headers"]["Prefer"] == "count=exact"
    assert request["params"]["offset"] == "25"
    assert request["params"]["limit"] == "25"
    assert request["params"]["order"] == (
        "created_at.desc,id.asc"
    )


def test_get_report_by_id_and_not_found(
    monkeypatch: pytest.MonkeyPatch,
    supabase_environment: None,
) -> None:
    requested_ids: list[str] = []
    report_row = build_report_row()

    class FakeResponse:
        def __init__(
            self,
            rows: list[dict[str, Any]],
        ) -> None:
            self.rows = rows

        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return self.rows

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(
            self,
            exc_type: object,
            exc_value: object,
            traceback: object,
        ) -> None:
            return None

        def get(
            self,
            endpoint: str,
            *,
            headers: dict[str, str],
            params: dict[str, str],
        ) -> FakeResponse:
            requested_ids.append(params["id"])

            if params["id"] == "eq.RPT-2026-10-03":
                return FakeResponse([report_row])

            return FakeResponse([])

    monkeypatch.setattr(
        repository.httpx,
        "Client",
        FakeClient,
    )

    report = repository.get_report_by_id(
        "RPT-2026-10-03"
    )
    missing_report = repository.get_report_by_id(
        "RPT-NOT-FOUND"
    )

    assert report is not None
    assert report["id"] == "RPT-2026-10-03"
    assert report["status"] == "COMPLETED"
    assert report["download_url"] == (
        "/api/v1/reports/RPT-2026-10-03/download"
    )
    assert missing_report is None
    assert requested_ids == [
        "eq.RPT-2026-10-03",
        "eq.RPT-NOT-FOUND",
    ]
