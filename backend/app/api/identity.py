from datetime import datetime, timezone
import os
from typing import Literal
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator
from starlette.concurrency import run_in_threadpool

from app.repositories import identity as store
from app.repositories.supabase_transactions import SupabaseConfigurationError
from app.services.identity import (get_current_user, public_user, register_session, require_active,
                                   require_roles, token_hash, verify_token, bearer)


router = APIRouter(tags=["identity"])
admin = require_roles("ADMIN")
Role = Literal["AUDITOR", "SUPERVISOR", "ADMIN"]


class EmailInput(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    email: str = Field(min_length=3, max_length=254)

    @field_validator("email")
    @classmethod
    def email_valid(cls, value):
        # Keep filters safe without introducing an unpinned email dependency.
        import re
        if not re.fullmatch(r"[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}", value):
            raise ValueError("Invalid email")
        return value.lower()


class LoginInput(EmailInput):
    # Password whitespace is meaningful; do not strip it.
    password: str = Field(min_length=1, max_length=1024)
    model_config = ConfigDict(extra="forbid")


class AccessInput(EmailInput):
    fullName: str = Field(min_length=1, max_length=200)
    department: str = Field(min_length=1, max_length=200)
    employeeId: str | None = Field(default=None, max_length=100)
    reason: str = Field(min_length=1, max_length=500)


class TokenInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    access_token: str = Field(min_length=1, max_length=8192)
    refresh_token: str = Field(min_length=1, max_length=8192)


class PasswordInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(min_length=12, max_length=1024)


class DecisionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approve: bool
    role: Role | None = None
    reason: str | None = Field(default=None, max_length=500)


class ActionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    action: Literal["role", "disable", "enable"]
    role: Role | None = None


class UnlockDecisionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    approve: bool
    reason: str | None = Field(default=None, max_length=500)


class UnlockConfirmInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    access_token: str = Field(min_length=1, max_length=8192)


async def call(fn, *args, **kwargs):
    try:
        return await run_in_threadpool(fn, *args, **kwargs)
    except store.IdentityError as exc:
        raise HTTPException(exc.status, detail=exc.code) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(503, detail="AUTH_UNAVAILABLE") from exc


async def limit(request: Request, operation: str):
    bucket = f"{operation}:{token_hash(request.client.host if request.client else 'unknown')}"
    allowed = await call(store.rpc, "consume_auth_limit", p_bucket=bucket, p_limit=10, p_seconds=60)
    if allowed is not True:
        raise HTTPException(429, detail="RATE_LIMITED", headers={"Retry-After": "60"})


def no_cache(response: Response):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"


def provider_redirect_query() -> dict[str, str] | None:
    # Only server configuration may choose the provider callback, preventing
    # callers from turning recovery or invitation links into open redirects.
    redirect = os.getenv("SUPABASE_AUTH_REDIRECT_URL", "").strip()
    return {"redirect_to": redirect} if redirect else None


@router.post("/auth/login")
async def login(body: LoginInput, request: Request, response: Response):
    no_cache(response)
    await limit(request, "login")
    try:
        session = await run_in_threadpool(store.request, "POST", "token", auth=True,
                      query={"grant_type": "password"}, body=body.model_dump())
    except store.IdentityError as exc:
        if exc.code == "INVALID_CREDENTIALS":
            await call(store.rpc, "record_login", p_email=body.email, p_success=False)
        raise HTTPException(exc.status, detail=exc.code) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(503, detail="AUTH_UNAVAILABLE") from exc
    user = await call(register_session, session["access_token"], login=True)
    return {"access_token": session["access_token"], "refresh_token": session["refresh_token"],
            "expires_in": session["expires_in"], "user": public_user(user)}


@router.post("/auth/refresh")
async def refresh(body: TokenInput, request: Request, response: Response):
    no_cache(response)
    await limit(request, "refresh")
    session = await call(store.request, "POST", "token", auth=True,
                         query={"grant_type": "refresh_token"}, body={"refresh_token": body.refresh_token})
    verified = await call(verify_token, session["access_token"])
    user = await call(store.rpc, "rotate_app_session", p_old_hash=token_hash(body.access_token),
            p_user_id=verified["id"], p_hash=token_hash(session["access_token"]),
            p_expires=datetime.fromtimestamp(verified["expires"], timezone.utc).isoformat())
    await call(require_active, user)
    return {"access_token": session["access_token"], "refresh_token": session["refresh_token"],
            "expires_in": session["expires_in"], "user": public_user(user)}


@router.post("/auth/exchange")
async def exchange(body: TokenInput, request: Request, response: Response):
    """Accept provider-issued invitation/recovery tokens after server verification."""
    no_cache(response)
    await limit(request, "exchange")
    user = await call(register_session, body.access_token)
    verified = await call(verify_token, body.access_token)
    return {**body.model_dump(), "expires_in": max(0, int(verified["expires"]-datetime.now(timezone.utc).timestamp())),
            "user": public_user(user)}


@router.get("/auth/me")
async def me(response: Response, user: dict = Depends(get_current_user)):
    no_cache(response)
    return public_user(user)


@router.post("/auth/logout", status_code=204)
async def logout(request: Request, user: dict = Depends(get_current_user)):
    # Revoke application access first even if the provider is unavailable.
    await call(store.request, "PATCH", "app_sessions", query={"user_id": f"eq.{user['id']}", "revoked_at": "is.null"},
               body={"revoked_at": datetime.now(timezone.utc).isoformat()})
    try:
        await run_in_threadpool(store.request, "POST", "logout", auth=True,
                               token=bearer(request.headers.get("Authorization")))
    except store.IdentityError:
        pass
    return Response(status_code=204)


@router.post("/auth/password-reset", status_code=202)
async def request_reset(body: EmailInput, request: Request):
    await limit(request, "reset")
    # Provider uses its configured allowlisted site URL. No user-controlled redirect.
    try:
        await run_in_threadpool(store.request, "POST", "recover", auth=True,
                                body={"email": body.email}, query=provider_redirect_query())
    except store.IdentityError as exc:
        if exc.code != "INVALID_CREDENTIALS":
            raise HTTPException(exc.status, detail=exc.code) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(503, detail="AUTH_UNAVAILABLE") from exc
    return {"message": "If the account is eligible, instructions will be sent."}


@router.post("/auth/password", status_code=204)
async def update_password(body: PasswordInput, request: Request, user: dict = Depends(get_current_user)):
    await call(store.request, "PUT", "user", auth=True,
               token=bearer(request.headers.get("Authorization")), body={"password": body.password})
    await call(store.request, "PATCH", "app_sessions", query={"user_id": f"eq.{user['id']}", "revoked_at": "is.null"},
               body={"revoked_at": datetime.now(timezone.utc).isoformat()})
    await call(store.request, "POST", "login_history", body={"user_id": user["id"], "actor_id": user["id"], "action": "PASSWORD_RESET", "outcome": "SUCCESS"})
    return Response(status_code=204)


@router.post("/access-requests", status_code=202)
async def request_access(body: AccessInput, request: Request):
    await limit(request, "access")
    try:
        await run_in_threadpool(store.request, "POST", "access_requests", body={
            "email": body.email, "full_name": body.fullName, "department": body.department,
            "employee_id": body.employeeId, "reason": body.reason})
    except store.IdentityError as exc:
        if exc.status != 409:
            raise HTTPException(exc.status, detail=exc.code) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(503, detail="AUTH_UNAVAILABLE") from exc
    return {"message": "Your request has been received for review."}


@router.post("/auth/unlock-request", status_code=202)
async def request_account_unlock(body: EmailInput, request: Request):
    await limit(request, "unlock")
    try:
        await run_in_threadpool(store.request, "POST", "otp", auth=True,
                                body={"email": body.email, "create_user": False},
                                query=provider_redirect_query())
    except store.IdentityError as exc:
        if exc.code == "RATE_LIMITED":
            raise HTTPException(exc.status, detail=exc.code) from exc
        # Do not reveal whether the address belongs to an eligible account.
    except SupabaseConfigurationError as exc:
        raise HTTPException(503, detail="AUTH_UNAVAILABLE") from exc
    return {"message": "If this address belongs to a locked account, a verification link will be sent. Open it to submit an unlock request."}


@router.post("/auth/unlock-request/confirm", status_code=202)
async def confirm_account_unlock(body: UnlockConfirmInput, request: Request):
    await limit(request, "unlock-confirm")
    verified = await call(verify_token, body.access_token)
    await call(store.rpc, "request_account_unlock", p_email=verified["email"])
    return {"message": "Your unlock request has been submitted for administrator review."}


@router.get("/users")
async def users(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                user: dict = Depends(admin)):
    result = await call(store.collection, "user_profiles", page=page, page_size=page_size)
    result["items"] = [public_user(row) for row in result["items"]]
    return result


@router.get("/users/{user_id}")
async def user_detail(user_id: UUID, user: dict = Depends(admin)):
    row = await call(store.one, "user_profiles", "id", str(user_id))
    if row is None:
        raise HTTPException(404, detail="User not found.")
    return public_user(row)


@router.patch("/users/{user_id}")
async def user_action(user_id: UUID, body: ActionInput, user: dict = Depends(admin)):
    if body.action == "role" and body.role is None:
        raise HTTPException(422, detail="Role required.")
    return public_user(await call(store.rpc, "admin_user_action", p_actor=user["id"], p_user_id=str(user_id),
                                 p_action=body.action, p_role=body.role))


@router.get("/access-requests")
async def access_requests(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                         user: dict = Depends(admin)):
    return await call(store.collection, "access_requests", page=page, page_size=page_size, order="requested_at.desc,id")


@router.get("/account-unlock-requests")
async def unlock_requests(page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                         user: dict = Depends(admin)):
    return await call(store.collection, "account_unlock_requests", page=page, page_size=page_size,
                      order="requested_at.desc,id")


@router.post("/account-unlock-requests/{request_id}/decision")
async def decide_unlock_request(request_id: UUID, body: UnlockDecisionInput, user: dict = Depends(admin)):
    return await call(store.rpc, "decide_account_unlock", p_actor=user["id"], p_request=str(request_id),
                      p_approve=body.approve, p_reason=body.reason)


@router.post("/access-requests/{request_id}/decision")
async def decide(request_id: UUID, body: DecisionInput, user: dict = Depends(admin)):
    row = await call(store.one, "access_requests", "id", str(request_id))
    if row is None:
        raise HTTPException(404, detail="Request not found.")
    if row["status"] != "PENDING":
        raise HTTPException(409, detail="Request already decided.")
    target = None
    if body.approve:
        if body.role is None:
            raise HTTPException(422, detail="Role required.")
        target = await call(store.one, "user_profiles", "email", row["email"])
        if target is None:
            # The Auth trigger creates a DISABLED profile. An invitation alone grants no API access.
            await call(store.request, "POST", "invite", auth=True, body={"email": row["email"]},
                       query=provider_redirect_query())
            target = await call(store.one, "user_profiles", "email", row["email"])
        if target is None or target["account_status"] != "DISABLED":
            raise HTTPException(409, detail="Account cannot be activated from this request.")
    return await call(store.rpc, "decide_access_request", p_actor=user["id"], p_request=str(request_id),
                      p_approve=body.approve, p_user_id=target["id"] if target else None,
                      p_role=body.role, p_reason=body.reason)


@router.get("/users/{user_id}/login-history")
async def login_history(user_id: UUID, page: int = Query(1, ge=1), page_size: int = Query(25, ge=1, le=100),
                        user: dict = Depends(get_current_user)):
    if str(user_id) != user["id"] and user["role"] != "ADMIN":
        raise HTTPException(403, detail="FORBIDDEN")
    return await call(store.collection, "login_history", page=page, page_size=page_size,
                      filters={"user_id": f"eq.{user_id}"})
