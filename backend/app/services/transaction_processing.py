from __future__ import annotations

import asyncio
import logging
import os
from functools import lru_cache
from pathlib import Path
from typing import Any

from fastapi.encoders import jsonable_encoder
from starlette.concurrency import run_in_threadpool

from app.repositories import transaction_processing as jobs
from app.repositories.supabase_transactions import (
    SupabaseConfigurationError, SupabasePersistenceError,
    get_duplicate_payment_counts, get_invoice_splitting_contexts,
    get_ghost_vendor_contexts, persist_transaction_explanations,
)
from app.services.alert_stream import alert_manager
from app.services.anomaly_features import build_anomaly_features
from app.services.anomaly_model import load_anomaly_model
from app.services.audit_rules import (
    RULE_SCORE_VERSION, evaluate_transaction_rules, calculate_rule_score, summarize_rule_status,
)
from app.services.gemini_explanations import (
    GEMINI_PROMPT_VERSION, GeminiExplanationError, generate_risk_explanation, get_gemini_model_name,
)
from app.services.risk_scoring import RISK_SCORING_VERSION, calculate_risk_score, classify_risk_level

logger = logging.getLogger(__name__)


def enabled() -> bool:
    return os.getenv("TRANSACTION_RECOVERY_ENABLED", "false").lower() == "true"


@lru_cache(maxsize=1)
def get_model():
    return load_anomaly_model(Path(__file__).resolve().parents[2] / "models/isolation_forest_v1.joblib")


def build_bundle(transaction: dict[str, Any]) -> dict[str, Any]:
    identifier = transaction["id"]
    # Context failures remain retryable; missing source fields remain ineligible.
    duplicate = get_duplicate_payment_counts([identifier])
    splitting = get_invoice_splitting_contexts([identifier])
    vendors = get_ghost_vendor_contexts([identifier])
    if any(identifier not in values for values in (duplicate, splitting, vendors)):
        raise SupabasePersistenceError("Rule context is unavailable; processing will retry.")
    context = {"duplicate_payment_count": duplicate[identifier],
               "invoice_splitting_context": splitting[identifier],
               "ghost_vendor_context": vendors[identifier]}
    rules = evaluate_transaction_rules(transaction, context=context)
    rule_score = calculate_rule_score(rules)
    model = get_model()
    ai_score = model.score([build_anomaly_features(transaction, context=context)])[0]
    risk = calculate_risk_score(rule_score, ai_score)
    result = {**transaction, "vendor_monitoring_status": None,
              "rule_status": summarize_rule_status(rules), "rule_score": rule_score,
              "rule_results": rules, "ai_score": ai_score, "risk_score": risk,
              "risk_level": classify_risk_level(risk), "explanation": None,
              "processing_status": "COMPLETED"}
    result.pop("metadata", None)
    return {"result": jsonable_encoder(result), "rule_version": RULE_SCORE_VERSION,
            "model_version": model.version, "risk_version": RISK_SCORING_VERSION,
            "anomaly": {"threshold": model.threshold, "is_anomalous": model.is_anomalous(ai_score)}}


async def publish_event(job: dict[str, Any]) -> None:
    if job.get("event_pending") and job.get("alert_event"):
        # Publication attempts are at least once; offline clients need REST.
        await alert_manager.publish_created(job["alert_event"])
        await run_in_threadpool(jobs.acknowledge_event, job["transaction_id"])


async def process_job(transaction_id: str) -> dict[str, Any] | None:
    job = await run_in_threadpool(jobs.rpc, "claim_transaction_job", {"p_id": transaction_id})
    if job is None:
        return None
    if not isinstance(job, dict) or job.get("transaction_id") != transaction_id:
        raise SupabasePersistenceError("Invalid durable processing job.")
    if job["status"] != "COMPLETED":
        token = job["lease_token"]
        try:
            bundle = await run_in_threadpool(build_bundle, job["input"])
            job = await run_in_threadpool(jobs.rpc, "finish_transaction_job",
                {"p_id": transaction_id, "p_token": token, "p_bundle": bundle})
        except Exception:
            try:
                await run_in_threadpool(jobs.rpc, "release_transaction_job",
                                       {"p_id": transaction_id, "p_token": token})
            except (SupabaseConfigurationError, SupabasePersistenceError):
                pass
            raise
    if not isinstance(job.get("result"), dict):
        raise SupabasePersistenceError("Invalid completed transaction result.")
    try:
        await publish_event(job)
    except Exception:
        logger.warning("Alert publication pending; durable outbox will retry.")
    return dict(job["result"])


async def attach_explanation(result: dict[str, Any]) -> dict[str, Any]:
    if result.get("risk_score") is None:
        return result
    try:
        explanation = await run_in_threadpool(generate_risk_explanation,
            transaction=result, rule_results=result["rule_results"], rule_score=result["rule_score"],
            ai_score=result["ai_score"], risk_score=result["risk_score"], risk_level=result["risk_level"])
        await run_in_threadpool(persist_transaction_explanations, [{
            "transaction_id": result["id"], "model_name": get_gemini_model_name(),
            "prompt_version": GEMINI_PROMPT_VERSION, "rule_evaluation_version": RULE_SCORE_VERSION,
            "anomaly_model_version": get_model().version, "risk_scoring_version": RISK_SCORING_VERSION,
            "explanation": explanation,
        }])
        result["explanation"] = explanation
    except (GeminiExplanationError, SupabaseConfigurationError, SupabasePersistenceError):
        logger.warning("Advisory explanation unavailable; authoritative bundle is committed.")
    return result


async def recover_once() -> None:
    for row in await run_in_threadpool(jobs.list_jobs):
        try:
            await process_job(row["transaction_id"])
        except Exception:
            logger.warning("Durable transaction remains retryable.")
    for row in await run_in_threadpool(jobs.list_jobs, events=True):
        try:
            await publish_event({**row, "event_pending": True})
        except Exception:
            logger.warning("Durable alert event remains pending.")


async def recovery_loop() -> None:
    while True:
        try:
            await recover_once()
        except Exception:
            logger.warning("Recovery store unavailable; retrying later.")
        await asyncio.sleep(10)
