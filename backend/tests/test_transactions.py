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
    received: dict[str, object] = {}

    def fake_list_transactions(
        *,
        page: int,
        page_size: int,
        search: str | None,
        sort_by: str,
    ) -> tuple[list[dict[str, Any]], int]:
        received["page"] = page
        received["page_size"] = page_size
        received["search"] = search
        received["sort_by"] = sort_by
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
            "search": "Almarai",
            "sort_by": "highest-amount",
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
        "search": "Almarai",
        "sort_by": "highest-amount",
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


def test_create_complete_transaction(
    monkeypatch: pytest.MonkeyPatch,
) -> None:

    persisted_evaluation: dict[str, Any] = {}

    def capture_evaluation(**evaluation: Any) -> None:
        persisted_evaluation.update(evaluation)

    monkeypatch.setattr(
        (
            "app.api.transactions."
            "persist_transaction_evaluation"
        ),
        capture_evaluation,
    )

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
    assert body["ai_score"] == 25.0
    assert body["risk_score"] == 10.0
    assert body["risk_level"] == "LOW"
    assert body["rule_score"] == 0.0
    assert len(body["rule_results"]) == 5

    rules = {
        result["rule_key"]: result
        for result in body["rule_results"]
    }

    assert all(
        result["score_contribution"] == 0.0
        for result in body["rule_results"]
    )

    assert (
        rules["segregation_of_duties"]["status"]
        == "PASSED"
    )
    assert rules["approval_limits"]["status"] == "PASSED"

    assert rules["duplicate_payment"]["status"] == "PASSED"

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
        for result in body["rule_results"]
    )
    assert all(
        result["evidence"]["eligible"] is True
        for result in body["rule_results"]
    )
    assert "transaction" not in body
    assert "persisted_rows" not in body

    assert persisted_evaluation["transaction_id"] == "TX-TEST-001"
    assert persisted_evaluation["evaluation_version"] == "1.0.0"
    assert persisted_evaluation["rule_status"] == "PASSED"
    assert persisted_evaluation["rule_score"] == 0.0
    assert (
        persisted_evaluation["rule_results"]
        == body["rule_results"]
    )


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

def test_create_duplicate_payment(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        (
            "app.api.transactions."
            "get_duplicate_payment_counts"
        ),
        lambda transaction_ids: {
            transaction_ids[0]: 2,
        },
    )

    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-DUPLICATE-001",
            "timestamp": "2026-10-01T13:00:00Z",
            "vendor_id": "VEN-001",
            "vendor_name": "Test Vendor",
            "invoice_number": "INV-DUPLICATE-001",
            "category": "Inventory",
            "amount": 500,
            "currency": "SAR",
            "created_by": "EMP-001",
            "approved_by": "MGR-001",
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

    duplicate = rules["duplicate_payment"]

    assert body["rule_status"] == "REVIEW"
    assert duplicate["status"] == "FAILED"
    assert duplicate["evidence"][
        "matching_transaction_count"
    ] == 2

def test_create_invoice_splitting(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        (
            "app.api.transactions."
            "get_invoice_splitting_contexts"
        ),
        lambda transaction_ids: {
            transaction_ids[0]: {
                "historical_transaction_count": 2,
                "window_total_amount": 1200.0,
            },
        },
    )

    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-SPLIT-001",
            "timestamp": "2026-10-02T08:00:00Z",
            "vendor_id": "VEN-SPLIT-001",
            "vendor_name": "Split Test Vendor",
            "invoice_number": "INV-SPLIT-001",
            "category": "Inventory",
            "amount": 500,
            "currency": "SAR",
            "created_by": "EMP-001",
            "approved_by": "MGR-001",
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

    invoice_splitting = rules["invoice_splitting"]

    assert body["rule_status"] == "REVIEW"
    assert invoice_splitting["status"] == "FAILED"
    assert invoice_splitting["evidence"][
        "historical_transaction_count"
    ] == 2
    assert invoice_splitting["evidence"][
        "window_total_amount"
    ] == 1200.0
    assert invoice_splitting["evidence"][
        "window_hours"
    ] == 24
    assert (
        "matching_transaction_ids"
        not in invoice_splitting["evidence"]
    )

def test_create_unregistered_vendor_requires_review(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        (
            "app.api.transactions."
            "get_ghost_vendor_contexts"
        ),
        lambda transaction_ids: {
            transaction_ids[0]: {
                "registry_authoritative": True,
                "vendor_registered": False,
                "vendor_active": False,
            },
        },
    )

    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-NEW-VENDOR-001",
            "timestamp": "2026-10-02T11:00:00Z",
            "vendor_id": "VND-NEW-001",
            "vendor_name": "New Legitimate Supplier",
            "invoice_number": "INV-NEW-001",
            "category": "Inventory",
            "amount": 500,
            "currency": "SAR",
            "created_by": "EMP-101",
            "approved_by": "MGR-201",
            "approver_role": "Store Manager",
            "approval_limit": 1000,
        },
    )

    assert response.status_code == 201

    body = response.json()
    rules = {
        result["rule_key"]: result
        for result in body["rule_results"]
    }
    ghost_vendor = rules["ghost_vendors"]

    assert body["rule_status"] == "REVIEW"
    assert body["rule_score"] == 20.0
    assert ghost_vendor["score_contribution"] == 20.0

    assert all(
        result["score_contribution"] == 0.0
        for result in body["rule_results"]
        if result["status"] == "PASSED"
    )
    assert ghost_vendor["status"] == "FAILED"
    assert ghost_vendor["evidence"][
        "vendor_registry_available"
    ] is True
    assert ghost_vendor["evidence"][
        "vendor_registered"
    ] is False
    assert ghost_vendor["evidence"][
        "vendor_active"
    ] is None
    assert ghost_vendor["evidence"][
        "manual_review_required"
    ] is True
    assert "manual review" in ghost_vendor["detail"].lower()
    assert "ghost" not in ghost_vendor["detail"].lower()

def test_local_frontend_origin_is_allowed() -> None:
    response = client.get(
        "/api/v1/health",
        headers={
            "Origin": "http://localhost:5173",
        },
    )

    assert response.status_code == 200
    assert (
        response.headers["access-control-allow-origin"]
        == "http://localhost:5173"
    )


def test_unknown_frontend_origin_is_not_allowed() -> None:
    response = client.get(
        "/api/v1/health",
        headers={
            "Origin": "https://untrusted.example",
        },
    )

    assert response.status_code == 200
    assert "access-control-allow-origin" not in response.headers

def test_create_transaction_persists_anomaly_score(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted_scores: list[dict[str, Any]] = []

    def capture_scores(
        scores: list[dict[str, Any]],
    ) -> int:
        persisted_scores.extend(scores)
        return len(scores)

    monkeypatch.setattr(
        (
            "app.api.transactions."
            "persist_transaction_anomaly_scores"
        ),
        capture_scores,
    )

    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-AI-SCORE-001",
            "timestamp": "2026-10-02T19:00:00Z",
            "vendor_id": "VND-101",
            "vendor_name": "Almarai Dairy Co.",
            "invoice_number": "INV-AI-SCORE-001",
            "category": "Inventory",
            "amount": 500,
            "currency": "SAR",
            "created_by": "EMP-101",
            "approved_by": "MGR-201",
            "approver_role": "Manager",
            "approval_limit": 1000,
        },
    )

    assert response.status_code == 201
    assert response.json()["ai_score"] == 25.0
    assert persisted_scores == [
        {
            "transaction_id": "TX-AI-SCORE-001",
            "model_version": "1.0.0",
            "ai_score": 25.0,
            "threshold": 90.6,
            "is_anomalous": False,
        }
    ]

def test_create_transaction_persists_risk_score(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted_scores: list[dict[str, Any]] = []

    def capture_scores(
        scores: list[dict[str, Any]],
    ) -> int:
        persisted_scores.extend(scores)
        return len(scores)

    monkeypatch.setattr(
        (
            "app.api.transactions."
            "persist_transaction_risk_scores"
        ),
        capture_scores,
    )

    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-RISK-SCORE-001",
            "timestamp": "2026-10-03T02:00:00Z",
            "vendor_id": "VND-101",
            "vendor_name": "Almarai Dairy Co.",
            "invoice_number": "INV-RISK-SCORE-001",
            "category": "Inventory",
            "amount": 500,
            "currency": "SAR",
            "created_by": "EMP-101",
            "approved_by": "MGR-201",
            "approver_role": "Manager",
            "approval_limit": 1000,
        },
    )

    assert response.status_code == 201
    assert response.json()["risk_score"] == 10.0
    assert response.json()["risk_level"] == "LOW"

    assert persisted_scores == [
        {
            "transaction_id": "TX-RISK-SCORE-001",
            "scoring_version": "1.0.0",
            "rule_evaluation_version": "1.0.0",
            "anomaly_model_version": "1.0.0",
            "rule_score": 0.0,
            "ai_score": 25.0,
            "risk_score": 10.0,
            "risk_level": "LOW",
        }
    ]

def test_high_risk_transaction_creates_and_publishes_alert(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created_alerts: list[dict[str, Any]] = []
    published_alerts: list[dict[str, Any]] = []

    def capture_alert(
        *,
        transaction_id: str,
        risk_score: float,
        risk_scoring_version: str,
        request_received_at: Any,
    ) -> dict[str, Any]:
        alert = {
            "id": "AL-HIGH-001",
            "transaction_id": transaction_id,
            "created_at": request_received_at.isoformat(),
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
            "risk_score": risk_score,
            "risk_scoring_version": risk_scoring_version,
            "latency_ms": 250.0,
        }
        created_alerts.append(alert)
        return alert

    async def capture_publication(
        alert: dict[str, Any],
    ) -> None:
        published_alerts.append(alert)

    monkeypatch.setattr(
        "app.api.transactions.calculate_risk_score",
        lambda rule_score, ai_score: 80.0,
    )
    monkeypatch.setattr(
        "app.api.transactions.classify_risk_level",
        lambda risk_score: "HIGH",
    )
    monkeypatch.setattr(
        "app.api.transactions.create_high_risk_alert",
        capture_alert,
    )
    monkeypatch.setattr(
        (
            "app.api.transactions.alert_manager."
            "publish_created"
        ),
        capture_publication,
    )

    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-HIGH-ALERT-001",
            "timestamp": "2026-10-03T03:00:00Z",
            "vendor_id": "VND-101",
            "vendor_name": "Almarai Dairy Co.",
            "invoice_number": "INV-HIGH-ALERT-001",
            "category": "Inventory",
            "amount": 500,
            "currency": "SAR",
            "created_by": "EMP-101",
            "approved_by": "MGR-201",
            "approver_role": "Manager",
            "approval_limit": 1000,
        },
    )

    assert response.status_code == 201
    assert response.json()["risk_score"] == 80.0
    assert response.json()["risk_level"] == "HIGH"
    assert len(created_alerts) == 1
    assert created_alerts[0]["latency_ms"] <= 5000
    assert published_alerts == created_alerts

def test_create_transaction_generates_and_persists_explanation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    generation_request: dict[str, Any] = {}
    persisted_explanations: list[dict[str, Any]] = []

    def generate_explanation(
        **kwargs: Any,
    ) -> str:
        generation_request.update(kwargs)
        return (
            "The finalized scores indicate low risk. "
            "No failed control requires immediate escalation."
        )

    def capture_explanations(
        explanations: list[dict[str, Any]],
    ) -> int:
        persisted_explanations.extend(explanations)
        return len(explanations)

    monkeypatch.setattr(
        (
            "app.api.transactions."
            "generate_risk_explanation"
        ),
        generate_explanation,
    )
    monkeypatch.setattr(
        (
            "app.api.transactions."
            "get_gemini_model_name"
        ),
        lambda: "gemini-3.8-flash",
    )
    monkeypatch.setattr(
        (
            "app.api.transactions."
            "persist_transaction_explanations"
        ),
        capture_explanations,
    )

    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-EXPLANATION-001",
            "timestamp": "2026-10-03T04:45:00Z",
            "vendor_id": "VND-101",
            "vendor_name": "Almarai Dairy Co.",
            "invoice_number": "INV-EXPLANATION-001",
            "category": "Inventory",
            "amount": 500,
            "currency": "SAR",
            "created_by": "EMP-101",
            "approved_by": "MGR-201",
            "approver_role": "Manager",
            "approval_limit": 1000,
        },
    )

    assert response.status_code == 201
    body = response.json()

    assert body["rule_score"] == 0.0
    assert body["ai_score"] == 25.0
    assert body["risk_score"] == 10.0
    assert body["risk_level"] == "LOW"
    assert body["explanation"] == (
        "The finalized scores indicate low risk. "
        "No failed control requires immediate escalation."
    )

    assert generation_request["rule_score"] == 0.0
    assert generation_request["ai_score"] == 25.0
    assert generation_request["risk_score"] == 10.0
    assert generation_request["risk_level"] == "LOW"

    assert persisted_explanations == [
        {
            "transaction_id": "TX-EXPLANATION-001",
            "model_name": "gemini-3.8-flash",
            "prompt_version": "1.0.0",
            "rule_evaluation_version": "1.0.0",
            "anomaly_model_version": "1.0.0",
            "risk_scoring_version": "1.0.0",
            "explanation": (
                "The finalized scores indicate low risk. "
                "No failed control requires immediate escalation."
            ),
        }
    ]


def test_gemini_failure_preserves_authoritative_results(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted_explanations: list[dict[str, Any]] = []

    def fail_generation(
        **kwargs: Any,
    ) -> str:
        from app.api.transactions import (
            GeminiExplanationError,
        )

        raise GeminiExplanationError(
            "Gemini is unavailable."
        )

    def capture_explanations(
        explanations: list[dict[str, Any]],
    ) -> int:
        persisted_explanations.extend(explanations)
        return len(explanations)

    monkeypatch.setattr(
        (
            "app.api.transactions."
            "generate_risk_explanation"
        ),
        fail_generation,
    )
    monkeypatch.setattr(
        (
            "app.api.transactions."
            "persist_transaction_explanations"
        ),
        capture_explanations,
    )

    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-EXPLANATION-FAIL-001",
            "timestamp": "2026-10-03T04:46:00Z",
            "vendor_id": "VND-101",
            "vendor_name": "Almarai Dairy Co.",
            "invoice_number": (
                "INV-EXPLANATION-FAIL-001"
            ),
            "category": "Inventory",
            "amount": 500,
            "currency": "SAR",
            "created_by": "EMP-101",
            "approved_by": "MGR-201",
            "approver_role": "Manager",
            "approval_limit": 1000,
        },
    )

    assert response.status_code == 201
    body = response.json()

    assert body["rule_score"] == 0.0
    assert body["ai_score"] == 25.0
    assert body["risk_score"] == 10.0
    assert body["risk_level"] == "LOW"
    assert body["explanation"] is None
    assert persisted_explanations == []
