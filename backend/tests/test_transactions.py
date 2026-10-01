from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def make_api_transaction(
    transaction_id: str = "TX-READ-001",
) -> dict[str, Any]:
    return {
        "id": transaction_id,
        "timestamp": "2026-09-28T10:00:00+00:00",
        "vendor_id": "V-001",
        "vendor_name": "Test Vendor",
        "vendor_monitoring_status": None,
        "invoice_number": "INV-001",
        "category": "Office Supplies",
        "amount": 250.0,
        "currency": "SAR",
        "created_by": "EMP-001",
        "approved_by": "MGR-001",
        "approver_role": "Manager",
        "approval_limit": None,
        "data_quality_status": "PARTIAL",
        "missing_fields": ["approval_limit"],
        "rule_status": "NOT_EVALUATED",
        "rule_score": None,
        "ai_score": None,
        "risk_score": None,
        "risk_level": None,
        "rule_results": [],
        "explanation": None,
    }


def test_list_transactions(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    received: dict[str, int] = {}

    def fake_list_transactions(
        *,
        page: int,
        page_size: int,
    ) -> tuple[list[dict[str, Any]], int]:
        received["page"] = page
        received["page_size"] = page_size
        return [make_api_transaction()], 10_000

    monkeypatch.setattr(
        "app.api.transactions.list_transactions",
        fake_list_transactions,
    )

    response = client.get(
        "/api/v1/transactions",
        params={
            "page": 2,
            "page_size": 25,
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["total"] == 10_000
    assert body["page"] == 2
    assert body["page_size"] == 25
    assert len(body["items"]) == 1
    assert body["items"][0]["id"] == "TX-READ-001"
    assert "ground_truth" not in body["items"][0]
    assert received == {
        "page": 2,
        "page_size": 25,
    }


def test_get_transaction_and_not_found(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_get_transaction_by_id(
        transaction_id: str,
    ) -> dict[str, Any] | None:
        if transaction_id == "TX-READ-001":
            return make_api_transaction(transaction_id)

        return None

    monkeypatch.setattr(
        "app.api.transactions.get_transaction_by_id",
        fake_get_transaction_by_id,
    )

    response = client.get(
        "/api/v1/transactions/TX-READ-001",
    )
    missing_response = client.get(
        "/api/v1/transactions/TX-DOES-NOT-EXIST",
    )

    assert response.status_code == 200
    assert response.json()["id"] == "TX-READ-001"

    assert missing_response.status_code == 404
    assert missing_response.json()["detail"] == "Transaction not found."


def test_create_complete_transaction() -> None:
    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-TEST-001",
            "timestamp": "2026-09-28T08:00:00Z",
            "vendor_id": "VEN-001",
            "vendor_name": "Riyadh Wholesale Trading",
            "invoice_number": "INV-1001",
            "category": "Inventory",
            "amount": 18750,
            "currency": "SAR",
            "created_by": "EMP-101",
            "approved_by": "MGR-201",
            "approver_role": "Store Manager",
            "approval_limit": 20000,
        },
    )

    assert response.status_code == 201

    body = response.json()

    assert body["id"] == "TX-TEST-001"
    assert body["amount"] == 18750
    assert body["data_quality_status"] == "COMPLETE"
    assert body["missing_fields"] == []
    assert body["rule_status"] == "PASSED"
    assert len(body["rule_results"]) == 5

    rules = {
        result["rule_key"]: result
        for result in body["rule_results"]
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
        for result in body["rule_results"]
    )
    assert all(
        result["evidence"]["eligible"] is True
        for result in body["rule_results"]
    )
    assert "transaction" not in body
    assert "persisted_rows" not in body


def test_create_partial_transaction() -> None:
    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-TEST-002",
        },
    )

    assert response.status_code == 201

    body = response.json()

    assert body["id"] == "TX-TEST-002"
    assert body["data_quality_status"] == "PARTIAL"
    assert "vendor_id" in body["missing_fields"]
    assert "amount" in body["missing_fields"]
    assert body["risk_score"] is None

    rules = {
        result["rule_key"]: result
        for result in body["rule_results"]
    }

    assert len(rules) == 5
    assert all(
        result["status"] == "NOT_EVALUATED"
        for result in rules.values()
    )

    assert (
        rules["approval_limits"]["evidence"][
            "eligible"
        ]
        is False
    )
    assert rules["approval_limits"]["evidence"][
        "missing_fields"
    ] == [
        "amount",
        "approval_limit",
    ]

    assert (
        rules["ghost_vendors"]["evidence"][
            "eligible"
        ]
        is False
    )
    assert rules["ghost_vendors"]["evidence"][
        "missing_any_of"
    ] == [
        [
            "vendor_id",
            "vendor_name",
        ]
    ]


def test_reject_invalid_currency() -> None:
    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-TEST-003",
            "currency": "sar",
        },
    )

    assert response.status_code == 422


def test_excel_import_is_not_a_runtime_endpoint() -> None:
    response = client.get("/openapi.json")

    assert response.status_code == 200
    assert (
        "/api/v1/transactions/import"
        not in response.json()["paths"]
    )

def test_create_transaction_requiring_review() -> None:
    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-TEST-REVIEW-001",
            "timestamp": "2026-10-01T12:00:00Z",
            "vendor_id": "VEN-001",
            "vendor_name": "Test Vendor",
            "invoice_number": "INV-REVIEW-001",
            "category": "Inventory",
            "amount": 500,
            "currency": "SAR",
            "created_by": "EMP-001",
            "approved_by": "EMP-001",
            "approver_role": "Manager",
            "approval_limit": 1000,
        },
    )

    assert response.status_code == 201

    body = response.json()
    rules = {
        result["rule_key"]: result
        for result in body["rule_results"]
    }

    assert body["rule_status"] == "REVIEW"
    assert (
        rules["segregation_of_duties"]["status"]
        == "FAILED"
    )
    assert rules["approval_limits"]["status"] == "PASSED"
