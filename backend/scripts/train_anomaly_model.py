from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from sklearn.model_selection import train_test_split

from app.repositories.supabase_transactions import (
    list_transactions,
)
from app.services.anomaly_features import (
    build_anomaly_features,
)
from app.services.anomaly_model import (
    calculate_detection_metrics,
    save_anomaly_model,
    select_anomaly_threshold,
    train_anomaly_model,
)
from scripts.seed_data.excel_import import (
    parse_transaction_workbook,
)


DEFAULT_DATASET = (
    Path(__file__).resolve().parents[1]
    / "data"
    / "samples"
    / "SME_Retail_Expenses_Purchases_10k_Dataset.xlsx"
)
DEFAULT_ARTIFACT = (
    Path(__file__).resolve().parents[1]
    / "models"
    / "isolation_forest_v1.joblib"
)
DEFAULT_METRICS = (
    Path(__file__).resolve().parents[1]
    / "models"
    / "isolation_forest_v1_metrics.json"
)


class TrainingConfirmationError(RuntimeError):
    """Raised when model output was not confirmed."""


def _load_labels(
    workbook_path: Path,
) -> dict[str, bool]:
    result = parse_transaction_workbook(
        workbook_path.read_bytes()
    )
    labels: dict[str, bool] = {}

    for transaction in result["transactions"]:
        metadata = transaction.get("metadata") or {}
        ground_truth = metadata.get(
            "ground_truth"
        ) or {}
        transaction_id = transaction.get("id")

        if isinstance(transaction_id, str):
            labels[transaction_id] = bool(
                ground_truth.get("is_anomaly")
            )

    return labels


def _rule_context(
    transaction: dict[str, Any],
) -> dict[str, Any]:
    rules = {
        result.get("rule_key"): result
        for result in transaction.get(
            "rule_results",
            [],
        )
        if isinstance(result, dict)
    }

    duplicate_evidence = (
        rules.get("duplicate_payment", {}).get(
            "evidence",
            {},
        )
    )
    splitting_evidence = (
        rules.get("invoice_splitting", {}).get(
            "evidence",
            {},
        )
    )
    vendor_evidence = (
        rules.get("ghost_vendors", {}).get(
            "evidence",
            {},
        )
    )

    return {
        "duplicate_payment_count": (
            duplicate_evidence.get(
                "matching_transaction_count"
            )
            if duplicate_evidence.get(
                "historical_context_available"
            )
            is True
            else None
        ),
        "invoice_splitting_context": {
            "historical_transaction_count": (
                splitting_evidence.get(
                    "historical_transaction_count"
                )
            ),
            "window_total_amount": (
                splitting_evidence.get(
                    "window_total_amount"
                )
            ),
        },
        "ghost_vendor_context": {
            "registry_authoritative": (
                vendor_evidence.get(
                    "vendor_registry_available"
                )
                is True
            ),
            "vendor_registered": (
                vendor_evidence.get(
                    "vendor_registered"
                )
            ),
            "vendor_active": (
                vendor_evidence.get(
                    "vendor_active"
                )
            ),
        },
    }


def _load_feature_records(
    labels: dict[str, bool],
    *,
    page_size: int = 500,
) -> tuple[
    list[dict[str, float | str]],
    list[bool],
    int,
]:
    feature_records: list[
        dict[str, float | str]
    ] = []
    matched_labels: list[bool] = []
    excluded_without_label = 0
    page = 1
    scanned = 0
    total = 0

    while True:
        transactions, total = list_transactions(
            page=page,
            page_size=page_size,
            sort_by="oldest",
        )

        if not transactions:
            break

        for transaction in transactions:
            transaction_id = transaction.get("id")

            if transaction_id not in labels:
                excluded_without_label += 1
                continue

            feature_records.append(
                build_anomaly_features(
                    transaction,
                    context=_rule_context(
                        transaction
                    ),
                )
            )
            matched_labels.append(
                labels[transaction_id]
            )

        scanned += len(transactions)

        if page % 5 == 0 or scanned >= total:
            print(
                f"Prepared {scanned}/{total} "
                "stored transactions."
            )

        if scanned >= total:
            break

        page += 1

    return (
        feature_records,
        matched_labels,
        excluded_without_label,
    )


def train_from_supabase(
    workbook_path: Path,
    artifact_path: Path,
    metrics_path: Path,
    *,
    confirm: bool = False,
    random_state: int = 42,
) -> dict[str, Any]:
    if not confirm:
        raise TrainingConfirmationError(
            "Training output requires --confirm."
        )

    labels = _load_labels(workbook_path)
    features, targets, excluded = (
        _load_feature_records(labels)
    )

    (
        training_features,
        remaining_features,
        training_labels,
        remaining_labels,
    ) = train_test_split(
        features,
        targets,
        test_size=0.30,
        random_state=random_state,
        stratify=targets,
    )

    (
        validation_features,
        test_features,
        validation_labels,
        test_labels,
    ) = train_test_split(
        remaining_features,
        remaining_labels,
        test_size=0.50,
        random_state=random_state,
        stratify=remaining_labels,
    )

    model = train_anomaly_model(
        training_features,
        random_state=random_state,
    )

    validation_metrics = select_anomaly_threshold(
        model,
        validation_features,
        validation_labels,
        minimum_detection_rate=0.90,
        maximum_false_positive_rate=0.10,
    )

    test_scores = model.score(test_features)
    test_metrics = calculate_detection_metrics(
        test_scores,
        test_labels,
        threshold=model.threshold,
    )

    result = {
        "model_version": model.version,
        "random_state": random_state,
        "training_count": len(training_features),
        "validation_count": len(
            validation_features
        ),
        "test_count": len(test_features),
        "excluded_without_label": excluded,
        "threshold": model.threshold,
        "validation_detection_rate": (
            validation_metrics["detection_rate"]
        ),
        "validation_false_positive_rate": (
            validation_metrics[
                "false_positive_rate"
            ]
        ),
        "test_detection_rate": (
            test_metrics["detection_rate"]
        ),
        "test_false_positive_rate": (
            test_metrics["false_positive_rate"]
        ),
    }

    if result["test_detection_rate"] < 0.85:
        raise RuntimeError(
            "The held-out detection-rate target was not met."
        )

    if result["test_false_positive_rate"] > 0.10:
        raise RuntimeError(
            "The held-out false-positive target was not met."
        )

    save_anomaly_model(model, artifact_path)
    metrics_path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    metrics_path.write_text(
        json.dumps(
            result,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )

    return result


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Train and evaluate the versioned "
            "Isolation Forest model."
        )
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=DEFAULT_DATASET,
    )
    parser.add_argument(
        "--artifact",
        type=Path,
        default=DEFAULT_ARTIFACT,
    )
    parser.add_argument(
        "--metrics",
        type=Path,
        default=DEFAULT_METRICS,
    )
    parser.add_argument(
        "--confirm",
        action="store_true",
    )
    args = parser.parse_args()

    result = train_from_supabase(
        args.dataset,
        args.artifact,
        args.metrics,
        confirm=args.confirm,
    )

    print("Training summary:")
    for key, value in result.items():
        print(f"  {key}: {value}")


if __name__ == "__main__":
    main()
