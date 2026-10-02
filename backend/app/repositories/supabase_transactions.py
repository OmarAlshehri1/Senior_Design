from __future__ import annotations

import os
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi.encoders import jsonable_encoder

from app.services.audit_rules import (
    evaluate_transaction_rules,
    summarize_rule_status,
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
    *,
    duplicate_payment_count: int | None = None,
    invoice_splitting_context: (
        dict[str, int | float] | None
    ) = None,
    ghost_vendor_context: (
        dict[str, bool] | None
    ) = None,
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

    rule_context: dict[str, Any] = {}

    if duplicate_payment_count is not None:
        rule_context["duplicate_payment_count"] = (
            duplicate_payment_count
        )

    if invoice_splitting_context is not None:
        rule_context["invoice_splitting_context"] = (
            invoice_splitting_context
        )

    if ghost_vendor_context is not None:
        rule_context["ghost_vendor_context"] = (
            ghost_vendor_context
        )

    transaction["rule_results"] = (
                evaluate_transaction_rules(
            transaction,
            context=rule_context,
        )
    )

    transaction["rule_status"] = (
        summarize_rule_status(
            transaction["rule_results"]
        )
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


def get_duplicate_payment_counts(
    transaction_ids: list[str],
) -> dict[str, int]:
    unique_ids = list(
        dict.fromkeys(
            transaction_id
            for transaction_id in transaction_ids
            if transaction_id
        )
    )

    if not unique_ids:
        return {}

    url, _ = _get_configuration()
    endpoint = (
        f"{url}/rest/v1/rpc/"
        "get_duplicate_payment_counts"
    )

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=_get_headers(),
                json={
                    "transaction_ids": unique_ids,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to read duplicate-payment counts "
            "from Supabase."
        ) from exc

    if not isinstance(payload, list):
        raise SupabasePersistenceError(
            "Supabase returned invalid duplicate-payment "
            "counts."
        )

    counts = {
        transaction_id: 0
        for transaction_id in unique_ids
    }

    for item in payload:
        if not isinstance(item, dict):
            raise SupabasePersistenceError(
                "Supabase returned an invalid duplicate "
                "count record."
            )

        transaction_id = item.get("transaction_id")
        count = item.get("matching_transaction_count")

        if (
            not isinstance(transaction_id, str)
            or isinstance(count, bool)
            or not isinstance(count, int)
            or count < 0
        ):
            raise SupabasePersistenceError(
                "Supabase returned an invalid duplicate "
                "count value."
            )

        if transaction_id in counts:
            counts[transaction_id] = count

    return counts


def get_invoice_splitting_contexts(
    transaction_ids: list[str],
) -> dict[str, dict[str, int | float]]:
    unique_ids = list(
        dict.fromkeys(
            transaction_id
            for transaction_id in transaction_ids
            if transaction_id
        )
    )

    if not unique_ids:
        return {}

    url, _ = _get_configuration()
    endpoint = (
        f"{url}/rest/v1/rpc/"
        "get_invoice_splitting_context"
    )

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=_get_headers(),
                json={
                    "transaction_ids": unique_ids,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to read invoice-splitting context "
            "from Supabase."
        ) from exc

    if not isinstance(payload, list):
        raise SupabasePersistenceError(
            "Supabase returned invalid invoice-splitting "
            "context."
        )

    contexts: dict[
        str,
        dict[str, int | float],
    ] = {}

    for item in payload:
        if not isinstance(item, dict):
            raise SupabasePersistenceError(
                "Supabase returned an invalid "
                "invoice-splitting context record."
            )

        transaction_id = item.get("transaction_id")
        historical_count = item.get(
            "historical_transaction_count"
        )
        window_total = item.get(
            "window_total_amount"
        )

        if (
            not isinstance(transaction_id, str)
            or isinstance(historical_count, bool)
            or not isinstance(historical_count, int)
            or historical_count < 0
            or isinstance(window_total, bool)
            or not isinstance(window_total, (int, float))
            or window_total < 0
        ):
            raise SupabasePersistenceError(
                "Supabase returned invalid "
                "invoice-splitting context values."
            )

        if transaction_id in unique_ids:
            contexts[transaction_id] = {
                "historical_transaction_count": (
                    historical_count
                ),
                "window_total_amount": float(
                    window_total
                ),
            }

    return contexts


def get_ghost_vendor_contexts(
    transaction_ids: list[str],
) -> dict[str, dict[str, bool]]:
    unique_ids = list(
        dict.fromkeys(
            transaction_id
            for transaction_id in transaction_ids
            if transaction_id
        )
    )

    if not unique_ids:
        return {}

    url, _ = _get_configuration()
    endpoint = (
        f"{url}/rest/v1/rpc/"
        "get_ghost_vendor_context"
    )

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=_get_headers(),
                json={
                    "transaction_ids": unique_ids,
                },
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to read ghost-vendor context "
            "from Supabase."
        ) from exc

    if not isinstance(payload, list):
        raise SupabasePersistenceError(
            "Supabase returned invalid ghost-vendor "
            "context."
        )

    contexts: dict[str, dict[str, bool]] = {}

    for item in payload:
        if not isinstance(item, dict):
            raise SupabasePersistenceError(
                "Supabase returned an invalid "
                "ghost-vendor context record."
            )

        transaction_id = item.get("transaction_id")
        registry_authoritative = item.get(
            "registry_authoritative"
        )
        vendor_registered = item.get(
            "vendor_registered"
        )
        vendor_active = item.get(
            "vendor_active"
        )

        if (
            not isinstance(transaction_id, str)
            or not isinstance(registry_authoritative, bool)
            or not isinstance(vendor_registered, bool)
            or not isinstance(vendor_active, bool)
        ):
            raise SupabasePersistenceError(
                "Supabase returned invalid "
                "ghost-vendor context values."
            )

        if transaction_id in unique_ids:
            contexts[transaction_id] = {
                "registry_authoritative": (
                    registry_authoritative
                ),
                "vendor_registered": vendor_registered,
                "vendor_active": vendor_active,
            }

    return contexts


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

TRANSACTION_SORT_ORDERS = {
    "newest": "transaction_timestamp.desc.nullslast,id.asc",
    "oldest": "transaction_timestamp.asc.nullslast,id.asc",
    "highest-amount": "amount.desc.nullslast,id.asc",
    "lowest-amount": "amount.asc.nullslast,id.asc",
}

def list_transactions(
    *,
    page: int = 1,
    page_size: int = 25,
    search: str | None = None,
    sort_by: str = "newest",
) -> tuple[list[dict[str, Any]], int]:
    if page < 1 or page_size < 1:
        raise ValueError("Page and page size must be positive integers.")

    if sort_by not in TRANSACTION_SORT_ORDERS:
        raise ValueError("Unsupported transaction sort option.")

    search_term = " ".join((search or "").split())

    for reserved_character in ("*", "%", ",", "(", ")"):
        search_term = search_term.replace(
            reserved_character,
            " ",
        )

    search_term = " ".join(search_term.split())

    url, _ = _get_configuration()
    offset = (page - 1) * page_size

    endpoint = f"{url}/rest/v1/transactions"
    params = {
    "select": TRANSACTION_COLUMNS,
    "order": TRANSACTION_SORT_ORDERS[sort_by],
    "offset": str(offset),
    "limit": str(page_size),
    }

    if search_term:
        search_pattern = f"*{search_term}*"
        params["or"] = (
            f"(id.ilike.{search_pattern},"
            f"vendor_name.ilike.{search_pattern},"
            f"category.ilike.{search_pattern})"
        )

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

    transaction_ids = [
        row["id"]
        for row in payload
        if (
            isinstance(row, dict)
            and isinstance(row.get("id"), str)
        )
    ]

    duplicate_counts = get_duplicate_payment_counts(
        transaction_ids
    )

    invoice_splitting_contexts = (
        get_invoice_splitting_contexts(
            transaction_ids
        )
    )

    ghost_vendor_contexts = get_ghost_vendor_contexts(
        transaction_ids
    )

    transactions: list[dict[str, Any]] = []

    for row in payload:
        if not isinstance(row, dict):
            continue

        transaction_id = row.get("id")
        duplicate_payment_count = (
            duplicate_counts.get(transaction_id)
            if isinstance(transaction_id, str)
            else None
        )

        invoice_splitting_context = (
            invoice_splitting_contexts.get(
                transaction_id
            )
            if isinstance(transaction_id, str)
            else None
        )

        ghost_vendor_context = (
            ghost_vendor_contexts.get(transaction_id)
            if isinstance(transaction_id, str)
            else None
        )

        transactions.append(
            _from_database_row(
                row,
                duplicate_payment_count=(
                    duplicate_payment_count
                ),
                invoice_splitting_context=(
                    invoice_splitting_context
                ),
                ghost_vendor_context=(
                    ghost_vendor_context
                ),
            )
        )

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

    duplicate_counts = get_duplicate_payment_counts(
        [transaction_id]
    )

    invoice_splitting_contexts = (
        get_invoice_splitting_contexts(
            [transaction_id]
        )
    )

    ghost_vendor_contexts = get_ghost_vendor_contexts(
        [transaction_id]
    )

    return _from_database_row(
        first_row,
        duplicate_payment_count=(
            duplicate_counts.get(transaction_id)
        ),
        invoice_splitting_context=(
            invoice_splitting_contexts.get(transaction_id)
        ),
        ghost_vendor_context=(
            ghost_vendor_contexts.get(transaction_id)
        ),
    )
