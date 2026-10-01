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



def test_list_transactions_maps_rows_and_total(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}

    database_row = {
        "id": "TX-READ-001",
        "transaction_timestamp": "2026-09-28T10:00:00+00:00",
        "vendor_id": "V-001",
        "vendor_name": "Test Vendor",
        "invoice_number": "INV-001",
        "category": "Office Supplies",
        "amount": 250.0,
        "currency": "SAR",
        "created_by": "EMP-001",
        "approved_by": "MGR-001",
        "approver_role": "Manager",
        "approval_limit": None,
        "completeness_status": "PARTIAL",
        "missing_fields": ["approval_limit"],
        "ground_truth": {
            "is_anomaly": True,
        },
    }

    class FakeResponse:
        headers = {
            "content-range": "25-25/10000",
        }

        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [database_row]

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
            request.update(
                {
                    "endpoint": endpoint,
                    "headers": headers,
                    "params": params,
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

    transactions, total = repository.list_transactions(
        page=2,
        page_size=25,
    )

    assert total == 10_000
    assert len(transactions) == 1

    transaction = transactions[0]

    assert transaction["id"] == "TX-READ-001"
    assert transaction["timestamp"] == "2026-09-28T10:00:00+00:00"
    assert transaction["data_quality_status"] == "PARTIAL"
    assert transaction["missing_fields"] == ["approval_limit"]
    assert transaction["rule_status"] == "PASSED"
    assert transaction["risk_score"] is None
    assert "ground_truth" not in transaction

    assert request["params"]["offset"] == "25"
    assert request["params"]["limit"] == "25"
    assert "ground_truth" not in request["params"]["select"]
    assert request["headers"]["Prefer"] == "count=exact"
    assert request["headers"]["apikey"] == "sb_secret_test"
    assert "Authorization" not in request["headers"]


def test_get_transaction_by_id_and_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requested_ids: list[str] = []

    database_row = {
        "id": "TX-READ-002",
        "transaction_timestamp": "2026-09-28T11:00:00+00:00",
        "vendor_id": "V-002",
        "vendor_name": "Second Vendor",
        "invoice_number": "INV-002",
        "category": "Inventory",
        "amount": 500.0,
        "currency": "SAR",
        "created_by": "EMP-002",
        "approved_by": "MGR-002",
        "approver_role": "Manager",
        "approval_limit": 1000.0,
        "completeness_status": "COMPLETE",
        "missing_fields": [],
    }

    class FakeResponse:
        def __init__(
            self,
            payload: list[dict[str, Any]],
        ) -> None:
            self.payload = payload

        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return self.payload

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
            requested_id = params["id"]
            requested_ids.append(requested_id)

            if requested_id == "eq.TX-READ-002":
                return FakeResponse([database_row])

            return FakeResponse([])

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

    transaction = repository.get_transaction_by_id(
        "TX-READ-002",
    )
    missing_transaction = repository.get_transaction_by_id(
        "TX-DOES-NOT-EXIST",
    )

    assert transaction is not None
    assert transaction["id"] == "TX-READ-002"
    assert transaction["data_quality_status"] == "COMPLETE"
    assert len(transaction["rule_results"]) == 5

    rules = {
        result["rule_key"]: result
        for result in transaction["rule_results"]
    }

    assert (
        rules["segregation_of_duties"]["status"]
        == "PASSED"
    )
    assert rules["approval_limits"]["status"] == "PASSED"

    for rule_key in (
        "duplicate_payment",
        "invoice_splitting",
        "ghost_vendors",
    ):
        assert rules[rule_key]["status"] == "NOT_EVALUATED"

    assert all(
        result["rule_version"] == "1.0.0"
        for result in transaction["rule_results"]
    )
    assert all(
        result["evidence"]["eligible"] is True
        for result in transaction["rule_results"]
    )
    assert missing_transaction is None

    assert requested_ids == [
        "eq.TX-READ-002",
        "eq.TX-DOES-NOT-EXIST",
    ]
