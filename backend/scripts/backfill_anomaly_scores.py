from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from app.repositories.supabase_transactions import (
    get_latest_transaction_anomaly_scores,
    list_transactions,
    persist_transaction_anomaly_scores,
)
from app.services.anomaly_features import (
    build_anomaly_features,
)
from app.services.anomaly_model import (
    load_anomaly_model,
)
from scripts.train_anomaly_model import _rule_context


DEFAULT_ARTIFACT = (
    Path(__file__).resolve().parents[1]
    / "models"
    / "isolation_forest_v1.joblib"
)


class BackfillConfirmationError(RuntimeError):
    """Raised when score writes were not confirmed."""


def backfill_anomaly_scores(
    artifact_path: Path,
    *,
    confirm: bool = False,
    dry_run: bool = False,
    batch_size: int = 500,
) -> dict[str, int]:
    if not dry_run and not confirm:
        raise BackfillConfirmationError(
            "Anomaly-score backfill requires --confirm."
        )

    model = load_anomaly_model(artifact_path)
    page = 1
    scanned = 0
    persisted = 0
    skipped = 0
    anomalous = 0
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
        existing = (
            get_latest_transaction_anomaly_scores(
                transaction_ids
            )
        )

        pending = [
            transaction
            for transaction in transactions
            if isinstance(transaction.get("id"), str)
            and transaction["id"] not in existing
        ]

        features = [
            build_anomaly_features(
                transaction,
                context=_rule_context(transaction),
            )
            for transaction in pending
        ]
        ai_scores = model.score(features)

        rows: list[dict[str, Any]] = []

        for transaction, ai_score in zip(
            pending,
            ai_scores,
            strict=True,
        ):
            is_anomalous = model.is_anomalous(
                ai_score
            )
            anomalous += int(is_anomalous)

            rows.append(
                {
                    "transaction_id": transaction["id"],
                    "model_version": model.version,
                    "ai_score": ai_score,
                    "threshold": model.threshold,
                    "is_anomalous": is_anomalous,
                }
            )

        if not dry_run:
            persisted += (
                persist_transaction_anomaly_scores(
                    rows
                )
            )
        else:
            persisted += len(rows)

        skipped += len(transactions) - len(pending)
        scanned += len(transactions)

        if page % 5 == 0 or scanned >= total:
            print(
                f"Scanned {scanned}/{total}; "
                f"{'would persist' if dry_run else 'persisted'} "
                f"{persisted}; skipped {skipped}."
            )

        if scanned >= total:
            break

        page += 1

    return {
        "total_transaction_count": total,
        "scanned_transaction_count": scanned,
        "persisted_score_count": persisted,
        "skipped_existing_count": skipped,
        "anomalous_score_count": anomalous,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Backfill versioned Isolation Forest scores."
        )
    )
    parser.add_argument(
        "--artifact",
        type=Path,
        default=DEFAULT_ARTIFACT,
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

    result = backfill_anomaly_scores(
        args.artifact,
        confirm=args.confirm,
        dry_run=args.dry_run,
        batch_size=args.batch_size,
    )

    print("Anomaly-score backfill summary:")
    for key, value in result.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
