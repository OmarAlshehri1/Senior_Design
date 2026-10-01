from fastapi import (
    APIRouter,
    File,
    HTTPException,
    Query,
    UploadFile,
    status,
)
from starlette.concurrency import run_in_threadpool

from app.repositories.supabase_transactions import (
    SupabaseConfigurationError,
    SupabasePersistenceError,
    get_transaction_by_id,
    list_transactions,
    persist_transactions,
)
from app.schemas.transaction import TransactionCreate
from app.services.excel_import import (
    ExcelImportError,
    parse_transaction_workbook,
)


router = APIRouter(
    prefix="/transactions",
    tags=["transactions"],
)

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


@router.get("")
async def get_transactions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
) -> dict[str, object]:
    try:
        transactions, total = await run_in_threadpool(
            list_transactions,
            page=page,
            page_size=page_size,
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


@router.post("/import")
async def import_transactions(
    file: UploadFile = File(...),
) -> dict[str, object]:
    filename = file.filename or ""

    if not filename.lower().endswith(".xlsx"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only .xlsx Excel files are supported.",
        )

    try:
        content = await file.read(MAX_UPLOAD_BYTES + 1)
    finally:
        await file.close()

    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_CONTENT_TOO_LARGE,
            detail="The Excel file exceeds the 20 MB limit.",
        )

    try:
        result: dict[str, object] = await run_in_threadpool(
            parse_transaction_workbook,
            content,
        )
    except ExcelImportError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail=str(exc),
        ) from exc

    transactions = result.get("transactions")

    if not isinstance(transactions, list) or not all(
        isinstance(transaction, dict)
        for transaction in transactions
    ):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Importer returned an invalid transaction list.",
        )

    try:
        persisted_rows = await run_in_threadpool(
            persist_transactions,
            transactions,
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transaction storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transactions could not be stored.",
        ) from exc

    preview_limit = 10

    result["persisted_rows"] = persisted_rows
    result["returned_rows"] = min(
        len(transactions),
        preview_limit,
    )
    result["has_more"] = len(transactions) > preview_limit
    result["transactions"] = transactions[:preview_limit]

    return result


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

    return {
        **transaction_data,
        "vendor_monitoring_status": None,
        "data_quality_status": data_quality_status,
        "missing_fields": missing_fields,
        "rule_status": "NOT_EVALUATED",
        "rule_score": None,
        "ai_score": None,
        "risk_score": None,
        "risk_level": None,
        "rule_results": [],
        "explanation": None,
    }
