"""Restricted ingestion RPCs; never log request bodies or source credentials."""
from typing import Any
from contextlib import contextmanager
from threading import Condition

import httpx

from app.repositories.supabase_transactions import (
    SupabasePersistenceError, _get_configuration, _get_headers,
)

_pool = Condition()
_client: httpx.Client | None = None
_users = 0
_closing = False


@contextmanager
def _rpc_client():
    """Lease a thread-safe client without holding the lock during network I/O."""
    global _client, _users
    with _pool:
        _pool.wait_for(lambda: not _closing)
        if _client is None:
            _client = httpx.Client(timeout=10, follow_redirects=False)
        client = _client
        _users += 1
    try:
        yield client
    finally:
        with _pool:
            _users -= 1
            _pool.notify_all()


def close_rpc_client() -> None:
    """Drain in-flight calls before closing; a later app lifespan can reopen."""
    global _client, _closing
    with _pool:
        _pool.wait_for(lambda: not _closing)
        _closing = True
        _pool.wait_for(lambda: _users == 0)
        client, _client = _client, None
    try:
        if client is not None:
            client.close()
    finally:
        with _pool:
            _closing = False
            _pool.notify_all()


def rpc(name: str, payload: dict[str, Any]) -> Any:
    if name not in {"ingestion_source", "submit_ingestion_event", "read_ingestion_receipts",
                    "claim_ingestion_validation", "finish_ingestion_validation",
                    "release_ingestion_validation", "resume_ingestion_validation",
                    "prepare_feed_audits", "claim_feed_audit", "finish_feed_audit", "release_feed_audit", "resume_feed_audit"}:
        raise ValueError("Unsupported ingestion operation.")
    url, _ = _get_configuration()
    try:
        with _rpc_client() as client:
            response = client.post(f"{url}/rest/v1/rpc/{name}", headers=_get_headers(), json=payload)
            response.raise_for_status()
            return response.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError("Ingestion storage unavailable.") from exc
