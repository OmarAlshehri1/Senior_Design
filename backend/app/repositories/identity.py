"""Server-only Supabase Auth/identity storage. Never return provider errors/tokens in logs."""
from typing import Any

import httpx

from app.repositories.supabase_transactions import _get_configuration, _get_headers


class IdentityError(Exception):
    def __init__(self, code: str, status: int = 503):
        super().__init__(code)
        self.code = code
        self.status = status


def request(method: str, path: str, *, body: Any = None, token: str | None = None,
            query: dict | None = None, auth: bool = False) -> Any:
    url, _ = _get_configuration()
    headers = _get_headers()
    headers["Prefer"] = "return=representation,count=exact"
    if token is not None:
        headers["Authorization"] = f"Bearer {token}"
    try:
        with httpx.Client(timeout=15, follow_redirects=False) as client:
            response = client.request(method, f"{url}{'/auth/v1' if auth else '/rest/v1'}/{path}",
                                      headers=headers, json=body, params=query)
        if not response.is_success:
            if auth and response.status_code in (400, 401, 403, 422):
                raise IdentityError("INVALID_CREDENTIALS", 401)
            if response.status_code == 429:
                raise IdentityError("RATE_LIMITED", 429)
            if response.status_code == 409:
                raise IdentityError("CONFLICT", 409)
            raise IdentityError("AUTH_UNAVAILABLE")
        return response.json() if response.content else None
    except (httpx.HTTPError, ValueError) as exc:
        raise IdentityError("AUTH_UNAVAILABLE") from exc


def rpc(name: str, **payload) -> Any:
    return request("POST", f"rpc/{name}", body=payload)


def one(table: str, field: str, value: str) -> dict | None:
    # IDs are validated UUIDs and emails cannot contain PostgREST control syntax.
    rows = request("GET", table, query={field: f"eq.{value}", "limit": "1"})
    if not isinstance(rows, list):
        raise IdentityError("AUTH_UNAVAILABLE")
    return rows[0] if rows else None


def collection(table: str, *, page: int = 1, page_size: int = 25,
               filters: dict | None = None, order: str = "created_at.desc,id") -> dict:
    # Fetch an extra row; page_size bounds memory. Exact totals use a separate HEAD.
    url, _ = _get_configuration()
    query = {"order": order, "limit": str(page_size), "offset": str((page-1)*page_size), **(filters or {})}
    try:
        with httpx.Client(timeout=15) as client:
            response = client.get(f"{url}/rest/v1/{table}", headers={**_get_headers(), "Prefer": "count=exact"}, params=query)
            response.raise_for_status()
        rows = response.json()
        total = int(response.headers["Content-Range"].split("/")[-1])
        if not isinstance(rows, list):
            raise ValueError("Invalid collection")
        return {"items": rows, "total": total, "page": page, "page_size": page_size}
    except (httpx.HTTPError, ValueError, KeyError) as exc:
        raise IdentityError("AUTH_UNAVAILABLE") from exc
