"""Benchmark the transaction API pipeline without live services or data.

All Supabase writes and reads and Gemini calls are replaced with in-process
stubs. The committed Isolation Forest artifact and transaction API route run
normally. This measures local application work only, not hosted throughput.
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.metadata
import json
import logging
import os
import platform
import subprocess
import sys
import threading
import time
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx


BACKEND_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_ROOT))

# Ensure dotenv cannot supply credentials to this isolated benchmark process.
for name in (
    "SUPABASE_URL",
    "SUPABASE_SECRET_KEY",
    "GEMINI_API_KEY",
):
    os.environ[name] = ""
os.environ["TRANSACTION_RECOVERY_ENABLED"] = "false"
os.environ["DAILY_REPORT_SCHEDULER_ENABLED"] = "false"
warnings.filterwarnings(
    "ignore",
    message=r"sklearn\.utils\.parallel\.delayed.*",
    category=UserWarning,
    module=r"sklearn\.utils\.parallel",
)

from app.api import transactions as transaction_api  # noqa: E402
from app.main import app  # noqa: E402
from app.services.identity import get_current_user  # noqa: E402


PAYLOAD: dict[str, Any] = {
    "timestamp": "2026-10-04T12:00:00Z",
    "vendor_id": "BENCH-VENDOR",
    "vendor_name": "Synthetic Benchmark Vendor",
    "invoice_number": "BENCH-INVOICE",
    "category": "synthetic_outlier",
    "amount": 1_000_000_000,
    "currency": "SAR",
    "created_by": "BENCH-USER",
    "approved_by": "BENCH-USER",
    "approver_role": "Manager",
    "approval_limit": 1,
}


def percentile(values: list[float], percent: float) -> float:
    ordered = sorted(values)
    index = max(0, min(len(ordered) - 1, int((percent / 100) * len(ordered) + 0.999999) - 1))
    return round(ordered[index], 3)


def make_request_body(sequence: int) -> dict[str, Any]:
    return {"id": f"PHASE23-{sequence:08d}", **PAYLOAD}


async def run_scenario(
    *,
    client: httpx.AsyncClient,
    mode: str,
    concurrency: int,
    request_count: int,
    sequence_start: int,
    starts: dict[str, int],
    start_lock: threading.Lock,
    alert_latencies: list[float],
    alert_lock: threading.Lock,
) -> dict[str, Any]:
    semaphore = asyncio.Semaphore(concurrency)
    request_latencies: list[float] = []
    outcomes: list[dict[str, Any]] = []

    async def send_one(index: int) -> None:
        sequence = sequence_start + index
        body = make_request_body(sequence)
        async with semaphore:
            started_ns = time.perf_counter_ns()
            with start_lock:
                starts[body["id"]] = started_ns
            response = await client.post("/api/v1/transactions", json=body)
            elapsed_ms = (time.perf_counter_ns() - started_ns) / 1_000_000
        request_latencies.append(elapsed_ms)
        if response.status_code != 201:
            raise RuntimeError(
                f"Synthetic request returned status {response.status_code}."
            )
        payload = response.json()
        outcomes.append(
            {
                "risk_level": payload.get("risk_level"),
                "rule_score": payload.get("rule_score"),
                "risk_score": payload.get("risk_score"),
            }
        )

    wall_started = time.perf_counter()
    await asyncio.gather(*(send_one(i) for i in range(request_count)))
    wall_seconds = time.perf_counter() - wall_started

    async with alert_lock:
        alert_values = list(alert_latencies)
        alert_latencies.clear()

    if len(alert_values) != request_count:
        raise RuntimeError(
            "The synthetic high-risk scenario did not create exactly one alert per request."
        )

    risk_scores = [float(item["risk_score"]) for item in outcomes]
    return {
        "gemini_mode": mode,
        "concurrency": concurrency,
        "requests": request_count,
        "accepted": len(outcomes),
        "completed": len(outcomes),
        "failed": 0,
        "high_risk_alerts_created_by_stub": len(alert_values),
        "duration_seconds": round(wall_seconds, 3),
        "throughput_requests_per_second": round(request_count / wall_seconds, 3),
        "extrapolated_requests_per_day": round(request_count / wall_seconds * 86_400),
        "request_latency_ms": {
            "p50": percentile(request_latencies, 50),
            "p95": percentile(request_latencies, 95),
            "p99": percentile(request_latencies, 99),
            "max": round(max(request_latencies), 3),
        },
        "posting_to_stub_alert_creation_ms": {
            "p50": percentile(alert_values, 50),
            "p95": percentile(alert_values, 95),
            "p99": percentile(alert_values, 99),
            "max": round(max(alert_values), 3),
        },
        "risk_score_range": {
            "min": round(min(risk_scores), 2),
            "max": round(max(risk_scores), 2),
        },
        "all_responses_high_risk": all(
            item["risk_level"] == "HIGH" for item in outcomes
        ),
    }


async def run_benchmark(
    *,
    requests_per_scenario: int,
    concurrency_levels: list[int],
    warmup_requests: int,
) -> dict[str, Any]:
    from app.services.gemini_explanations import GeminiExplanationError

    starts: dict[str, int] = {}
    start_lock = threading.Lock()
    alert_latencies: list[float] = []
    alert_lock = asyncio.Lock()
    def fake_insert(_transaction: dict[str, Any]) -> None:
        return None

    def fake_context(ids: list[str]) -> dict[str, Any]:
        return {identifier: 1 for identifier in ids}

    def fake_splitting(ids: list[str]) -> dict[str, Any]:
        return {
            identifier: {
                "historical_transaction_count": 1,
                "window_total_amount": 2_000_000_000.0,
            }
            for identifier in ids
        }

    def fake_vendors(ids: list[str]) -> dict[str, Any]:
        return {
            identifier: {
                "registry_authoritative": True,
                "vendor_registered": False,
                "vendor_active": False,
            }
            for identifier in ids
        }

    def fake_evaluation(**_kwargs: Any) -> None:
        return None

    def fake_scores(rows: list[dict[str, Any]]) -> int:
        return len(rows)

    def fake_anomaly(rows: list[dict[str, Any]]) -> int:
        return len(rows)

    def fake_risk(rows: list[dict[str, Any]]) -> int:
        return len(rows)

    def fake_alert(
        *,
        transaction_id: str,
        risk_score: float,
        risk_scoring_version: str,
        request_received_at: datetime,
    ) -> dict[str, Any]:
        elapsed_ms = (time.perf_counter_ns() - starts[transaction_id]) / 1_000_000
        with alert_lock_sync:
            alert_latencies.append(elapsed_ms)
        return {
            "id": f"AL-{transaction_id}",
            "transaction_id": transaction_id,
            "created_at": request_received_at.isoformat(),
            "severity": "HIGH",
            "risk_score": risk_score,
            "risk_scoring_version": risk_scoring_version,
            "status": "ACTIVE",
        }

    alert_lock_sync = threading.Lock()

    transaction_api.insert_transaction = fake_insert
    transaction_api.get_duplicate_payment_counts = fake_context
    transaction_api.get_invoice_splitting_contexts = fake_splitting
    transaction_api.get_ghost_vendor_contexts = fake_vendors
    transaction_api.persist_transaction_evaluation = fake_evaluation
    transaction_api.persist_transaction_anomaly_scores = fake_anomaly
    transaction_api.persist_transaction_risk_scores = fake_risk
    transaction_api.persist_transaction_explanations = lambda rows: len(rows)
    transaction_api.create_high_risk_alert = fake_alert
    app.dependency_overrides[get_current_user] = lambda: {
        "id": "phase23-benchmark-user",
        "role": "ADMIN",
        "account_status": "ACTIVE",
    }
    logging.getLogger("app.api.transactions").setLevel(logging.CRITICAL)

    model = transaction_api._get_anomaly_model()
    model.estimator.set_params(n_jobs=1)
    modes = ("disabled", "stubbed")
    next_sequence = 0
    results: list[dict[str, Any]] = []
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=transport,
        base_url="http://phase23.local",
        timeout=60.0,
    ) as client:
        for mode in modes:
            if mode == "disabled":
                def no_gemini(**_kwargs: Any) -> str:
                    raise GeminiExplanationError("Gemini disabled for local benchmark.")
                transaction_api.generate_risk_explanation = no_gemini
            else:
                transaction_api.generate_risk_explanation = (
                    lambda **_kwargs: "Local benchmark explanation stub."
                )

            for index in range(warmup_requests):
                body = make_request_body(next_sequence)
                next_sequence += 1
                starts[body["id"]] = time.perf_counter_ns()
                response = await client.post("/api/v1/transactions", json=body)
                if response.status_code != 201:
                    raise RuntimeError("Warmup transaction failed.")
            async with alert_lock:
                alert_latencies.clear()

            for concurrency in concurrency_levels:
                scenario = await run_scenario(
                    client=client,
                    mode=mode,
                    concurrency=concurrency,
                    request_count=requests_per_scenario,
                    sequence_start=next_sequence,
                    starts=starts,
                    start_lock=start_lock,
                    alert_latencies=alert_latencies,
                    alert_lock=alert_lock,
                )
                next_sequence += requests_per_scenario
                results.append(scenario)

    app.dependency_overrides.pop(get_current_user, None)
    commit = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"],
        cwd=BACKEND_ROOT.parent,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    return {
        "run_utc": datetime.now(timezone.utc).isoformat(),
        "git_commit": commit,
        "python": platform.python_version(),
        "platform": platform.platform(),
        "cpu_count_logical": os.cpu_count(),
        "dependencies": {
            name: importlib.metadata.version(name)
            for name in ("fastapi", "httpx", "numpy", "scikit-learn", "starlette")
        },
        "isolation_forest_version": model.version,
        "isolation_forest_trees": model.estimator.n_estimators,
        "isolation_forest_n_jobs": model.estimator.n_jobs,
        "risk_scoring_version": transaction_api.RISK_SCORING_VERSION,
        "rule_scoring_version": transaction_api.RULE_SCORE_VERSION,
        "dataset": {
            "scope": "synthetic generated transactions; every row is a constructed five-rule high-risk case",
            "warmup_requests_per_mode_excluded": warmup_requests,
            "measured_requests": len(results) * requests_per_scenario,
        },
        "service_scope": {
            "api": "in-process FastAPI ASGI transport; no network listener",
            "persistence": "all Supabase transaction reads/writes and alert creation replaced with in-memory stubs",
            "gemini": "disabled failure path and deterministic local stub; no external requests",
            "websocket": "no connected clients; publication remains in-process and has no delivery-network cost",
            "live_data_or_services": False,
        },
        "scenarios": results,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--requests-per-scenario", type=int, default=1250)
    parser.add_argument("--concurrency", default="1,4,8,16")
    parser.add_argument("--warmup-requests", type=int, default=10)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    args.concurrency_levels = [
        int(value.strip()) for value in args.concurrency.split(",") if value.strip()
    ]
    if args.requests_per_scenario < 1 or args.warmup_requests < 0:
        parser.error("request counts must be positive and warmup cannot be negative")
    if not args.concurrency_levels or any(value < 1 for value in args.concurrency_levels):
        parser.error("concurrency values must be positive")
    return args


def main() -> None:
    args = parse_args()
    result = asyncio.run(
        run_benchmark(
            requests_per_scenario=args.requests_per_scenario,
            concurrency_levels=args.concurrency_levels,
            warmup_requests=args.warmup_requests,
        )
    )
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        output = args.output.resolve()
        if output.suffix.lower() != ".json":
            raise SystemExit("--output must use a .json extension")
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")


if __name__ == "__main__":
    main()
