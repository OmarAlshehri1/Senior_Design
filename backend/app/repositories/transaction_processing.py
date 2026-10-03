"""Durable processing RPCs. Only enabled after migration 012 is approved/applied."""
from typing import Any

import httpx
from fastapi.encoders import jsonable_encoder

from app.repositories.supabase_transactions import (
    REQUEST_TIMEOUT_SECONDS, SupabasePersistenceError,
    TransactionAlreadyExistsError, _get_configuration, _get_headers,
)


def rpc(name: str, payload: dict[str, Any]) -> Any:
    url, _ = _get_configuration()
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = client.post(f"{url}/rest/v1/rpc/{name}",
                                   headers=_get_headers(), json=jsonable_encoder(payload))
            response.raise_for_status()
            return response.json() if response.content else None
    except httpx.HTTPStatusError as exc:
        try:
            error = exc.response.json()
        except ValueError:
            error = None
        if (name == "create_transaction_with_job" and exc.response.status_code == 409
                and isinstance(error, dict) and error.get("code") == "23505"):
            raise TransactionAlreadyExistsError("Transaction ID already exists.") from exc
        raise SupabasePersistenceError("Durable transaction operation failed.") from exc
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError("Durable transaction operation failed.") from exc


def list_jobs(*, events: bool = False, limit: int = 25) -> list[dict[str, Any]]:
    if not events:
        rows = rpc("get_pending_transaction_jobs", {"p_limit": limit})
        if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
            raise SupabasePersistenceError("Invalid pending processing jobs.")
        return rows
    url, _ = _get_configuration()
    params = {"select": "transaction_id,alert_event" if events else "transaction_id",
              "order": "created_at.asc,transaction_id.asc", "limit": str(limit)}
    if events:
        params["event_pending"] = "eq.true"
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = client.get(f"{url}/rest/v1/transaction_processing_jobs",
                                  headers=_get_headers(), params=params)
            response.raise_for_status()
            rows = response.json()
            if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
                raise ValueError("Invalid job collection")
            return rows
    except (httpx.HTTPError, ValueError) as exc:
        raise SupabasePersistenceError("Could not read durable transaction jobs.") from exc


def acknowledge_event(transaction_id: str) -> None:
    url, _ = _get_configuration()
    try:
        with httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = client.patch(f"{url}/rest/v1/transaction_processing_jobs",
                headers=_get_headers(), params={"transaction_id": f"eq.{transaction_id}",
                                               "status": "eq.COMPLETED"},
                json={"event_pending": False})
            response.raise_for_status()
    except httpx.HTTPError as exc:
        raise SupabasePersistenceError("Could not acknowledge durable alert event.") from exc
