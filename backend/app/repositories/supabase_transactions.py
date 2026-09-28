from __future__ import annotations

import os
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi.encoders import jsonable_encoder

load_dotenv()

BATCH_SIZE = 500
REQUEST_TIMEOUT_SECONDS = 60.0


class SupabaseConfigurationError(RuntimeError):
    """Raised when the Supabase environment variables are unavailable."""


class SupabasePersistenceError(RuntimeError):
    """Raised when transactions cannot be stored in Supabase."""


def _get_configuration() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    secret_key = os.getenv("SUPABASE_SECRET_KEY", "")

    if not url or not secret_key:
        raise SupabaseConfigurationError(
            "SUPABASE_URL and SUPABASE_SECRET_KEY must be configured."
        )

    return url, secret_key


def _to_database_row(transaction: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(transaction.get("metadata") or {})

    # Evaluation labels are stored separately so they cannot accidentally
    # become input features for anomaly detection.
    ground_truth = metadata.pop("ground_truth", {})

    row = {
        "id": transaction["id"],
        "transaction_timestamp": transaction["timestamp"],
        "vendor_id": transaction.get("vendor_id"),
        "vendor_name": transaction.get("vendor_name"),
        "invoice_number": transaction.get("invoice_number"),
        "category": transaction.get("category"),
        "amount": transaction["amount"],
        "currency": transaction.get("currency"),
        "created_by": transaction.get("created_by"),
        "approved_by": transaction.get("approved_by"),
        "approver_role": transaction.get("approver_role"),
        "approval_limit": transaction.get("approval_limit"),
        "completeness_status": transaction["data_quality_status"],
        "missing_fields": transaction.get("missing_fields", []),
        "metadata": metadata,
        "ground_truth": ground_truth,
    }

    return jsonable_encoder(row)


def persist_transactions(transactions: list[dict[str, Any]]) -> int:
    if not transactions:
        return 0

    url, secret_key = _get_configuration()
    rows = [_to_database_row(transaction) for transaction in transactions]

    headers = {
        "apikey": secret_key,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal",
    }

    endpoint = f"{url}/rest/v1/transactions?on_conflict=id"

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            for start in range(0, len(rows), BATCH_SIZE):
                batch = rows[start : start + BATCH_SIZE]
                response = client.post(endpoint, headers=headers, json=batch)
                response.raise_for_status()
    except httpx.HTTPError as exc:
        raise SupabasePersistenceError(
            "Failed to persist transactions in Supabase."
        ) from exc

    return len(rows)