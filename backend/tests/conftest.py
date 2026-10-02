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
