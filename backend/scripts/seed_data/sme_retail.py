from typing import Any


SME_RETAIL_HEADERS = frozenset(
    {
        "transaction_id",
        "timestamp",
        "branch",
        "vendor_id",
        "vendor_name",
        "expense_category",
        "invoice_number",
        "amount_sar",
        "created_by",
        "created_by_role",
        "approved_by",
        "approved_by_role",
        "payment_method",
        "violation_type",
        "is_anomaly",
    }
)


def is_sme_retail_schema(headers: list[str]) -> bool:
    return set(headers) == SME_RETAIL_HEADERS


def adapt_sme_retail_row(
    source_row: dict[str, Any],
) -> tuple[dict[str, Any], dict[str, Any]]:
    transaction = {
        "id": source_row.get("transaction_id"),
        "timestamp": source_row.get("timestamp"),
        "vendor_id": source_row.get("vendor_id"),
        "vendor_name": source_row.get("vendor_name"),
        "invoice_number": source_row.get("invoice_number"),
        "category": source_row.get("expense_category"),
        "amount": source_row.get("amount_sar"),
        "currency": "SAR",
        "created_by": source_row.get("created_by"),
        "approved_by": source_row.get("approved_by"),
        "approver_role": source_row.get("approved_by_role"),
        "approval_limit": None,
    }

    metadata = {
        "source_schema": "SME_RETAIL_EXPENSES",
        "branch": source_row.get("branch"),
        "created_by_role": source_row.get("created_by_role"),
        "payment_method": source_row.get("payment_method"),
        "ground_truth": {
            "violation_type": source_row.get("violation_type"),
            "is_anomaly": source_row.get("is_anomaly"),
        },
    }

    return transaction, metadata