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

def test_persist_transaction_evaluation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}

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

    rule_results = [
        {
            "rule_key": "ghost_vendors",
            "rule_name": "Ghost Vendors",
            "rule_version": "1.0.0",
            "status": "FAILED",
            "score_contribution": 33.33,
            "detail": "Manual review is required.",
            "evidence": {
                "eligible": True,
                "manual_review_required": True,
            },
        }
    ]

    repository.persist_transaction_evaluation(
        transaction_id="TX-EVAL-001",
        evaluation_version="1.0.0",
        rule_status="REVIEW",
        rule_score=33.33,
        rule_results=rule_results,
    )

    assert request["endpoint"].endswith(
        "/rest/v1/transaction_evaluations"
    )
    assert request["headers"]["apikey"] == "sb_secret_test"
    assert "Authorization" not in request["headers"]
    assert request["headers"]["Prefer"] == "return=minimal"
    assert request["json"] == {
        "transaction_id": "TX-EVAL-001",
        "evaluation_version": "1.0.0",
        "rule_status": "REVIEW",
        "rule_score": 33.33,
        "rule_results": rule_results,
    }
    assert "ground_truth" not in request["json"]

def test_get_latest_transaction_evaluations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [
                {
                    "transaction_id": "TX-EVAL-001",
                    "evaluation_version": "1.0.0",
                    "rule_status": "REVIEW",
                    "rule_score": 33.33,
                    "rule_results": [
                        {
                            "rule_key": "ghost_vendors",
                            "status": "FAILED",
                        }
                    ],
                    "evaluated_at": "2026-10-02T15:00:00+00:00",
                }
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

    evaluations = (
        repository.get_latest_transaction_evaluations(
            [
                "TX-EVAL-001",
                "TX-EVAL-001",
                "",
            ]
        )
    )

    assert evaluations == {
        "TX-EVAL-001": {
            "evaluation_version": "1.0.0",
            "rule_status": "REVIEW",
            "rule_score": 33.33,
            "rule_results": [
                {
                    "rule_key": "ghost_vendors",
                    "status": "FAILED",
                }
            ],
            "evaluated_at": "2026-10-02T15:00:00+00:00",
        }
    }
    assert request["endpoint"].endswith(
        "/rest/v1/rpc/get_latest_transaction_evaluations"
    )
    assert request["json"] == {
        "transaction_ids": ["TX-EVAL-001"]
    }

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
    monkeypatch.setattr(
        repository,
        "get_duplicate_payment_counts",
        lambda transaction_ids: {
            transaction_id: 0
            for transaction_id in transaction_ids
        },
    )

    monkeypatch.setattr(
        repository,
        "get_invoice_splitting_contexts",
        lambda transaction_ids: {
            transaction_id: {
                "historical_transaction_count": 0,
                "window_total_amount": 250.0,
            }
            for transaction_id in transaction_ids
        },
    )

    monkeypatch.setattr(
        repository,
        "get_ghost_vendor_contexts",
        lambda transaction_ids: {
            transaction_id: {
                "registry_authoritative": True,
                "vendor_registered": True,
                "vendor_active": True,
            }
            for transaction_id in transaction_ids
        },
    )

    monkeypatch.setattr(
        repository,
        "get_latest_transaction_evaluations",
        lambda transaction_ids: {},
    )

    monkeypatch.setattr(
        repository,
        "get_latest_transaction_anomaly_scores",
        lambda transaction_ids: {
            "TX-READ-001": {
                "ai_score": 87.5,
                "threshold": 90.6,
                "is_anomalous": False,
                "model_version": "1.0.0",
            }
        },
    )

    monkeypatch.setattr(
        repository,
        "get_latest_transaction_risk_scores",
        lambda transaction_ids: {
            "TX-READ-001": {
                "risk_score": 58.0,
                "risk_level": "MEDIUM",
            }
        },
    )

    transactions, total = repository.list_transactions(
        page=2,
        page_size=25,
        search="Test Vendor",
        sort_by="highest-amount",
    )

    assert total == 10_000
    assert len(transactions) == 1

    transaction = transactions[0]

    assert transaction["id"] == "TX-READ-001"
    assert transaction["timestamp"] == "2026-09-28T10:00:00+00:00"
    assert transaction["data_quality_status"] == "PARTIAL"
    assert transaction["missing_fields"] == ["approval_limit"]
    assert transaction["rule_status"] == "PASSED"
    assert transaction["rule_score"] == 0.0

    evaluated_results = [
        result
        for result in transaction["rule_results"]
        if result["status"] != "NOT_EVALUATED"
    ]
    not_evaluated_results = [
        result
        for result in transaction["rule_results"]
        if result["status"] == "NOT_EVALUATED"
    ]

    assert all(
        result["score_contribution"] == 0.0
        for result in evaluated_results
    )
    assert all(
        result["score_contribution"] is None
        for result in not_evaluated_results
    )
    assert transaction["risk_score"] == 58.0
    assert transaction["risk_level"] == "MEDIUM"
    assert transaction["ai_score"] == 87.5
    assert "ground_truth" not in transaction

    assert request["params"]["offset"] == "25"
    assert request["params"]["limit"] == "25"
    assert request["params"]["order"] == (
    "amount.desc.nullslast,id.asc"
    )
    assert request["params"]["or"] == (
        "(id.ilike.*Test Vendor*,"
        "vendor_name.ilike.*Test Vendor*,"
        "category.ilike.*Test Vendor*)"
    )
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
    monkeypatch.setattr(
        repository,
        "get_duplicate_payment_counts",
        lambda transaction_ids: {
            transaction_id: 0
            for transaction_id in transaction_ids
        },
    )

    monkeypatch.setattr(
        repository,
        "get_invoice_splitting_contexts",
        lambda transaction_ids: {
            transaction_id: {
                "historical_transaction_count": 0,
                "window_total_amount": 500.0,
            }
            for transaction_id in transaction_ids
        },
    )

    monkeypatch.setattr(
        repository,
        "get_ghost_vendor_contexts",
        lambda transaction_ids: {
            transaction_id: {
                "registry_authoritative": True,
                "vendor_registered": True,
                "vendor_active": True,
            }
            for transaction_id in transaction_ids
        },
    )

    monkeypatch.setattr(
        repository,
        "get_latest_transaction_evaluations",
        lambda transaction_ids: {},
    )

    monkeypatch.setattr(
        repository,
        "get_latest_transaction_anomaly_scores",
        lambda transaction_ids: {
            "TX-READ-002": {
                "ai_score": 42.0,
                "threshold": 90.6,
                "is_anomalous": False,
                "model_version": "1.0.0",
            }
        },
    )

    monkeypatch.setattr(
        repository,
        "get_latest_transaction_risk_scores",
        lambda transaction_ids: {
            "TX-READ-002": {
                "risk_score": 42.0,
                "risk_level": "LOW",
            }
        },
    )

    transaction = repository.get_transaction_by_id(
        "TX-READ-002",
    )
    missing_transaction = repository.get_transaction_by_id(
        "TX-DOES-NOT-EXIST",
    )

    assert transaction is not None
    assert transaction["id"] == "TX-READ-002"
    assert transaction["ai_score"] == 42.0
    assert transaction["risk_score"] == 42.0
    assert transaction["risk_level"] == "LOW"
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

    assert (
        rules["duplicate_payment"]["status"]
        == "PASSED"
    )

    assert (
        rules["invoice_splitting"]["status"]
        == "PASSED"
    )

    assert (
        rules["ghost_vendors"]["status"]
        == "PASSED"
    )

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

def test_database_row_prefers_persisted_evaluation() -> None:
    transaction = repository._from_database_row(
        {
            "id": "TX-EVAL-READ-001",
            "transaction_timestamp": "2026-10-02T15:00:00+00:00",
            "completeness_status": "COMPLETE",
            "missing_fields": [],
        },
        duplicate_payment_count=0,
        persisted_evaluation={
            "evaluation_version": "1.0.0",
            "rule_status": "REVIEW",
            "rule_score": 33.33,
            "rule_results": [
                {
                    "rule_key": "ghost_vendors",
                    "status": "FAILED",
                    "score_contribution": 33.33,
                }
            ],
            "evaluated_at": "2026-10-02T15:01:00+00:00",
        },
    )

    assert transaction["rule_status"] == "REVIEW"
    assert transaction["rule_score"] == 33.33
    assert transaction["rule_results"] == [
        {
            "rule_key": "ghost_vendors",
            "status": "FAILED",
            "score_contribution": 33.33,
        }
    ]

def test_get_evaluation_coverage(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [
                {
                    "total_transaction_count": 10_001,
                    "evaluated_transaction_count": 1,
                    "unevaluated_transaction_count": 10_000,
                    "coverage_percent": 0.01,
                }
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

    coverage = repository.get_evaluation_coverage()

    assert coverage == {
        "total_transaction_count": 10_001,
        "evaluated_transaction_count": 1,
        "unevaluated_transaction_count": 10_000,
        "coverage_percent": 0.01,
    }
    assert request["endpoint"].endswith(
        "/rest/v1/rpc/get_evaluation_coverage"
    )
    assert request["json"] == {}

def test_persist_transaction_evaluations_batch(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}

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

    evaluations = [
        {
            "transaction_id": "TX-001",
            "evaluation_version": "1.0.0",
            "rule_status": "PASSED",
            "rule_score": 0.0,
            "rule_results": [],
        },
        {
            "transaction_id": "TX-002",
            "evaluation_version": "1.0.0",
            "rule_status": "REVIEW",
            "rule_score": 50.0,
            "rule_results": [],
        },
    ]

    persisted = (
        repository.persist_transaction_evaluations(
            evaluations
        )
    )

    assert persisted == 2
    assert request["json"] == evaluations
    assert request["endpoint"].endswith(
        "/rest/v1/transaction_evaluations"
    )
    assert request["headers"]["Prefer"] == "return=minimal"

def test_persist_and_read_anomaly_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[dict[str, Any]] = []

    class FakeResponse:
        def __init__(
            self,
            payload: list[dict[str, Any]] | None = None,
        ) -> None:
            self.payload = payload or []

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

        def post(
            self,
            endpoint: str,
            *,
            headers: dict[str, str],
            json: Any,
        ) -> FakeResponse:
            requests.append(
                {
                    "endpoint": endpoint,
                    "headers": headers,
                    "json": json,
                }
            )

            if endpoint.endswith(
                "/rpc/"
                "get_latest_transaction_anomaly_scores"
            ):
                return FakeResponse(
                    [
                        {
                            "transaction_id": "TX-AI-001",
                            "model_version": "1.0.0",
                            "ai_score": 93.25,
                            "threshold": 90.6,
                            "is_anomalous": True,
                            "scored_at": (
                                "2026-10-02T19:00:00+00:00"
                            ),
                        }
                    ]
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

    rows = [
        {
            "transaction_id": "TX-AI-001",
            "model_version": "1.0.0",
            "ai_score": 93.25,
            "threshold": 90.6,
            "is_anomalous": True,
        }
    ]

    assert (
        repository.persist_transaction_anomaly_scores(
            rows
        )
        == 1
    )

    scores = (
        repository.get_latest_transaction_anomaly_scores(
            ["TX-AI-001", "TX-AI-001", ""]
        )
    )

    assert scores["TX-AI-001"] == {
        "model_version": "1.0.0",
        "ai_score": 93.25,
        "threshold": 90.6,
        "is_anomalous": True,
        "scored_at": "2026-10-02T19:00:00+00:00",
    }
    assert requests[0]["json"] == rows
    assert requests[1]["json"] == {
        "transaction_ids": ["TX-AI-001"]
    }

def test_persist_and_read_combined_risk_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests: list[dict[str, Any]] = []

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

        def post(
            self,
            endpoint: str,
            *,
            headers: dict[str, str],
            json: Any,
        ) -> FakeResponse:
            requests.append(
                {
                    "endpoint": endpoint,
                    "headers": headers,
                    "json": json,
                }
            )

            if endpoint.endswith(
                "/rpc/get_latest_transaction_risk_scores"
            ):
                return FakeResponse(
                    [
                        {
                            "transaction_id": "TX-RISK-001",
                            "scoring_version": "1.0.0",
                            "rule_evaluation_version": "1.0.0",
                            "anomaly_model_version": "1.0.0",
                            "rule_score": 33.33,
                            "ai_score": 95.0,
                            "risk_score": 58.0,
                            "risk_level": "MEDIUM",
                            "calculated_at": (
                                "2026-10-03T02:00:00+00:00"
                            ),
                        }
                    ]
                )

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

    persisted = repository.persist_transaction_risk_scores(
        [
            {
                "transaction_id": "TX-RISK-001",
                "scoring_version": "1.0.0",
                "rule_evaluation_version": "1.0.0",
                "anomaly_model_version": "1.0.0",
                "rule_score": 33.33,
                "ai_score": 95.0,
                "risk_score": 58.0,
                "risk_level": "MEDIUM",
            }
        ]
    )

    scores = repository.get_latest_transaction_risk_scores(
        [
            "TX-RISK-001",
            "TX-RISK-001",
            "",
        ]
    )

    assert persisted == 1
    assert scores["TX-RISK-001"] == {
        "scoring_version": "1.0.0",
        "rule_evaluation_version": "1.0.0",
        "anomaly_model_version": "1.0.0",
        "rule_score": 33.33,
        "ai_score": 95.0,
        "risk_score": 58.0,
        "risk_level": "MEDIUM",
        "calculated_at": "2026-10-03T02:00:00+00:00",
    }

    assert requests[0]["endpoint"].endswith(
        "/transaction_risk_scores"
    )
    assert requests[0]["headers"]["Prefer"] == (
        "return=minimal"
    )
    assert requests[1]["endpoint"].endswith(
        "/rpc/get_latest_transaction_risk_scores"
    )
    assert requests[1]["json"] == {
        "transaction_ids": ["TX-RISK-001"],
    }
