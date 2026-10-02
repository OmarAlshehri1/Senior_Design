from __future__ import annotations

import math
from datetime import datetime
from typing import Any


ANOMALY_MODEL_VERSION = "1.0.0"

FORBIDDEN_MODEL_INPUT_FIELDS = frozenset(
    {
        "id",
        "transaction_id",
        "invoice_number",
        "vendor_id",
        "vendor_name",
        "created_by",
        "approved_by",
        "violation_type",
        "is_anomaly",
        "ground_truth",
    }
)


def _number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        number = float(value)
        if math.isfinite(number):
            return number
    return None


def _category(value: Any) -> str:
    if not isinstance(value, str):
        return "__missing__"

    normalized = value.strip().lower()
    return normalized or "__missing__"


def _timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None

    try:
        return datetime.fromisoformat(
            value.replace("Z", "+00:00")
        )
    except ValueError:
        return None


def build_anomaly_features(
    transaction: dict[str, Any],
    *,
    context: dict[str, Any] | None = None,
) -> dict[str, float | str]:
    context = context or {}

    amount = _number(transaction.get("amount"))
    approval_limit = _number(
        transaction.get("approval_limit")
    )
    timestamp = _timestamp(transaction.get("timestamp"))

    features: dict[str, float | str] = {
        "amount_available": float(amount is not None),
        "amount_log": math.log1p(max(amount or 0.0, 0.0)),
        "approval_limit_available": float(
            approval_limit is not None
            and approval_limit > 0
        ),
        "amount_to_limit_log": 0.0,
        "timestamp_available": float(timestamp is not None),
        "hour_sin": 0.0,
        "hour_cos": 0.0,
        "weekday_sin": 0.0,
        "weekday_cos": 0.0,
        "same_actor_available": 0.0,
        "same_actor": 0.0,
        "category": _category(
            transaction.get("category")
        ),
        "currency": _category(
            transaction.get("currency")
        ),
        "approver_role": _category(
            transaction.get("approver_role")
        ),
    }

    if (
        amount is not None
        and approval_limit is not None
        and approval_limit > 0
    ):
        features["amount_to_limit_log"] = math.log1p(
            max(amount, 0.0) / approval_limit
        )

    if timestamp is not None:
        hour = timestamp.hour + timestamp.minute / 60
        weekday = timestamp.weekday()

        features["hour_sin"] = math.sin(
            2 * math.pi * hour / 24
        )
        features["hour_cos"] = math.cos(
            2 * math.pi * hour / 24
        )
        features["weekday_sin"] = math.sin(
            2 * math.pi * weekday / 7
        )
        features["weekday_cos"] = math.cos(
            2 * math.pi * weekday / 7
        )

    created_by = transaction.get("created_by")
    approved_by = transaction.get("approved_by")

    if isinstance(created_by, str) and isinstance(
        approved_by,
        str,
    ):
        features["same_actor_available"] = 1.0
        features["same_actor"] = float(
            created_by.strip().casefold()
            == approved_by.strip().casefold()
        )

    duplicate_count = _number(
        context.get("duplicate_payment_count")
    )
    features["duplicate_history_available"] = float(
        duplicate_count is not None
    )
    features["duplicate_history_count_log"] = (
        math.log1p(max(duplicate_count or 0.0, 0.0))
    )

    splitting = context.get(
        "invoice_splitting_context"
    )
    if not isinstance(splitting, dict):
        splitting = {}

    window_count = _number(
        splitting.get("historical_transaction_count")
    )
    window_total = _number(
        splitting.get("window_total_amount")
    )

    features["window_history_available"] = float(
        window_count is not None
        and window_total is not None
    )
    features["window_transaction_count_log"] = (
        math.log1p(max(window_count or 0.0, 0.0))
    )
    features["window_total_amount_log"] = math.log1p(
        max(window_total or 0.0, 0.0)
    )

    vendor = context.get("ghost_vendor_context")
    if not isinstance(vendor, dict):
        vendor = {}

    registry_available = (
        vendor.get("registry_authoritative") is True
    )
    features["vendor_registry_available"] = float(
        registry_available
    )
    features["vendor_registered"] = float(
        registry_available
        and vendor.get("vendor_registered") is True
    )
    features["vendor_active"] = float(
        registry_available
        and vendor.get("vendor_active") is True
    )

    return features
