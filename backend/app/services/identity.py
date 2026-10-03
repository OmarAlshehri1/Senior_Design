import base64
import hashlib
import json
import time
from datetime import datetime, timezone
from uuid import UUID

from fastapi import Depends, HTTPException, Request
from starlette.concurrency import run_in_threadpool

from app.repositories import identity as store
from app.repositories.supabase_transactions import _get_configuration, SupabaseConfigurationError


ROLES = frozenset({"AUDITOR", "SUPERVISOR", "ADMIN"})


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def public_user(row: dict) -> dict:
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"],
            "accountStatus": row["account_status"], "lastLoginAt": row.get("last_login_at"),
            "failedSignInAttempts": row.get("failed_sign_in_attempts", 0),
            "lockedAt": row.get("locked_at"), "disabledAt": row.get("disabled_at"),
            "lockReason": row.get("status_reason"), "disabledReason": row.get("status_reason"),
            "createdAt": row.get("created_at"), "updatedAt": row.get("updated_at")}


def require_active(row: dict | None) -> dict:
    if not row or row.get("role") not in ROLES:
        raise store.IdentityError("FORBIDDEN", 403)
    if row.get("account_status") != "ACTIVE":
        code = "ACCOUNT_LOCKED" if row.get("account_status") == "LOCKED" else "ACCOUNT_DISABLED"
        raise store.IdentityError(code, 403)
    return row


def verify_token(token: str) -> dict:
    if not token or len(token)>8192:
        raise store.IdentityError("SESSION_EXPIRED", 401)
    # This endpoint validates signature and validity at the configured Auth server.
    # Parsing below only occurs AFTER provider validation; no local homemade signature verifier.
    user = store.request("GET", "user", token=token, auth=True)
    try:
        segments = token.split(".")
        if len(segments) != 3:
            raise ValueError("Invalid token")
        claims = json.loads(base64.urlsafe_b64decode(segments[1] + "="*(-len(segments[1])%4)))
        url, _ = _get_configuration()
        if (claims["iss"] != f"{url}/auth/v1" or claims["aud"] != "authenticated"
            or claims["role"] != "authenticated" or claims["exp"] <= time.time()
            or str(UUID(claims["sub"])) != user["id"] or user.get("is_anonymous")
            or claims.get("is_anonymous")):
            raise ValueError("Invalid token")
        return {"id": user["id"], "email": user["email"].lower(), "expires": claims["exp"]}
    except (ValueError, KeyError, TypeError) as exc:
        raise store.IdentityError("SESSION_EXPIRED", 401) from exc


def register_session(token: str, *, login: bool = False) -> dict:
    verified = verify_token(token)
    row = store.one("user_profiles", "id", verified["id"])
    require_active(row)
    if row["email"] != verified["email"]:
        raise store.IdentityError("FORBIDDEN", 403)
    if login:
        row = require_active(store.rpc("record_login", p_email=row["email"], p_success=True))
    return require_active(store.rpc("start_app_session", p_user_id=verified["id"], p_hash=token_hash(token),
                     p_expires=datetime.fromtimestamp(verified["expires"], timezone.utc).isoformat()))


def authenticate_token(token: str) -> dict:
    verified = verify_token(token)
    row = store.rpc("check_app_session", p_hash=token_hash(token))
    if row is None or row.get("id") != verified["id"]:
        raise store.IdentityError("SESSION_EXPIRED", 401)
    return require_active(row)


def bearer(value: str | None) -> str:
    parts = (value or "").split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise store.IdentityError("SESSION_EXPIRED", 401)
    return parts[1]


async def get_current_user(request: Request) -> dict:
    try:
        return await run_in_threadpool(authenticate_token, bearer(request.headers.get("Authorization")))
    except store.IdentityError as exc:
        raise HTTPException(exc.status, detail=exc.code, headers={"WWW-Authenticate": "Bearer"} if exc.status==401 else None) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(503, detail="AUTH_UNAVAILABLE") from exc


def require_roles(*roles):
    async def dependency(user: dict = Depends(get_current_user)):
        if user["role"] not in roles:
            raise HTTPException(403, detail="FORBIDDEN")
        return user
    return dependency
