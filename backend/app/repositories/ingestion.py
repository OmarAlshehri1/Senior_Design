"""Restricted ingestion RPCs; never log request bodies or source credentials."""
from typing import Any
from contextlib import contextmanager
from contextvars import ContextVar
from threading import Condition
from time import perf_counter

import httpx

from app.repositories.supabase_transactions import (
    SupabasePersistenceError, _get_configuration, _get_headers,
)

_pool = Condition()
_client: httpx.Client | None = None
_users = 0
_closing = False
_timings: ContextVar[tuple[float, dict[str, float]] | None] = ContextVar("ingestion_rpc_timings", default=None)


@contextmanager
def capture_rpc_timings():
    """Share one duration collector with a copied thread-pool context."""
    durations: dict[str, float] = {}
    token = _timings.set((perf_counter(), durations))
    try:
        yield durations
    finally:
        _timings.reset(token)


def _duration_trace(durations):
    # Never inspect trace info: it may contain credentials, bodies and URLs.
    phases = {"connection.connect_tcp": "tcp", "connection.start_tls": "tls",
              "http11.send_request_headers": "send", "http11.send_request_body": "send",
              "http11.receive_response_headers": "wait", "http11.receive_response_body": "body"}
    starts = {}
    for key in set(phases.values()):
        durations[key] = 0.0

    def trace(name, _info):
        event, _, state = name.rpartition(".")
        if event not in phases:
            return
        if state == "started":
            starts[event] = perf_counter()
        elif state in {"complete", "failed"} and event in starts:
            durations[phases[event]] += (perf_counter() - starts.pop(event)) * 1000
    return trace


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
                    "prepare_feed_audits", "claim_feed_audit", "finish_feed_audit", "release_feed_audit", "resume_feed_audit",
                    "claim_feed_work", "finish_feed_assessment", "release_feed_assessment"}:
        raise ValueError("Unsupported ingestion operation.")
    captured = _timings.get()
    durations = captured[1] if captured is not None else None
    if durations is not None:
        durations["dispatch"] = (perf_counter() - captured[0]) * 1000
    url, _ = _get_configuration()
    lease_started = perf_counter()
    try:
        with _rpc_client() as client:
            if durations is not None:
                durations["lease"] = (perf_counter() - lease_started) * 1000
            options = {"extensions": {"trace": _duration_trace(durations)}} if durations is not None else {}
            http_started = perf_counter()
            try:
                response = client.post(f"{url}/rest/v1/rpc/{name}", headers=_get_headers(), json=payload, **options)
            finally:
                if durations is not None:
                    durations["http"] = (perf_counter() - http_started) * 1000
            response.raise_for_status()
            decode_started = perf_counter()
            try:
                return response.json()
            finally:
                if durations is not None:
                    durations["decode"] = (perf_counter() - decode_started) * 1000
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError("Ingestion storage unavailable.") from exc
