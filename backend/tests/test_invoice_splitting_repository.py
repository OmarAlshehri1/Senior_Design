from typing import Any

import pytest

from app.repositories import (
    supabase_transactions as repository,
)


def test_get_invoice_splitting_contexts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [
                {
                    "transaction_id": "TX-001",
                    "historical_transaction_count": 2,
                    "window_total_amount": 1200.0,
                },
                {
                    "transaction_id": "TX-002",
                    "historical_transaction_count": 0,
                    "window_total_amount": 400.0,
                },
            ]

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
        FakeClient,
    )

    contexts = (
        repository.get_invoice_splitting_contexts(
            [
                "TX-001",
                "TX-002",
                "TX-001",
            ]
        )
    )

    assert contexts == {
        "TX-001": {
            "historical_transaction_count": 2,
            "window_total_amount": 1200.0,
        },
        "TX-002": {
            "historical_transaction_count": 0,
            "window_total_amount": 400.0,
        },
    }
    assert request["endpoint"].endswith(
        "/rest/v1/rpc/get_invoice_splitting_context"
    )
    assert request["json"] == {
        "transaction_ids": [
            "TX-001",
            "TX-002",
        ]
    }


def test_empty_invoice_splitting_lookup_skips_supabase(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnexpectedClient:
        def __init__(self, timeout: float) -> None:
            raise AssertionError(
                "Supabase must not be called."
            )

    monkeypatch.setattr(
        repository.httpx,
        "Client",
        UnexpectedClient,
    )

    assert (
        repository.get_invoice_splitting_contexts([])
        == {}
    )
