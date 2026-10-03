from io import BytesIO
from pathlib import Path
from typing import Any

import pytest
from openpyxl import Workbook

from scripts import seed_transactions
from scripts.seed_data.excel_import import (
    parse_transaction_workbook,
)


def build_excel_file() -> bytes:
    workbook = Workbook()
    worksheet = workbook.active
    assert worksheet is not None

    worksheet.append(
        [
            "id",
            "timestamp",
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
        ]
    )

    worksheet.append(
        [
            "TX-001",
            "2026-09-28T10:00:00",
            "V-001",
            "Test Vendor",
            "INV-001",
            "Office Supplies",
            250.0,
            "SAR",
            "EMP-001",
            "MGR-001",
            "Manager",
            1000.0,
        ]
    )

    worksheet.append(
        [
            "TX-002",
            None,
            None,
            "Partial Vendor",
            None,
            None,
            100.0,
            "SAR",
            None,
            None,
            None,
            None,
        ]
    )

    worksheet.append(
        [
            "",
            None,
            None,
            "Invalid Transaction",
            None,
            None,
            -50.0,
            "sar",
            None,
            None,
            None,
            None,
        ]
    )

    output = BytesIO()
    workbook.save(output)
    workbook.close()

    return output.getvalue()


def test_parse_excel_transactions_offline() -> None:
    result = parse_transaction_workbook(
        build_excel_file()
    )

    assert result["total_rows"] == 3
    assert result["accepted_rows"] == 2
    assert result["complete_rows"] == 1
    assert result["partial_rows"] == 1
    assert result["rejected_rows"] == 1

    assert (
        result["transactions"][0]["data_quality_status"]
        == "COMPLETE"
    )
    assert (
        result["transactions"][1]["data_quality_status"]
        == "PARTIAL"
    )
    assert result["errors"][0]["row"] == 4


def test_parse_full_sme_retail_dataset() -> None:
    dataset_path = (
        Path(__file__).resolve().parents[1]
        / "data"
        / "samples"
        / "SME_Retail_Expenses_Purchases_10k_Dataset.xlsx"
    )

    result = parse_transaction_workbook(
        dataset_path.read_bytes()
    )

    assert result["source_schema"] == "SME_RETAIL_EXPENSES"
    assert result["total_rows"] == 10_000
    assert result["accepted_rows"] == 10_000
    assert result["rejected_rows"] == 0
    assert len(result["transactions"]) == 10_000


def test_seed_requires_explicit_confirmation() -> None:
    with pytest.raises(
        seed_transactions.SeedConfirmationError
    ):
        seed_transactions.seed_transactions_from_workbook(
            Path("not-read-without-confirmation.xlsx"),
        )


def test_confirmed_seed_persists_parsed_rows(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    workbook_path = tmp_path / "transactions.xlsx"
    workbook_path.write_bytes(build_excel_file())

    persisted: list[dict[str, Any]] = []

    def fake_persist_transactions(
        transactions: list[dict[str, Any]],
    ) -> int:
        persisted.extend(transactions)
        return len(transactions)

    monkeypatch.setattr(
        seed_transactions,
        "persist_transactions",
        fake_persist_transactions,
    )

    summary = (
        seed_transactions.seed_transactions_from_workbook(
            workbook_path,
            confirm=True,
        )
    )

    assert summary["accepted_rows"] == 2
    assert summary["persisted_rows"] == 2
    assert len(persisted) == 2
    assert persisted[0]["id"] == "TX-001"

    # Repeat the confirmed tool invocation: it still routes to offline upsert,
    # not the runtime create-only operation.
    repeated = seed_transactions.seed_transactions_from_workbook(
        workbook_path, confirm=True,
    )
    assert repeated["persisted_rows"] == 2
    assert [row["id"] for row in persisted] == ["TX-001", "TX-002"] * 2
