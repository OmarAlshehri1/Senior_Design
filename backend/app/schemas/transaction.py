from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class TransactionCreate(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    id: str = Field(min_length=1, max_length=50)
    timestamp: datetime | None = None

    vendor_id: str | None = Field(default=None, max_length=50)
    vendor_name: str | None = Field(default=None, max_length=150)
    invoice_number: str | None = Field(default=None, max_length=50)
    category: str | None = Field(default=None, max_length=100)

    amount: Decimal | None = Field(default=None, ge=0)
    currency: str = Field(default="SAR", pattern=r"^[A-Z]{3}$")

    created_by: str | None = Field(default=None, max_length=50)
    approved_by: str | None = Field(default=None, max_length=50)
    approver_role: str | None = Field(default=None, max_length=100)
    approval_limit: Decimal | None = Field(default=None, ge=0)