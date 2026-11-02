"""Bounded feed workers; durable database leases remain the job authority."""
import os


def worker_count(stage: str) -> int:
    if stage not in {"VALIDATION", "AUDIT"}:
        raise ValueError("Unknown feed worker stage")
    name = f"INGESTION_{stage}_CONCURRENCY"
    value = os.getenv(name, "1")
    if not value.isascii() or not value.isdecimal() or not 1 <= int(value) <= 8:
        raise ValueError(f"{name} must be an integer between 1 and 8")
    return int(value)
