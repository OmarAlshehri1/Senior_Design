from typing import Any

import pytest

from scripts import backfill_risk_scores as backfill


def test_backfill_requires_confirmation() -> None:
    with pytest.raises(
        backfill.BackfillConfirmationError
    ):
        backfill.backfill_risk_scores()


def test_backfill_persists_only_missing_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted_rows: list[dict[str, Any]] = []

    transactions = [
        {
            "id": "TX-EXISTING",
            "rule_score": 0.0,
            "ai_score": 10.0,
        },
        {
            "id": "TX-PENDING",
            "rule_score": 100.0,
            "ai_score": 100.0,
        },
    ]

    monkeypatch.setattr(
        backfill,
        "list_transactions",
        lambda **kwargs: (transactions, 2),
    )
    monkeypatch.setattr(
        backfill,
        "get_latest_transaction_risk_scores",
        lambda transaction_ids: {
            "TX-EXISTING": {
                "risk_score": 4.0,
                "risk_level": "LOW",
            }
        },
    )
    monkeypatch.setattr(
        backfill,
        "get_latest_transaction_evaluations",
        lambda transaction_ids: {
            "TX-PENDING": {
                "evaluation_version": "1.0.0",
            }
        },
    )
    monkeypatch.setattr(
        backfill,
        "get_latest_transaction_anomaly_scores",
        lambda transaction_ids: {
            "TX-PENDING": {
                "model_version": "1.0.0",
            }
        },
    )

    def capture_scores(
        scores: list[dict[str, Any]],
    ) -> int:
        persisted_rows.extend(scores)
        return len(scores)

    monkeypatch.setattr(
        backfill,
        "persist_transaction_risk_scores",
        capture_scores,
    )

    result = backfill.backfill_risk_scores(
        confirm=True,
        batch_size=500,
    )

    assert result == {
        "total_transaction_count": 2,
        "scanned_transaction_count": 2,
        "persisted_score_count": 1,
        "skipped_existing_count": 1,
        "skipped_incomplete_count": 0,
        "low_risk_count": 0,
        "medium_risk_count": 0,
        "high_risk_count": 1,
    }

    assert persisted_rows == [
        {
            "transaction_id": "TX-PENDING",
            "scoring_version": "1.0.0",
            "rule_evaluation_version": "1.0.0",
            "anomaly_model_version": "1.0.0",
            "rule_score": 100.0,
            "ai_score": 100.0,
            "risk_score": 100.0,
            "risk_level": "HIGH",
        }
    ]
