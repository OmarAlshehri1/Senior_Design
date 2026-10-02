import math

from app.services.anomaly_features import (
    FORBIDDEN_MODEL_INPUT_FIELDS,
    build_anomaly_features,
)


def build_transaction() -> dict[str, object]:
    return {
        "id": "TX-SECRET-001",
        "timestamp": "2026-10-02T12:30:00Z",
        "vendor_id": "VND-991",
        "vendor_name": "Hidden Vendor",
        "invoice_number": "INV-SECRET-001",
        "category": "Inventory",
        "amount": 1500.0,
        "currency": "SAR",
        "created_by": "EMP-001",
        "approved_by": " emp-001 ",
        "approver_role": "Manager",
        "approval_limit": 1000.0,
    }


def test_feature_builder_excludes_forbidden_inputs() -> None:
    transaction = build_transaction()
    transaction.update(
        {
            "violation_type": "Ghost Vendor",
            "is_anomaly": 1,
            "ground_truth": {
                "is_anomaly": True,
            },
        }
    )

    features = build_anomaly_features(transaction)

    assert FORBIDDEN_MODEL_INPUT_FIELDS.isdisjoint(
        features
    )

    changed_labels = {
        **transaction,
        "violation_type": "None",
        "is_anomaly": 0,
        "ground_truth": {},
    }

    assert (
        build_anomaly_features(changed_labels)
        == features
    )


def test_feature_builder_creates_runtime_features() -> None:
    features = build_anomaly_features(
        build_transaction(),
        context={
            "duplicate_payment_count": 2,
            "invoice_splitting_context": {
                "historical_transaction_count": 3,
                "window_total_amount": 2500.0,
            },
            "ghost_vendor_context": {
                "registry_authoritative": True,
                "vendor_registered": False,
                "vendor_active": False,
            },
        },
    )

    assert features["amount_available"] == 1.0
    assert features["approval_limit_available"] == 1.0
    assert features["same_actor"] == 1.0
    assert features["duplicate_history_available"] == 1.0
    assert features["window_history_available"] == 1.0
    assert features["vendor_registry_available"] == 1.0
    assert features["vendor_registered"] == 0.0
    assert features["vendor_active"] == 0.0
    assert features["category"] == "inventory"
    assert features["currency"] == "sar"

    numeric_values = [
        value
        for value in features.values()
        if isinstance(value, float)
    ]
    assert all(
        math.isfinite(value)
        for value in numeric_values
    )


def test_feature_builder_handles_missing_values() -> None:
    features = build_anomaly_features({})

    assert features["amount_available"] == 0.0
    assert features["approval_limit_available"] == 0.0
    assert features["timestamp_available"] == 0.0
    assert features["same_actor_available"] == 0.0
    assert features["category"] == "__missing__"
    assert features["currency"] == "__missing__"
