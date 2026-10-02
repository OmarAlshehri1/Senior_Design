from typing import Any

import pytest

from app.repositories import (
    supabase_transactions as repository,
)


def test_get_ghost_vendor_contexts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [
                {
                    "transaction_id": "TX-APPROVED",
                    "registry_authoritative": True,
                    "vendor_registered": True,
                    "vendor_active": True,
                },
                {
                    "transaction_id": "TX-UNKNOWN",
                    "registry_authoritative": True,
                    "vendor_registered": False,
                    "vendor_active": False,
                },
                {
                    "transaction_id": "TX-NONAUTH",
                    "registry_authoritative": False,
                    "vendor_registered": False,
                    "vendor_active": False,
                },
            ]

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(
            self,
            exc_type: object,
            exc_value: object,
            traceback: object,
        ) -> None:
            return None

        def post(
            self,
            endpoint: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            request.update(
                {
                    "endpoint": endpoint,
                    "headers": headers,
                    "json": json,
                }
            )
            return FakeResponse()

    monkeypatch.setenv(
        "SUPABASE_URL",
        "https://example.supabase.co",
    )
    monkeypatch.setenv(
        "SUPABASE_SECRET_KEY",
        "sb_secret_test",
    )
    monkeypatch.setattr(
        repository.httpx,
        "Client",
        FakeClient,
    )

    contexts = repository.get_ghost_vendor_contexts(
        [
            "TX-APPROVED",
            "TX-UNKNOWN",
            "TX-NONAUTH",
            "TX-APPROVED",
        ]
    )

    assert contexts == {
        "TX-APPROVED": {
            "registry_authoritative": True,
            "vendor_registered": True,
            "vendor_active": True,
        },
        "TX-UNKNOWN": {
            "registry_authoritative": True,
            "vendor_registered": False,
            "vendor_active": False,
        },
        "TX-NONAUTH": {
            "registry_authoritative": False,
            "vendor_registered": False,
            "vendor_active": False,
        },
    }
    assert request["endpoint"].endswith(
        "/rest/v1/rpc/get_ghost_vendor_context"
    )
    assert request["json"] == {
        "transaction_ids": [
            "TX-APPROVED",
            "TX-UNKNOWN",
            "TX-NONAUTH",
        ]
    }


def test_empty_ghost_vendor_lookup_skips_supabase(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnexpectedClient:
        def __init__(self, timeout: float) -> None:
            raise AssertionError(
                "Supabase must not be called."
            )

    monkeypatch.setattr(
        repository.httpx,
        "Client",
        UnexpectedClient,
    )

    assert repository.get_ghost_vendor_contexts([]) == {}


def test_invalid_ghost_vendor_context_is_rejected(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> list[dict[str, Any]]:
            return [
                {
                    "transaction_id": "TX-001",
                    "registry_authoritative": "true",
                    "vendor_registered": False,
                    "vendor_active": False,
                }
            ]

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(
            self,
            exc_type: object,
            exc_value: object,
            traceback: object,
        ) -> None:
            return None

        def post(
            self,
            endpoint: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            return FakeResponse()

    monkeypatch.setenv(
        "SUPABASE_URL",
        "https://example.supabase.co",
    )
    monkeypatch.setenv(
        "SUPABASE_SECRET_KEY",
        "sb_secret_test",
    )
    monkeypatch.setattr(
        repository.httpx,
        "Client",
        FakeClient,
    )

    with pytest.raises(
        repository.SupabasePersistenceError,
        match="invalid ghost-vendor context values",
    ):
        repository.get_ghost_vendor_contexts(["TX-001"])


def test_ghost_vendor_lookup_failure_is_wrapped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FailingClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self) -> "FailingClient":
            raise repository.httpx.ConnectError(
                "Connection failed."
            )

        def __exit__(
            self,
            exc_type: object,
            exc_value: object,
            traceback: object,
        ) -> None:
            return None

    monkeypatch.setenv(
        "SUPABASE_URL",
        "https://example.supabase.co",
    )
    monkeypatch.setenv(
        "SUPABASE_SECRET_KEY",
        "sb_secret_test",
    )
    monkeypatch.setattr(
        repository.httpx,
        "Client",
        FailingClient,
    )

    with pytest.raises(
        repository.SupabasePersistenceError,
        match="Failed to read ghost-vendor context",
    ):
        repository.get_ghost_vendor_contexts(["TX-001"])
