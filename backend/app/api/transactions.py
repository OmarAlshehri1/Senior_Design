from fastapi import APIRouter, File, HTTPException, UploadFile, status
from starlette.concurrency import run_in_threadpool

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

    if not isinstance(transactions, list):
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Importer returned an invalid transaction list.",
        )

    preview_limit = 10

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
    transaction_data = transaction.model_dump(mode="json")

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

    return {
        "transaction": transaction_data,
        "data_quality_status": data_quality_status,
        "missing_fields": missing_fields,
    }