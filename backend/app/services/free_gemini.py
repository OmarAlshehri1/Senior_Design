"""Fail-closed access to an owner-verified, unbilled Gemini project.

The generation API cannot attest billing tier. A dedicated owner-confirmed unbilled
project/key is required; a generic/possibly paid GEMINI_API_KEY is never used.
"""
import os
import threading
import time

FREE_MODELS = frozenset({'gemini-3.8-flash', 'gemini-3.1-flash-lite'})
_lock = threading.Lock()
_blocked_until = 0.0


class FreeTierUnavailable(RuntimeError):
    pass


def thinking_options(model: str) -> dict:
    """Explicit bounded-latency settings; never select another model on failure."""
    if model == 'gemini-3.1-flash-lite':
        return {'thinkingLevel': 'minimal'}
    if model == 'gemini-3.8-flash':
        return {'thinkingLevel': 'low'}
    return {}


def configuration(model: str) -> str:
    if os.getenv('GEMINI_FREE_TIER_CONFIRMED', 'false').lower() != 'true':
        raise FreeTierUnavailable('FREE_TIER_NOT_VERIFIED')
    if not os.getenv('GEMINI_FREE_PROJECT_ID', '').strip():
        raise FreeTierUnavailable('FREE_PROJECT_NOT_VERIFIED')
    # No artificial daily expiry. This project must remain unlinked from billing;
    # verification is an account invariant, not a recurring manual approval task.
    if model not in FREE_MODELS:
        raise FreeTierUnavailable('MODEL_NOT_APPROVED_FOR_FREE_TIER')
    key = os.getenv('GEMINI_FREE_API_KEY', '').strip()
    if not key or len(key)>4096 or '\r' in key or '\n' in key:
        raise FreeTierUnavailable('FREE_KEY_NOT_CONFIGURED')
    with _lock:
        if time.monotonic() < _blocked_until:
            raise FreeTierUnavailable('FREE_QUOTA_EXHAUSTED')
    return key


def quota_exhausted() -> None:
    """Pause both commentary paths for 15 minutes; never retry the rejected call."""
    global _blocked_until
    with _lock:
        _blocked_until = time.monotonic() + 15 * 60
