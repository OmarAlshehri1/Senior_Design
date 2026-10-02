from fastapi import APIRouter, HTTPException, Query, status
from starlette.concurrency import run_in_threadpool
from typing import Literal

from app.repositories.supabase_transactions import (
    SupabaseConfigurationError,
    SupabasePersistenceError,
    get_transaction_by_id,
    list_transactions,
    persist_transactions,
    get_duplicate_payment_counts,
    get_invoice_splitting_contexts,
    get_ghost_vendor_contexts,
)
from app.schemas.transaction import TransactionCreate

from app.services.audit_rules import (
    calculate_rule_score,
    evaluate_transaction_rules,
    summarize_rule_status,
)


router = APIRouter(
    prefix="/transactions",
    tags=["transactions"],
)


@router.get("")
async def get_transactions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str | None = Query(default=None, max_length=100),
    sort_by: Literal[
        "newest",
        "oldest",
        "highest-amount",
        "lowest-amount",
    ] = Query(default="newest"),
) -> dict[str, object]:
    try:
        transactions, total = await run_in_threadpool(
            list_transactions,
            page=page,
            page_size=page_size,
            search=search,
            sort_by=sort_by,
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transaction storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transactions could not be retrieved.",
        ) from exc

    return {
        "items": transactions,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{transaction_id}")
async def get_transaction(
    transaction_id: str,
) -> dict[str, object]:
    try:
        transaction = await run_in_threadpool(
            get_transaction_by_id,
            transaction_id,
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transaction storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transaction could not be retrieved.",
        ) from exc

    if transaction is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found.",
        )

    return transaction


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_transaction(
    transaction: TransactionCreate,
) -> dict[str, object]:
    transaction_data = transaction.model_dump(mode="python")

    transaction_data["amount"] = (
        float(transaction.amount)
        if transaction.amount is not None
        else None
    )
    transaction_data["approval_limit"] = (
        float(transaction.approval_limit)
        if transaction.approval_limit is not None
        else None
    )

    missing_fields = [
        field_name
        for field_name, value in transaction_data.items()
        if value is None
    ]

    data_quality_status = (
        "COMPLETE"
        if not missing_fields
        else "PARTIAL"
    )

    storage_transaction = {
        **transaction_data,
        "data_quality_status": data_quality_status,
        "missing_fields": missing_fields,
        "metadata": {},
    }

    try:
        await run_in_threadpool(
            persist_transactions,
            [storage_transaction],
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transaction storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transaction could not be stored.",
        ) from exc

    try:
        duplicate_counts = await run_in_threadpool(
            get_duplicate_payment_counts,
            [transaction_data["id"]],
        )
    except (
        SupabaseConfigurationError,
        SupabasePersistenceError,
    ):
        duplicate_counts = {}

    try:
        invoice_splitting_contexts = (
            await run_in_threadpool(
                get_invoice_splitting_contexts,
                [transaction_data["id"]],
            )
        )
    except (
        SupabaseConfigurationError,
        SupabasePersistenceError,
    ):
        invoice_splitting_contexts = {}

    try:
        ghost_vendor_contexts = await run_in_threadpool(
            get_ghost_vendor_contexts,
            [transaction_data["id"]],
        )
    except (
        SupabaseConfigurationError,
        SupabasePersistenceError,
    ):
        ghost_vendor_contexts = {}

    rule_results = evaluate_transaction_rules(
        transaction_data,
        context={
            "duplicate_payment_count": (
                duplicate_counts.get(
                    transaction_data["id"]
                )
            ),
            "invoice_splitting_context": (
                invoice_splitting_contexts.get(transaction_data["id"])
            ),
            "ghost_vendor_context": (
                ghost_vendor_contexts.get(transaction_data["id"])
            ),
        },
    )

    rule_score = calculate_rule_score(rule_results)

    return {
        **transaction_data,
        "vendor_monitoring_status": None,
        "data_quality_status": data_quality_status,
        "missing_fields": missing_fields,
        "rule_status": summarize_rule_status(
            rule_results
        ),
        "rule_score": rule_score,
        "ai_score": None,
        "risk_score": None,
        "risk_level": None,
        "rule_results": rule_results,
        "explanation": None,
    }
