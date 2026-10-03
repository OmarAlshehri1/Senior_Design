from __future__ import annotations

import argparse
from typing import Any

from app.repositories.supabase_transactions import (
    get_latest_transaction_anomaly_scores,
    get_latest_transaction_evaluations,
    get_latest_transaction_risk_scores,
    list_transactions,
    persist_transaction_risk_scores,
)
from app.services.risk_scoring import (
    RISK_SCORING_VERSION,
    calculate_risk_score,
    classify_risk_level,
)


class BackfillConfirmationError(RuntimeError):
    """Raised when risk-score writes were not confirmed."""


def backfill_risk_scores(
    *,
    confirm: bool = False,
    dry_run: bool = False,
    batch_size: int = 500,
) -> dict[str, int]:
    if not dry_run and not confirm:
        raise BackfillConfirmationError(
            "Risk-score backfill requires --confirm."
        )

    page = 1
    total = 0
    scanned = 0
    persisted = 0
    skipped_existing = 0
    skipped_incomplete = 0
    level_counts = {
        "LOW": 0,
        "MEDIUM": 0,
        "HIGH": 0,
    }

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

        existing = get_latest_transaction_risk_scores(
            transaction_ids
        )

        pending = [
            transaction
            for transaction in transactions
            if isinstance(transaction.get("id"), str)
            and transaction["id"] not in existing
        ]

        pending_ids = [
            transaction["id"]
            for transaction in pending
        ]

        evaluations = (
            get_latest_transaction_evaluations(
                pending_ids
            )
        )
        anomaly_scores = (
            get_latest_transaction_anomaly_scores(
                pending_ids
            )
        )

        rows: list[dict[str, Any]] = []

        for transaction in pending:
            transaction_id = transaction["id"]
            evaluation = evaluations.get(transaction_id)
            anomaly = anomaly_scores.get(transaction_id)

            risk_score = calculate_risk_score(
                transaction.get("rule_score"),
                transaction.get("ai_score"),
            )
            risk_level = classify_risk_level(
                risk_score
            )

            if (
                evaluation is None
                or anomaly is None
                or risk_score is None
                or risk_level is None
                or not isinstance(
                    evaluation.get("evaluation_version"),
                    str,
                )
                or not isinstance(
                    anomaly.get("model_version"),
                    str,
                )
            ):
                skipped_incomplete += 1
                continue

            level_counts[risk_level] += 1

            rows.append(
                {
                    "transaction_id": transaction_id,
                    "scoring_version": (
                        RISK_SCORING_VERSION
                    ),
                    "rule_evaluation_version": (
                        evaluation["evaluation_version"]
                    ),
                    "anomaly_model_version": (
                        anomaly["model_version"]
                    ),
                    "rule_score": transaction["rule_score"],
                    "ai_score": transaction["ai_score"],
                    "risk_score": risk_score,
                    "risk_level": risk_level,
                }
            )

        if dry_run:
            persisted += len(rows)
        else:
            persisted += persist_transaction_risk_scores(
                rows
            )

        skipped_existing += (
            len(transactions) - len(pending)
        )
        scanned += len(transactions)

        if page % 5 == 0 or scanned >= total:
            action = (
                "would persist"
                if dry_run
                else "persisted"
            )
            print(
                f"Scanned {scanned}/{total}; "
                f"{action} {persisted}; "
                f"existing {skipped_existing}; "
                f"incomplete {skipped_incomplete}."
            )

        if scanned >= total:
            break

        page += 1

    return {
        "total_transaction_count": total,
        "scanned_transaction_count": scanned,
        "persisted_score_count": persisted,
        "skipped_existing_count": skipped_existing,
        "skipped_incomplete_count": skipped_incomplete,
        "low_risk_count": level_counts["LOW"],
        "medium_risk_count": level_counts["MEDIUM"],
        "high_risk_count": level_counts["HIGH"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill versioned combined risk scores."
        )
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=500,
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
    )
    args = parser.parse_args()

    result = backfill_risk_scores(
        confirm=args.confirm,
        dry_run=args.dry_run,
        batch_size=args.batch_size,
    )

    print("Combined risk-score backfill summary:")
    for key, value in result.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
