from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from app.repositories.supabase_transactions import (
    SupabaseConfigurationError,
    SupabasePersistenceError,
    persist_transactions,
)
from scripts.seed_data.excel_import import (
    ExcelImportError,
    parse_transaction_workbook,
)


DEFAULT_DATASET = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "samples"
    / "SME_Retail_Expenses_Purchases_10k_Dataset.xlsx"
)


class SeedConfirmationError(RuntimeError):
    """Raised when database seeding was not explicitly confirmed."""


def seed_transactions_from_workbook(
    workbook_path: Path,
    *,
    confirm: bool = False,
) -> dict[str, Any]:
    if not confirm:
        raise SeedConfirmationError(
            "Seeding requires explicit confirmation."
        )

    content = workbook_path.read_bytes()
    result = parse_transaction_workbook(content)

    transactions = result.get("transactions")

    if not isinstance(transactions, list) or not all(
        isinstance(transaction, dict)
        for transaction in transactions
    ):
        raise ExcelImportError(
            "The seed importer returned invalid transactions."
        )

    persisted_rows = persist_transactions(transactions)

    return {
        "source_schema": result["source_schema"],
        "total_rows": result["total_rows"],
        "accepted_rows": result["accepted_rows"],
        "complete_rows": result["complete_rows"],
        "partial_rows": result["partial_rows"],
        "rejected_rows": result["rejected_rows"],
        "persisted_rows": persisted_rows,
        "processing_time_seconds": result[
            "processing_time_seconds"
        ],
        "errors": result["errors"],
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Seed standardized transaction data into Supabase. "
            "This is an offline development tool, not a runtime API."
        )
    )
    parser.add_argument(
        "--file",
        type=Path,
        default=DEFAULT_DATASET,
        help="Path to the .xlsx seed workbook.",
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Explicitly allow database upserts.",
    )

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()

    if not args.confirm:
        parser.error(
            "Refusing to modify Supabase without --confirm."
        )

    try:
        summary = seed_transactions_from_workbook(
            args.file,
            confirm=True,
        )
    except FileNotFoundError:
        parser.error(
            f"Seed workbook was not found: {args.file}"
        )
    except ExcelImportError as exc:
        parser.error(str(exc))
    except SupabaseConfigurationError:
        parser.error(
            "Supabase environment variables are not configured."
        )
    except SupabasePersistenceError:
        parser.error(
            "Supabase could not store the seed transactions."
        )

    print(json.dumps(summary, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
