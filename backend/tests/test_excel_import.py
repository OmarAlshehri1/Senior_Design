from io import BytesIO

from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app

from pathlib import Path

from app.services.excel_import import parse_transaction_workbook

client = TestClient(app)


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


def test_import_excel_transactions() -> None:
    response = client.post(
        "/api/v1/transactions/import",
        files={
            "file": (
                "transactions.xlsx",
                build_excel_file(),
                (
                    "application/vnd.openxmlformats-officedocument."
                    "spreadsheetml.sheet"
                ),
            )
        },
    )

    assert response.status_code == 200

    body = response.json()

    assert body["total_rows"] == 3
    assert body["accepted_rows"] == 2
    assert body["complete_rows"] == 1
    assert body["partial_rows"] == 1
    assert body["rejected_rows"] == 1

    assert body["transactions"][0]["data_quality_status"] == "COMPLETE"
    assert body["transactions"][1]["data_quality_status"] == "PARTIAL"
    assert body["errors"][0]["row"] == 4


def test_import_rejects_non_excel_file() -> None:
    response = client.post(
        "/api/v1/transactions/import",
        files={
            "file": (
                "transactions.csv",
                b"id,amount\nTX-001,100",
                "text/csv",
            )
        },
    )

    assert response.status_code == 400

def test_imports_full_sme_retail_dataset() -> None:
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