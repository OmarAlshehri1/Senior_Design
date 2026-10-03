from datetime import datetime, timezone
from typing import Any

import pytest

from app.repositories import supabase_alerts as repository


def configure_repository(
    monkeypatch: pytest.MonkeyPatch,
    client_type: type,
) -> None:
    monkeypatch.setenv(
        "SUPABASE_URL",
        "https://example.supabase.co",
    )
    monkeypatch.setenv(
        "SUPABASE_SECRET_KEY",
        "sb_secret_test",
    )
    monkeypatch.setattr(
        repository.httpx,
        "Client",
        client_type,
    )


def build_alert() -> dict[str, Any]:
    return {
        "id": "AL-001",
        "transaction_id": "TX-HIGH-001",
        "created_at": "2026-10-03T03:00:01+00:00",
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
        "reviewed_at": None,
        "risk_score": 82.5,
        "risk_scoring_version": "1.0.0",
        "latency_ms": 420.0,
    }


def test_create_high_risk_alert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [build_alert()]

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

    configure_repository(monkeypatch, FakeClient)

    alert = repository.create_high_risk_alert(
        transaction_id="TX-HIGH-001",
        risk_score=82.5,
        risk_scoring_version="1.0.0",
        request_received_at=datetime(
            2026,
            10,
            3,
            3,
            0,
            tzinfo=timezone.utc,
        ),
    )

    assert alert["id"] == "AL-001"
    assert alert["status"] == "ACTIVE"
    assert alert["latency_ms"] == 420.0
    assert request["endpoint"].endswith(
        "/rest/v1/alerts"
    )
    assert request["json"]["severity"] == "HIGH"
    assert request["json"]["risk_score"] == 82.5
    assert request["headers"]["Prefer"] == (
        "return=representation"
    )


def test_list_alerts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}
    monkeypatch.setattr(repository.identity, "rpc", lambda name, **kwargs: request.update({"name": name, **kwargs}) or {
        "items": [build_alert()], "total": 52, "page": 2, "page_size": 25,
    })

    alerts, total = repository.list_alerts(
        actor_id="actor-1",
        page=2,
        page_size=25,
        status_filter="ACTIVE",
    )

    assert total == 52
    assert len(alerts) == 1
    assert alerts[0]["transaction_id"] == "TX-HIGH-001"
    assert request == {"name": "list_accessible_alerts", "p_actor": "actor-1", "p_page": 2,
                       "p_page_size": 25, "p_status": "ACTIVE"}


def test_mark_alert_reviewed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}
    reviewed_alert = {
        **build_alert(),
        "status": "REVIEWED",
        "reviewed_at": "2026-10-03T03:05:00+00:00",
    }

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [reviewed_alert]

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

        def patch(
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

    configure_repository(monkeypatch, FakeClient)

    alert = repository.mark_alert_reviewed("AL-001")

    assert alert is not None
    assert alert["status"] == "REVIEWED"
    assert alert["reviewed_at"] is not None
    assert request["params"]["id"] == "eq.AL-001"
    assert request["json"]["status"] == "REVIEWED"
    assert isinstance(request["json"]["reviewed_at"], str)
