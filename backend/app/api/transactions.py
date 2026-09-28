from fastapi import APIRouter, status

from app.schemas.transaction import TransactionCreate


router = APIRouter(
    prefix="/transactions",
    tags=["transactions"],
)


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