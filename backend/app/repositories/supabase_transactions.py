from __future__ import annotations

import os
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi.encoders import jsonable_encoder

from app.services.rule_eligibility import (
    build_pending_rule_results,
)

load_dotenv()

BATCH_SIZE = 500
REQUEST_TIMEOUT_SECONDS = 60.0

TRANSACTION_COLUMNS = ",".join(
    [
        "id",
        "transaction_timestamp",
        "vendor_id",
        "vendor_name",
        "invoice_number",
        "category",
        "amount",
        "currency",
        "created_by",
        "approved_by",
        "approver_role",
        "approval_limit",
        "completeness_status",
        "missing_fields",
    ]
)


class SupabaseConfigurationError(RuntimeError):
    """Raised when the Supabase environment variables are unavailable."""


class SupabasePersistenceError(RuntimeError):
    """Raised when transactions cannot be accessed in Supabase."""


def _get_configuration() -> tuple[str, str]:
    url = os.getenv("SUPABASE_URL", "").rstrip("/")
    secret_key = os.getenv("SUPABASE_SECRET_KEY", "")

    if not url or not secret_key:
        raise SupabaseConfigurationError(
            "SUPABASE_URL and SUPABASE_SECRET_KEY must be configured."
        )

    return url, secret_key


def _get_headers(*, include_count: bool = False) -> dict[str, str]:
    _, secret_key = _get_configuration()

    headers = {
        "apikey": secret_key,
        "Content-Type": "application/json",
    }

    if include_count:
        headers["Prefer"] = "count=exact"

    return headers


def _to_database_row(transaction: dict[str, Any]) -> dict[str, Any]:
    metadata = dict(transaction.get("metadata") or {})

    # Evaluation labels are stored separately so they cannot accidentally
    # become input features for anomaly detection.
    ground_truth = metadata.pop("ground_truth", {})

    row = {
        "id": transaction["id"],
        "transaction_timestamp": transaction.get("timestamp"),
        "vendor_id": transaction.get("vendor_id"),
        "vendor_name": transaction.get("vendor_name"),
        "invoice_number": transaction.get("invoice_number"),
        "category": transaction.get("category"),
        "amount": transaction.get("amount"),
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


def _from_database_row(
    row: dict[str, Any],
) -> dict[str, Any]:
    missing_fields = row.get("missing_fields")

    if not isinstance(missing_fields, list):
        missing_fields = []

    transaction = {
        "id": row.get("id"),
        "timestamp": row.get("transaction_timestamp"),
        "vendor_id": row.get("vendor_id"),
        "vendor_name": row.get("vendor_name"),
        "vendor_monitoring_status": None,
        "invoice_number": row.get("invoice_number"),
        "category": row.get("category"),
        "amount": row.get("amount"),
        "currency": row.get("currency"),
        "created_by": row.get("created_by"),
        "approved_by": row.get("approved_by"),
        "approver_role": row.get("approver_role"),
        "approval_limit": row.get("approval_limit"),
        "data_quality_status": row.get(
            "completeness_status"
        ),
        "missing_fields": missing_fields,
        "rule_status": "NOT_EVALUATED",
        "rule_score": None,
        "ai_score": None,
        "risk_score": None,
        "risk_level": None,
        "rule_results": [],
        "explanation": None,
    }

    transaction["rule_results"] = (
        build_pending_rule_results(transaction)
    )

    return transaction


def _parse_total(content_range: str | None, returned_rows: int) -> int:
    if not content_range or "/" not in content_range:
        return returned_rows

    total_value = content_range.rsplit("/", maxsplit=1)[-1]

    if total_value == "*":
        return returned_rows

    try:
        return int(total_value)
    except ValueError:
        return returned_rows


def persist_transactions(transactions: list[dict[str, Any]]) -> int:
    if not transactions:
        return 0

    url, _ = _get_configuration()
    rows = [_to_database_row(transaction) for transaction in transactions]

    headers = _get_headers()
    headers["Prefer"] = "resolution=merge-duplicates,return=minimal"

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


def list_transactions(
    *,
    page: int = 1,
    page_size: int = 25,
) -> tuple[list[dict[str, Any]], int]:
    if page < 1 or page_size < 1:
        raise ValueError("Page and page size must be positive integers.")

    url, _ = _get_configuration()
    offset = (page - 1) * page_size

    endpoint = f"{url}/rest/v1/transactions"
    params = {
        "select": TRANSACTION_COLUMNS,
        "order": "transaction_timestamp.desc.nullslast,id.asc",
        "offset": str(offset),
        "limit": str(page_size),
    }

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = client.get(
                endpoint,
                headers=_get_headers(include_count=True),
                params=params,
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to read transactions from Supabase."
        ) from exc

    if not isinstance(payload, list):
        raise SupabasePersistenceError(
            "Supabase returned an invalid transaction collection."
        )

    transactions = [
        _from_database_row(row)
        for row in payload
        if isinstance(row, dict)
    ]

    total = _parse_total(
        response.headers.get("content-range"),
        len(transactions),
    )

    return transactions, total


def get_transaction_by_id(
    transaction_id: str,
) -> dict[str, Any] | None:
    url, _ = _get_configuration()
    endpoint = f"{url}/rest/v1/transactions"

    params = {
        "select": TRANSACTION_COLUMNS,
        "id": f"eq.{transaction_id}",
        "limit": "1",
    }

    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = client.get(
                endpoint,
                headers=_get_headers(),
                params=params,
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to read the transaction from Supabase."
        ) from exc

    if not isinstance(payload, list):
        raise SupabasePersistenceError(
            "Supabase returned an invalid transaction response."
        )

    if not payload:
        return None

    first_row = payload[0]

    if not isinstance(first_row, dict):
        raise SupabasePersistenceError(
            "Supabase returned an invalid transaction record."
        )

    return _from_database_row(first_row)
