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

    monkeypatch.setattr(
        "app.api.transactions.persist_transactions",
        fake_persist_transactions,
    )