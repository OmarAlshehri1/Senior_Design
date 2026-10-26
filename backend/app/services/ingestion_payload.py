"""Shared bounded payload parser used by intake and isolated validation workers."""
import json
import math
import re
from decimal import Decimal
from typing import Any

MAX_BODY = 256 * 1024
IDENTIFIER = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.:/-]{0,127}\Z")


def object_without_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate key")
        result[key] = value
    return result


def check_value(value: Any, depth: int = 0) -> None:
    if depth > 4:
        raise ValueError("Nesting too deep")
    if isinstance(value, str):
        if len(value.encode("utf-8")) > 16384 or "\x00" in value:
            raise ValueError("Invalid string")
    elif isinstance(value, dict):
        if len(value) > 64:
            raise ValueError("Too many fields")
        for key, child in value.items():
            check_value(key, depth)
            check_value(child, depth + 1)
    elif isinstance(value, list):
        for child in value:
            check_value(child, depth + 1)
    elif isinstance(value, float) and not math.isfinite(value):
        raise ValueError("Non-finite number")
    elif isinstance(value, Decimal) and (not value.is_finite() or abs(value.adjusted()) > 1000):
        raise ValueError("Unsupported numeric range")


def parse_envelope(body: bytes) -> dict[str, Any]:
    if len(body) > MAX_BODY:
        raise ValueError("Payload too large")
    envelope = json.loads(body.decode("utf-8"), object_pairs_hook=object_without_duplicates,
                          parse_float=Decimal)
    required = {"schema_version", "source_id", "event_id", "record_id", "event_type", "original_record"}
    if not isinstance(envelope, dict) or set(envelope) != required:
        raise ValueError("Invalid envelope fields")
    if envelope["schema_version"] != "1.0" or envelope["event_type"] != "transaction.created":
        raise ValueError("Unsupported contract")
    for field in ("source_id", "event_id", "record_id"):
        if not isinstance(envelope[field], str) or not IDENTIFIER.fullmatch(envelope[field]):
            raise ValueError("Invalid identifier")
    if not isinstance(envelope["original_record"], dict):
        raise ValueError("Original record must be an object")
    check_value(envelope["original_record"])
    return envelope


def fingerprint_value(value: Any) -> Any:
    """Typed, order-independent object fingerprint without binary-float conversion."""
    if isinstance(value, dict):
        return ["object", [[key, fingerprint_value(child)] for key, child in sorted(value.items())]]
    if isinstance(value, list):
        return ["array", [fingerprint_value(child) for child in value]]
    if isinstance(value, Decimal):
        return ["decimal", str(value)]
    return [type(value).__name__, value]
