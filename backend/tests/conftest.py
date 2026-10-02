from typing import Any

import pytest


@pytest.fixture(autouse=True)
def mock_transaction_persistence(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_persist_transactions(
        transactions: list[dict[str, Any]],
    ) -> int:
        return len(transactions)

    def fake_persist_transaction_evaluation(
        *,
        transaction_id: str,
        evaluation_version: str,
        rule_status: str,
        rule_score: float | None,
        rule_results: list[dict[str, Any]],
    ) -> None:
        return None

    def fake_get_duplicate_payment_counts(
        transaction_ids: list[str],
    ) -> dict[str, int]:
        return {
            transaction_id: 0
            for transaction_id in transaction_ids
        }

    monkeypatch.setattr(
        "app.api.transactions.persist_transactions",
        fake_persist_transactions,
    )
    monkeypatch.setattr(
        (
            "app.api.transactions."
            "get_duplicate_payment_counts"
        ),
        fake_get_duplicate_payment_counts,
    )
    monkeypatch.setattr(
        (
            "app.api.transactions."
            "persist_transaction_evaluation"
        ),
        fake_persist_transaction_evaluation,
    )

    def fake_get_invoice_splitting_contexts(
        transaction_ids: list[str],
    ) -> dict[str, dict[str, int | float]]:
        return {
            transaction_id: {
                "historical_transaction_count": 0,
                "window_total_amount": 0.0,
            }
            for transaction_id in transaction_ids
        }

    monkeypatch.setattr(
        (
            "app.api.transactions."
            "get_invoice_splitting_contexts"
        ),
        fake_get_invoice_splitting_contexts,
    )

    def fake_get_ghost_vendor_contexts(
        transaction_ids: list[str],
    ) -> dict[str, dict[str, bool]]:
        return {
            transaction_id: {
                "registry_authoritative": True,
                "vendor_registered": True,
                "vendor_active": True,
            }
            for transaction_id in transaction_ids
        }

    monkeypatch.setattr(
        (
            "app.api.transactions."
            "get_ghost_vendor_contexts"
        ),
        fake_get_ghost_vendor_contexts,
    )

    def fake_persist_transaction_anomaly_scores(
        scores: list[dict[str, Any]],
    ) -> int:
        return len(scores)

    class FakeAnomalyModel:
        version = "1.0.0"
        threshold = 90.6

        def score(
            self,
            feature_records: list[dict[str, Any]],
        ) -> list[float]:
            return [
                25.0
                for _ in feature_records
            ]

        def is_anomalous(
            self,
            ai_score: float,
        ) -> bool:
            return ai_score >= self.threshold

    monkeypatch.setattr(
        (
            "app.api.transactions."
            "persist_transaction_anomaly_scores"
        ),
        fake_persist_transaction_anomaly_scores,
    )
    monkeypatch.setattr(
        "app.api.transactions._get_anomaly_model",
        lambda: FakeAnomalyModel(),
    )
