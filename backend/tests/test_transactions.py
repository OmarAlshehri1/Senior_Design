from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


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
    assert body["transaction"]["id"] == "TX-TEST-001"
    assert body["data_quality_status"] == "COMPLETE"
    assert body["missing_fields"] == []


def test_create_partial_transaction() -> None:
    response = client.post(
        "/api/v1/transactions",
        json={"id": "TX-TEST-002"},
    )

    assert response.status_code == 201

    body = response.json()
    assert body["data_quality_status"] == "PARTIAL"
    assert "vendor_id" in body["missing_fields"]
    assert "amount" in body["missing_fields"]


def test_reject_invalid_currency() -> None:
    response = client.post(
        "/api/v1/transactions",
        json={
            "id": "TX-TEST-003",
            "currency": "sar",
        },
    )

    assert response.status_code == 422