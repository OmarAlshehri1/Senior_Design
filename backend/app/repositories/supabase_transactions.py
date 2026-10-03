from __future__ import annotations

import os
from typing import Any

import httpx
from dotenv import load_dotenv
from fastapi.encoders import jsonable_encoder

from app.services.audit_rules import (
    calculate_rule_score,
    evaluate_transaction_rules,
    summarize_rule_status,
)

from app.services.risk_scoring import (
    calculate_risk_score,
    classify_risk_level,
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
    persisted_evaluation: dict[str, Any] | None = None,
    persisted_anomaly_score: dict[str, Any] | None = None,
    persisted_risk_score: dict[str, Any] | None = None,
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
        "ai_score": (
            persisted_anomaly_score.get("ai_score")
            if persisted_anomaly_score is not None
            else None
        ),
        "risk_score": None,
        "risk_level": None,
        "rule_results": [],
        "explanation": None,
    }

    if persisted_evaluation is not None:
        transaction["rule_status"] = (
            persisted_evaluation.get("rule_status")
        )
        transaction["rule_score"] = (
            persisted_evaluation.get("rule_score")
        )
        transaction["rule_results"] = (
            persisted_evaluation.get("rule_results", [])
        )
    else:
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

        transaction["rule_score"] = (
            calculate_rule_score(
                transaction["rule_results"]
            )
        )

        transaction["rule_status"] = (
            summarize_rule_status(
                transaction["rule_results"]
            )
        )

    if persisted_risk_score is not None:
        transaction["risk_score"] = (
            persisted_risk_score.get("risk_score")
        )
        transaction["risk_level"] = (
            persisted_risk_score.get("risk_level")
        )
    else:
        transaction["risk_score"] = calculate_risk_score(
            transaction.get("rule_score"),
            transaction.get("ai_score"),
        )
        transaction["risk_level"] = classify_risk_level(
            transaction["risk_score"]
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

def persist_transaction_evaluation(
    *,
    transaction_id: str,
    evaluation_version: str,
    rule_status: str,
    rule_score: float | None,
    rule_results: list[dict[str, Any]],
) -> None:
    url, _ = _get_configuration()
    endpoint = (
        f"{url}/rest/v1/transaction_evaluations"
    )

    headers = _get_headers()
    headers["Prefer"] = "return=minimal"

    row = jsonable_encoder(
        {
            "transaction_id": transaction_id,
            "evaluation_version": evaluation_version,
            "rule_status": rule_status,
            "rule_score": rule_score,
            "rule_results": rule_results,
        }
    )

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=headers,
                json=row,
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise SupabasePersistenceError(
            "Failed to persist the transaction evaluation."
        ) from exc

def persist_transaction_evaluations(
    evaluations: list[dict[str, Any]],
) -> int:
    if not evaluations:
        return 0

    url, _ = _get_configuration()
    endpoint = (
        f"{url}/rest/v1/transaction_evaluations"
    )

    headers = _get_headers()
    headers["Prefer"] = "return=minimal"

    rows = jsonable_encoder(evaluations)

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=headers,
                json=rows,
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise SupabasePersistenceError(
            "Failed to persist transaction evaluations."
        ) from exc

    return len(evaluations)

def get_latest_transaction_evaluations(
    transaction_ids: list[str],
) -> dict[str, dict[str, Any]]:
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
        "get_latest_transaction_evaluations"
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
    except httpx.HTTPError as exc:
        raise SupabasePersistenceError(
            "Failed to retrieve transaction evaluations."
        ) from exc

    payload = response.json()
    evaluations: dict[str, dict[str, Any]] = {}

    for row in payload:
        transaction_id = row.get("transaction_id")

        if not transaction_id:
            continue

        rule_results = row.get("rule_results")

        if not isinstance(rule_results, list):
            rule_results = []

        rule_score = row.get("rule_score")

        evaluations[transaction_id] = {
            "evaluation_version": row.get(
                "evaluation_version"
            ),
            "rule_status": row.get("rule_status"),
            "rule_score": (
                float(rule_score)
                if isinstance(rule_score, (int, float))
                else None
            ),
            "rule_results": rule_results,
            "evaluated_at": row.get("evaluated_at"),
        }

    return evaluations

def persist_transaction_anomaly_scores(
    scores: list[dict[str, Any]],
) -> int:
    if not scores:
        return 0

    url, _ = _get_configuration()
    endpoint = (
        f"{url}/rest/v1/"
        "transaction_anomaly_scores"
    )

    headers = _get_headers()
    headers["Prefer"] = "return=minimal"

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=headers,
                json=jsonable_encoder(scores),
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise SupabasePersistenceError(
            "Failed to persist anomaly scores."
        ) from exc

    return len(scores)


def get_latest_transaction_anomaly_scores(
    transaction_ids: list[str],
) -> dict[str, dict[str, Any]]:
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
        "get_latest_transaction_anomaly_scores"
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
            "Failed to retrieve anomaly scores."
        ) from exc

    if not isinstance(payload, list):
        raise SupabasePersistenceError(
            "Supabase returned invalid anomaly scores."
        )

    scores: dict[str, dict[str, Any]] = {}

    for row in payload:
        if not isinstance(row, dict):
            continue

        transaction_id = row.get("transaction_id")
        ai_score = row.get("ai_score")
        threshold = row.get("threshold")

        if (
            not isinstance(transaction_id, str)
            or not isinstance(ai_score, (int, float))
            or not isinstance(threshold, (int, float))
        ):
            continue

        scores[transaction_id] = {
            "model_version": row.get("model_version"),
            "ai_score": float(ai_score),
            "threshold": float(threshold),
            "is_anomalous": (
                row.get("is_anomalous") is True
            ),
            "scored_at": row.get("scored_at"),
        }

    return scores

def persist_transaction_risk_scores(
    scores: list[dict[str, Any]],
) -> int:
    if not scores:
        return 0

    url, _ = _get_configuration()
    endpoint = (
        f"{url}/rest/v1/"
        "transaction_risk_scores"
    )

    headers = _get_headers()
    headers["Prefer"] = "return=minimal"

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=headers,
                json=jsonable_encoder(scores),
            )
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise SupabasePersistenceError(
            "Failed to persist combined risk scores."
        ) from exc

    return len(scores)


def get_latest_transaction_risk_scores(
    transaction_ids: list[str],
) -> dict[str, dict[str, Any]]:
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
        "get_latest_transaction_risk_scores"
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
            "Failed to retrieve combined risk scores."
        ) from exc

    if not isinstance(payload, list):
        raise SupabasePersistenceError(
            "Supabase returned invalid combined risk scores."
        )

    scores: dict[str, dict[str, Any]] = {}

    for row in payload:
        if not isinstance(row, dict):
            continue

        transaction_id = row.get("transaction_id")
        rule_score = row.get("rule_score")
        ai_score = row.get("ai_score")
        risk_score = row.get("risk_score")
        risk_level = row.get("risk_level")

        if (
            not isinstance(transaction_id, str)
            or not isinstance(rule_score, (int, float))
            or not isinstance(ai_score, (int, float))
            or not isinstance(risk_score, (int, float))
            or risk_level not in {
                "LOW",
                "MEDIUM",
                "HIGH",
            }
        ):
            continue

        scores[transaction_id] = {
            "scoring_version": row.get(
                "scoring_version"
            ),
            "rule_evaluation_version": row.get(
                "rule_evaluation_version"
            ),
            "anomaly_model_version": row.get(
                "anomaly_model_version"
            ),
            "rule_score": float(rule_score),
            "ai_score": float(ai_score),
            "risk_score": float(risk_score),
            "risk_level": risk_level,
            "calculated_at": row.get("calculated_at"),
        }

    return scores

def get_evaluation_coverage() -> dict[str, int | float]:
    url, _ = _get_configuration()
    endpoint = (
        f"{url}/rest/v1/rpc/get_evaluation_coverage"
    )

    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT_SECONDS
        ) as client:
            response = client.post(
                endpoint,
                headers=_get_headers(),
                json={},
            )
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError(
            "Failed to retrieve evaluation coverage."
        ) from exc

    if (
        not isinstance(payload, list)
        or not payload
        or not isinstance(payload[0], dict)
    ):
        raise SupabasePersistenceError(
            "Supabase returned invalid evaluation coverage."
        )

    row = payload[0]

    return {
        "total_transaction_count": int(
            row.get("total_transaction_count", 0)
        ),
        "evaluated_transaction_count": int(
            row.get("evaluated_transaction_count", 0)
        ),
        "unevaluated_transaction_count": int(
            row.get("unevaluated_transaction_count", 0)
        ),
        "coverage_percent": float(
            row.get("coverage_percent", 0)
        ),
    }

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

    persisted_evaluations = (
        get_latest_transaction_evaluations(
            transaction_ids
        )
    )

    persisted_anomaly_scores = (
        get_latest_transaction_anomaly_scores(
            transaction_ids
        )
    )

    persisted_risk_scores = (
        get_latest_transaction_risk_scores(
            transaction_ids
        )
    )

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

        if not isinstance(transaction_id, str) or not transaction_id:
            continue
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
                persisted_evaluation=(
                    persisted_evaluations.get(
                        transaction_id
                    )
                ),
                persisted_anomaly_score=(
                    persisted_anomaly_scores.get(transaction_id)
                ),
                persisted_risk_score=(
                    persisted_risk_scores.get(
                        transaction_id
                    )
                ),
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

    persisted_evaluations = (
        get_latest_transaction_evaluations(
            [transaction_id]
        )
    )

    persisted_anomaly_scores = (
        get_latest_transaction_anomaly_scores(
            [transaction_id]
        )
    )

    persisted_risk_scores = (
        get_latest_transaction_risk_scores(
            [transaction_id]
        )
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
        persisted_anomaly_score=(
            persisted_anomaly_scores.get(
                transaction_id
            )
        ),
        persisted_risk_score=(
            persisted_risk_scores.get(
                transaction_id
            )
        ),
        persisted_evaluation=(
            persisted_evaluations.get(transaction_id)
        ),
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
