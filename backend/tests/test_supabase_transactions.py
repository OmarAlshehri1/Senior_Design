from typing import Any

import pytest

from app.repositories import supabase_transactions as repository


def make_transaction(index: int = 1) -> dict[str, Any]:
    return {
        "id": f"TX-{index:05d}",
        "timestamp": "2026-09-28T10:00:00",
        "vendor_id": "V-001",
        "vendor_name": "Test Vendor",
        "invoice_number": f"INV-{index:05d}",
        "category": "Office Supplies",
        "amount": 250.0,
        "currency": "SAR",
        "created_by": "EMP-001",
        "approved_by": "MGR-001",
        "approver_role": "Manager",
        "approval_limit": None,
        "data_quality_status": "PARTIAL",
        "missing_fields": ["approval_limit"],
        "metadata": {
            "branch": "Riyadh",
            "ground_truth": {
                "is_anomaly": False,
                "violation_type": None,
            },
        },
    }


def test_database_row_separates_ground_truth() -> None:
    row = repository._to_database_row(make_transaction())

    assert row["transaction_timestamp"] == "2026-09-28T10:00:00"
    assert row["completeness_status"] == "PARTIAL"
    assert row["ground_truth"]["is_anomaly"] is False
    assert "ground_truth" not in row["metadata"]


def test_persistence_uses_batches_and_secret_header(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

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
            json: list[dict[str, Any]],
        ) -> FakeResponse:
            requests.append(
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

    transactions = [
        make_transaction(index)
        for index in range(501)
    ]

    persisted_rows = repository.persist_transactions(transactions)

    assert persisted_rows == 501
    assert len(requests) == 2
    assert len(requests[0]["json"]) == 500
    assert len(requests[1]["json"]) == 1
    assert requests[0]["headers"]["apikey"] == "sb_secret_test"
    assert "Authorization" not in requests[0]["headers"]
    assert requests[0]["endpoint"].endswith(
        "/rest/v1/transactions?on_conflict=id"
    )