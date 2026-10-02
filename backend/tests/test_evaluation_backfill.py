from typing import Any

import pytest

from scripts import backfill_transaction_evaluations as backfill


def test_backfill_requires_confirmation() -> None:
    with pytest.raises(
        backfill.BackfillConfirmationError
    ):
        backfill.backfill_transaction_evaluations()


def test_backfill_persists_only_missing_evaluations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    persisted_rows: list[dict[str, Any]] = []

    transactions = [
        {
            "id": "TX-001",
            "rule_status": "PASSED",
            "rule_score": 0.0,
            "rule_results": [],
        },
        {
            "id": "TX-002",
            "rule_status": "REVIEW",
            "rule_score": 50.0,
            "rule_results": [],
        },
    ]

    monkeypatch.setattr(
        backfill,
        "list_transactions",
        lambda **kwargs: (transactions, 2),
    )
    monkeypatch.setattr(
        backfill,
        "get_latest_transaction_evaluations",
        lambda transaction_ids: {
            "TX-001": {
                "rule_status": "PASSED",
            }
        },
    )

    def fake_persist(
        evaluations: list[dict[str, Any]],
    ) -> int:
        persisted_rows.extend(evaluations)
        return len(evaluations)

    monkeypatch.setattr(
        backfill,
        "persist_transaction_evaluations",
        fake_persist,
    )
    monkeypatch.setattr(
        backfill,
        "get_evaluation_coverage",
        lambda: {
            "coverage_percent": 100.0,
        },
    )

    result = (
        backfill.backfill_transaction_evaluations(
            confirm=True,
            batch_size=100,
        )
    )

    assert result == {
        "total_transaction_count": 2,
        "scanned_transaction_count": 2,
        "persisted_evaluation_count": 1,
        "skipped_existing_count": 1,
        "coverage_percent": 100.0,
    }
    assert persisted_rows == [
        {
            "transaction_id": "TX-002",
            "evaluation_version": "1.0.0",
            "rule_status": "REVIEW",
            "rule_score": 50.0,
            "rule_results": [],
        }
    ]
