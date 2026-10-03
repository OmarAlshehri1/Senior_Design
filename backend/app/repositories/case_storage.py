"""Private Supabase Storage access. Object paths never leave the API response."""

from urllib.parse import quote

import httpx

from app.repositories.supabase_transactions import SupabaseConfigurationError, _get_configuration
from app.repositories.identity import IdentityError


def _object_url(bucket: str, key: str) -> tuple[str, dict[str, str]]:
    try:
        base_url, secret = _get_configuration()
    except SupabaseConfigurationError as exc:
        raise IdentityError("EVIDENCE_STORAGE_UNAVAILABLE") from exc
    path = f"{quote(bucket, safe='')}/{quote(key, safe='/')}"
    return f"{base_url}/storage/v1/object/{path}", {
        "apikey": secret,
        "Authorization": f"Bearer {secret}",
    }


def upload(bucket: str, key: str, content: bytes, content_type: str) -> None:
    url, headers = _object_url(bucket, key)
    headers.update({"Content-Type": content_type, "x-upsert": "false"})
    try:
        with httpx.Client(timeout=30, follow_redirects=False) as client:
            response = client.post(url, headers=headers, content=content)
        if response.status_code == 409:
            raise IdentityError("CONFLICT", 409)
        if not response.is_success:
            raise IdentityError("EVIDENCE_STORAGE_UNAVAILABLE")
    except httpx.HTTPError as exc:
        raise IdentityError("EVIDENCE_STORAGE_UNAVAILABLE") from exc


def download(bucket: str, key: str) -> tuple[bytes, str]:
    url, headers = _object_url(bucket, key)
    try:
        with httpx.Client(timeout=30, follow_redirects=False) as client:
            response = client.get(url, headers=headers)
        if response.status_code == 404:
            raise IdentityError("NOT_FOUND", 404)
        if not response.is_success:
            raise IdentityError("EVIDENCE_STORAGE_UNAVAILABLE")
        return response.content, response.headers.get("Content-Type", "application/octet-stream")
    except httpx.HTTPError as exc:
        raise IdentityError("EVIDENCE_STORAGE_UNAVAILABLE") from exc


def remove(bucket: str, key: str) -> None:
    try:
        base_url, secret = _get_configuration()
    except SupabaseConfigurationError as exc:
        raise IdentityError("EVIDENCE_STORAGE_CLEANUP_FAILED") from exc
    url = f"{base_url}/storage/v1/object/{quote(bucket, safe='')}"
    headers = {"apikey": secret, "Authorization": f"Bearer {secret}"}
    headers["Content-Type"] = "application/json"
    try:
        with httpx.Client(timeout=15, follow_redirects=False) as client:
            response = client.delete(url, headers=headers, json={"prefixes": [key]})
        if not response.is_success:
            raise IdentityError("EVIDENCE_STORAGE_CLEANUP_FAILED")
    except httpx.HTTPError as exc:
        raise IdentityError("EVIDENCE_STORAGE_CLEANUP_FAILED") from exc


def bucket_available(bucket: str) -> bool:
    try:
        base_url, secret = _get_configuration()
    except SupabaseConfigurationError:
        return False
    url = f"{base_url}/storage/v1/bucket/{quote(bucket, safe='')}"
    headers = {"apikey": secret, "Authorization": f"Bearer {secret}"}
    try:
        with httpx.Client(timeout=2, follow_redirects=False) as client:
            response = client.get(url, headers=headers)
        return response.is_success and response.json().get("public") is False
    except (httpx.HTTPError, ValueError, AttributeError):
        return False
