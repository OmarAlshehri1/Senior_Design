from __future__ import annotations

import argparse
from typing import Any

from app.repositories.supabase_transactions import (
    get_evaluation_coverage,
    get_latest_transaction_evaluations,
    list_transactions,
    persist_transaction_evaluations,
)
from app.services.audit_rules import RULE_SCORE_VERSION


class BackfillConfirmationError(RuntimeError):
    """Raised when backfill was not explicitly confirmed."""


def backfill_transaction_evaluations(
    *,
    confirm: bool = False,
    dry_run: bool = False,
    batch_size: int = 100,
) -> dict[str, int | float]:
    if not dry_run and not confirm:
        raise BackfillConfirmationError(
            "Backfill requires --confirm."
        )

    if batch_size < 1 or batch_size > 1000:
        raise ValueError(
            "batch_size must be between 1 and 1000."
        )

    page = 1
    scanned = 0
    persisted = 0
    skipped = 0
    total = 0

    while True:
        transactions, total = list_transactions(
            page=page,
            page_size=batch_size,
            sort_by="oldest",
        )

        if not transactions:
            break

        transaction_ids = [
            transaction["id"]
            for transaction in transactions
            if isinstance(transaction.get("id"), str)
        ]
        existing = get_latest_transaction_evaluations(
            transaction_ids
        )

        evaluations: list[dict[str, Any]] = []

        for transaction in transactions:
            transaction_id = transaction.get("id")

            if (
                not isinstance(transaction_id, str)
                or not transaction_id
            ):
                continue

            if transaction_id in existing:
                skipped += 1
                continue

            evaluations.append(
                {
                    "transaction_id": transaction_id,
                    "evaluation_version": (
                        RULE_SCORE_VERSION
                    ),
                    "rule_status": transaction[
                        "rule_status"
                    ],
                    "rule_score": transaction[
                        "rule_score"
                    ],
                    "rule_results": transaction[
                        "rule_results"
                    ],
                }
            )

        if not dry_run:
            persisted += persist_transaction_evaluations(
                evaluations
            )
        else:
            persisted += len(evaluations)

        scanned += len(transactions)

        if page % 10 == 0 or scanned >= total:
            print(
                f"Scanned {scanned}/{total}; "
                f"{'would persist' if dry_run else 'persisted'} "
                f"{persisted}; skipped {skipped}."
            )

        if scanned >= total:
            break

        page += 1

    coverage = (
        get_evaluation_coverage()
        if not dry_run
        else {
            "coverage_percent": 0.0,
        }
    )

    return {
        "total_transaction_count": total,
        "scanned_transaction_count": scanned,
        "persisted_evaluation_count": persisted,
        "skipped_existing_count": skipped,
        "coverage_percent": float(
            coverage["coverage_percent"]
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Persist evaluations for transactions that do "
            "not already have an evaluation snapshot."
        )
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
        help="Confirm writes to Supabase.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Calculate work without writing evaluations.",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=100,
    )
    args = parser.parse_args()

    result = backfill_transaction_evaluations(
        confirm=args.confirm,
        dry_run=args.dry_run,
        batch_size=args.batch_size,
    )

    print("Backfill summary:")
    for key, value in result.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
