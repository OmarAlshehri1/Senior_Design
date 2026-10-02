from pathlib import Path
from typing import Any

import pytest

from scripts import backfill_anomaly_scores as backfill


def test_backfill_requires_confirmation() -> None:
    with pytest.raises(
        backfill.BackfillConfirmationError
    ):
        backfill.backfill_anomaly_scores(
            Path("model.joblib")
        )


def test_backfill_persists_only_missing_scores(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted_rows: list[dict[str, Any]] = []

    class FakeModel:
        version = "1.0.0"
        threshold = 90.6

        def score(
            self,
            feature_records: list[dict[str, Any]],
        ) -> list[float]:
            assert feature_records == [{"amount": 9000.0}]
            return [95.0]

        def is_anomalous(
            self,
            ai_score: float,
        ) -> bool:
            return ai_score >= self.threshold

    transactions = [
        {
            "id": "TX-EXISTING",
            "amount": 100.0,
            "rule_results": [],
        },
        {
            "id": "TX-MISSING",
            "amount": 9000.0,
            "rule_results": [],
        },
    ]

    monkeypatch.setattr(
        backfill,
        "load_anomaly_model",
        lambda path: FakeModel(),
    )
    monkeypatch.setattr(
        backfill,
        "list_transactions",
        lambda **kwargs: (transactions, 2),
    )
    monkeypatch.setattr(
        backfill,
        "get_latest_transaction_anomaly_scores",
        lambda transaction_ids: {
            "TX-EXISTING": {
                "ai_score": 10.0,
            }
        },
    )
    monkeypatch.setattr(
        backfill,
        "_rule_context",
        lambda transaction: {},
    )
    monkeypatch.setattr(
        backfill,
        "build_anomaly_features",
        lambda transaction, context: {
            "amount": transaction["amount"],
        },
    )

    def fake_persist(
        rows: list[dict[str, Any]],
    ) -> int:
        persisted_rows.extend(rows)
        return len(rows)

    monkeypatch.setattr(
        backfill,
        "persist_transaction_anomaly_scores",
        fake_persist,
    )

    result = backfill.backfill_anomaly_scores(
        Path("model.joblib"),
        confirm=True,
        batch_size=500,
    )

    assert result == {
        "total_transaction_count": 2,
        "scanned_transaction_count": 2,
        "persisted_score_count": 1,
        "skipped_existing_count": 1,
        "anomalous_score_count": 1,
    }
    assert persisted_rows == [
        {
            "transaction_id": "TX-MISSING",
            "model_version": "1.0.0",
            "ai_score": 95.0,
            "threshold": 90.6,
            "is_anomalous": True,
        }
    ]
