"""Scoped feed auditing: verified references, exact rules and explicit model eligibility."""
import asyncio
from datetime import datetime, timedelta
from decimal import Decimal, InvalidOperation
from functools import lru_cache
import hashlib
import logging
import math
import os
from pathlib import Path
from typing import Any, Literal

from pydantic import Field, ValidationError, model_validator
from starlette.concurrency import run_in_threadpool

from app.repositories import ingestion as repository
from app.repositories.supabase_transactions import SupabaseConfigurationError, SupabasePersistenceError
from app.services.ingestion_mapping import StrictModel
from app.services.audit_rules import evaluate_transaction_rules, calculate_rule_score, summarize_rule_status
from app.services.risk_scoring import calculate_risk_score, classify_risk_level
from app.services.feed_worker_wakeup import listen, wait

ENGINE_VERSION = "feed-audit-1.1.0"
logger = logging.getLogger(__name__)


def instant(value: str | None) -> datetime | None:
    if value is None:
        return None
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Explicit reference timezone required")
    return parsed


class EffectiveReference(StrictModel):
    reference: str = Field(min_length=5, max_length=200)
    valid_from: str
    valid_to: str | None = None

    @model_validator(mode="after")
    def valid_window(self):
        start, end = instant(self.valid_from), instant(self.valid_to)
        if end is not None and end <= start:
            raise ValueError("Invalid effective window")
        return self

    def covers(self, point: datetime | None, start: datetime | None = None) -> bool:
        return (point is not None and instant(self.valid_from) <= (start or point)
                and (self.valid_to is None or point < instant(self.valid_to)))


class HistoryReference(EffectiveReference):
    authoritative: bool
    vendor_namespace: str = Field(min_length=1, max_length=128)


class ApprovalPolicy(EffectiveReference):
    approver_id: str = Field(min_length=1, max_length=50)
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    limit: str = Field(pattern=r"^[0-9]{1,20}(?:\.[0-9]{1,18})?$")


class VendorEntry(StrictModel):
    id: str = Field(min_length=1, max_length=50)
    active: bool


class VendorRegistry(EffectiveReference):
    authoritative: bool
    vendor_namespace: str = Field(min_length=1, max_length=128)
    entries: list[VendorEntry] = Field(max_length=10000)

    @model_validator(mode="after")
    def unique_ids(self):
        if len({item.id for item in self.entries}) != len(self.entries):
            raise ValueError("Ambiguous vendor identities")
        return self


class ModelApproval(StrictModel):
    model_version: Literal["1.0.0"]
    feature_version: Literal["1.0.0"]
    artifact_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    validation_reference: str = Field(min_length=10, max_length=200)
    population_reference: str = Field(min_length=5, max_length=200)
    supported_currencies: list[str] = Field(min_length=1, max_length=64)

    @model_validator(mode="after")
    def currencies(self):
        if any(len(value) != 3 or not value.isascii() or not value.isupper() or not value.isalpha()
               for value in self.supported_currencies):
            raise ValueError("Invalid model currency declaration")
        return self


class SimulationNameWindow(StrictModel):
    scenario_version: Literal["payments-name-window-1.0.0"]
    threshold: Literal["10000.00"]
    currency: Literal["USD"]
    grouping_path: list[str] = Field(min_length=2, max_length=2)

    @model_validator(mode="after")
    def explicit_source_name_path(self):
        if self.grouping_path != ["source", "VENDOR NAME"]:
            raise ValueError("Unapproved simulation name path")
        return self


class AuditContext(StrictModel):
    schema_version: Literal["1.0"] = "1.0"
    time_basis: Literal["BUSINESS_EVENT_TIME", "SIMULATED_ARRIVAL_TIME"] = "BUSINESS_EVENT_TIME"
    actor_namespace: str | None = Field(default=None, min_length=1, max_length=128)
    actor_case_insensitive: bool = False
    history: HistoryReference | None = None
    approval_policies: list[ApprovalPolicy] = Field(default_factory=list, max_length=10000)
    vendor_registry: VendorRegistry | None = None
    model_approval: ModelApproval | None = None
    simulation_splitting: SimulationNameWindow | None = None
    simulation_history_wait_seconds: int = Field(default=0, ge=0, le=30, strict=True)
    invoice_splitting_mode: Literal["ALL_PAYMENTS", "SUBTHRESHOLD_PAYMENTS"] = "ALL_PAYMENTS"

    @model_validator(mode="after")
    def simulation_clock_required(self):
        if self.simulation_splitting is not None and self.time_basis != "SIMULATED_ARRIVAL_TIME":
            raise ValueError("Name-window scenario requires explicit simulation clock")
        if self.simulation_history_wait_seconds and (self.simulation_splitting is None or self.time_basis != "SIMULATED_ARRIVAL_TIME"):
            raise ValueError("History readiness wait requires the explicit simulation scenario")
        return self


class ModelUnavailable(RuntimeError):
    pass


@lru_cache(maxsize=4)
def approved_model(artifact_sha256: str):
    # Fixed trusted deployment artifact; source configuration never supplies a file path.
    from app.services.anomaly_model import load_anomaly_model
    path = Path(__file__).resolve().parents[2] / "models" / "isolation_forest_v1.joblib"
    try:
        if hashlib.sha256(path.read_bytes()).hexdigest() != artifact_sha256:
            raise ModelUnavailable("Model artifact differs from reviewed approval")
        model = load_anomaly_model(path)
        if model.version != "1.0.0":
            raise ModelUnavailable("Model version differs from approval")
        return model
    except (OSError, ValueError, TypeError) as exc:
        raise ModelUnavailable("Approved model unavailable") from exc


def decimal_value(value: Any) -> Decimal | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("Canonical decimal must be a string")
    parsed = Decimal(value)
    if not parsed.is_finite() or parsed < 0:
        raise ValueError("Invalid canonical decimal")
    return parsed


def build_bundle(job: dict[str, Any], *, allow_model: bool = False, model_loader=approved_model) -> dict[str, Any]:
    snapshot = job["snapshot"]
    context = AuditContext.model_validate(snapshot["configuration"]) if snapshot["configuration"] is not None else AuditContext()
    transaction = dict(job["canonical"])
    transaction["amount"] = decimal_value(transaction.get("amount"))
    transaction["approval_limit"] = None  # Producer-supplied limit never establishes authority.
    simulated = context.time_basis == "SIMULATED_ARRIVAL_TIME"
    simulation_indicator = None
    if context.simulation_splitting is not None:
        simulation_indicator = snapshot.get("simulation_name_window")
        if (not isinstance(simulation_indicator, dict)
                or simulation_indicator.get("scenario_version") != context.simulation_splitting.scenario_version
                or simulation_indicator.get("threshold") != context.simulation_splitting.threshold
                or simulation_indicator.get("time_basis") != "SIMULATED_ARRIVAL_TIME"):
            raise ValueError("Pinned simulation name-window snapshot required")
    # Operator-selected simulation clock, pinned by the SQL snapshot. Never modify canonical time.
    if simulated and snapshot.get("time_basis") != "SIMULATED_ARRIVAL_TIME":
        raise ValueError("Simulation clock snapshot required")
    point = instant(snapshot.get("evaluation_time")) if simulated else instant(transaction.get("timestamp"))
    identities = job["identity_context"]
    history = snapshot["history"]
    gates: dict[str, list[str]] = {name: [] for name in (
        "segregation_of_duties", "approval_limits", "duplicate_payment", "invoice_splitting", "ghost_vendors")}
    actor_verified = bool(context.actor_namespace and context.actor_namespace == identities.get("actor_namespace"))
    if not actor_verified or not context.actor_case_insensitive:
        gates["segregation_of_duties"].append("ACTOR_COMPARISON_NOT_VERIFIED")
    for field in ("created_by", "approved_by"):
        if not transaction.get(field):
            gates["segregation_of_duties"].append("ACTOR_IDENTITY_MISSING")
    policies = [policy for policy in context.approval_policies if actor_verified and transaction.get("approved_by")
                and (policy.approver_id.casefold() == transaction["approved_by"].casefold()
                     if context.actor_case_insensitive else policy.approver_id == transaction["approved_by"])
                and policy.currency == transaction.get("currency") and policy.covers(point)]
    if len(policies) == 1:
        transaction["approval_limit"] = Decimal(policies[0].limit)
    else:
        for rule in ("approval_limits", "invoice_splitting"):
            gates[rule].append("APPROVAL_POLICY_AMBIGUOUS" if len(policies) > 1 else "APPROVAL_POLICY_UNAVAILABLE")
    for rule in ("approval_limits", "duplicate_payment", "invoice_splitting"):
        if transaction["amount"] is None or not transaction.get("currency"):
            gates[rule].append("MONETARY_FIELDS_MISSING")
    vendor_namespace = identities.get("vendor_namespace")
    for rule in ("duplicate_payment", "invoice_splitting", "ghost_vendors"):
        if not transaction.get("vendor_id") or not vendor_namespace:
            gates[rule].append("VENDOR_IDENTITY_UNRESOLVED")
    if not transaction.get("invoice_number"):
        gates["duplicate_payment"].append("INVOICE_REFERENCE_MISSING")
    if point is None:
        for rule in ("duplicate_payment", "invoice_splitting", "ghost_vendors"):
            gates[rule].append("PRECISE_EVENT_TIME_MISSING")
    reference = context.history
    history_verified = bool(reference and reference.authoritative and reference.vendor_namespace == vendor_namespace)
    for rule in ("duplicate_payment", "invoice_splitting"):
        try:
            start = point - timedelta(hours=24) if point and rule == "invoice_splitting" else point
        except OverflowError:
            start = None
            gates[rule].append("TIME_WINDOW_UNSUPPORTED")
        if not history_verified or not reference.covers(point, start):
            gates[rule].append("HISTORY_COVERAGE_UNAVAILABLE")
        incomplete_key = "incomplete_duplicate_count" if rule == "duplicate_payment" else "incomplete_window_count"
        if history.get("unprepared_prior_count", 0) or history.get(incomplete_key, 0):
            gates[rule].append("HISTORY_INCOMPLETE")
    if transaction["approval_limit"] is not None and transaction["approval_limit"] <= 0:
        gates["invoice_splitting"].append("POSITIVE_APPROVAL_LIMIT_REQUIRED")
    rule_context: dict[str, Any] = {}
    if not gates["duplicate_payment"]:
        rule_context["duplicate_payment_count"] = history["duplicate_payment_count"]
    if not gates["invoice_splitting"]:
        selected_history = history.get("subthreshold_invoice_splitting_context") if context.invoice_splitting_mode == "SUBTHRESHOLD_PAYMENTS" else history.get("invoice_splitting_context")
        if selected_history is None:
            gates["invoice_splitting"].append("SUBTHRESHOLD_HISTORY_UNAVAILABLE")
        else:
            splitting = dict(selected_history)
            splitting["window_total_amount"] = decimal_value(splitting["window_total_amount"])
            rule_context["invoice_splitting_context"] = splitting
    rule_context["invoice_splitting_mode"] = context.invoice_splitting_mode
    registry = context.vendor_registry
    if (not registry or not registry.authoritative or registry.vendor_namespace != vendor_namespace
            or not registry.covers(point)):
        gates["ghost_vendors"].append("AUTHORITATIVE_VENDOR_REGISTRY_UNAVAILABLE")
    if not gates["ghost_vendors"]:
        entry = next((entry for entry in registry.entries if entry.id == transaction["vendor_id"]), None)
        rule_context["ghost_vendor_context"] = {"registry_authoritative": True,
            "vendor_registered": entry is not None,"vendor_active": entry.active if entry else False}
    rule_transaction = dict(transaction)
    if simulated:
        rule_transaction["timestamp"] = point.isoformat() if point else None
    results = evaluate_transaction_rules(rule_transaction, context=rule_context)
    for result in results:
        if gates[result["rule_key"]]:
            result.update(status="NOT_EVALUATED", score_contribution=None,
                          detail="Required source semantics or verified reference context are unavailable.")
            result["evidence"]["eligible"] = False
        result["evidence"].update(gate_reasons=list(dict.fromkeys(gates[result["rule_key"]])),
            context_version=job["context_version"], history_cutoff=history.get("arrival_cutoff"),
            time_basis=context.time_basis, evaluation_time=point.isoformat() if point else None,
            historical_business_time=job["canonical"].get("timestamp"),
            historical_source_date=job["canonical"].get("source_date"))
        if simulated:
            result["detail"] = "Simulation arrival-time evaluation only. " + result["detail"]
    rule_score = calculate_rule_score(results)
    evaluated = sum(result["status"] in {"PASSED", "FAILED"} for result in results)
    failed = sum(result["status"] == "FAILED" for result in results)
    coverage = {"total": 5, "evaluated": evaluated, "failed": failed, "not_evaluated": 5-evaluated}
    approval = context.model_approval
    missing_features = [field for field in ("amount", "currency", "timestamp", "category", "approver_role",
                                           "created_by", "approved_by") if transaction.get(field) is None]
    reason = ("MODEL_SIMULATION_CLOCK_NOT_APPROVED" if simulated else "MODEL_SOURCE_NOT_APPROVED" if approval is None else "MODEL_RULE_VERSION_NOT_APPROVED" if context.invoice_splitting_mode == "SUBTHRESHOLD_PAYMENTS" else "MODEL_SCORING_DISABLED" if not allow_model
              else "MODEL_CURRENCY_UNSUPPORTED" if transaction.get("currency") not in approval.supported_currencies
              else "MODEL_CONTEXT_INCOMPLETE" if evaluated != 5 else "MODEL_FEATURES_MISSING" if missing_features else None)
    ai_score = None
    anomaly = {"status": "NOT_EVALUATED", "reason": reason, "model_version": None}
    if reason is None:
        from app.services.anomaly_features import build_anomaly_features
        model = model_loader(approval.artifact_sha256)
        if model.version != approval.model_version:
            raise ModelUnavailable("Approved model version mismatch")
        features_input = dict(transaction)
        features_input.update(amount=float(transaction["amount"]), approval_limit=float(transaction["approval_limit"]))
        features_context = dict(rule_context)
        features_context["invoice_splitting_context"] = dict(rule_context["invoice_splitting_context"])
        features_context["invoice_splitting_context"]["window_total_amount"] = float(
            rule_context["invoice_splitting_context"]["window_total_amount"])
        scores = model.score([build_anomaly_features(features_input, context=features_context)])
        if (len(scores) != 1 or isinstance(scores[0], bool) or not isinstance(scores[0], (float, int))
                or not math.isfinite(scores[0]) or not 0 <= scores[0] <= 100):
            raise ModelUnavailable("Approved model returned invalid score")
        ai_score = scores[0]
        anomaly = {"status": "SCORED", "reason": None, "model_version": model.version,
                   "artifact_sha256": approval.artifact_sha256, "validation_reference": approval.validation_reference,
                   "population_reference": approval.population_reference}
    risk = calculate_risk_score(rule_score, ai_score)
    observation = None
    if simulated:
        prior = history.get("arrival_window_count")
        if isinstance(prior, bool) or not isinstance(prior, int) or prior < 0 or point is None:
            raise ValueError("Simulation arrival window missing")
        incomplete = bool(history.get("unprepared_prior_count", 0))
        count = prior + 1 if transaction.get("currency") else None
        observation = {"time_basis": context.time_basis, "scope": "SOURCE_ORGANIZATION_AND_CURRENCY",
            "currency": transaction.get("currency"), "window_hours": 24, "window_end": point.isoformat(),
            "window_start": (point-timedelta(hours=24)).isoformat(), "includes_current": True,
            "observed_transactions": count, "history_complete": not incomplete,
            "two_or_more_observed": (True if count is not None and count >= 2 else None if incomplete or count is None else False),
            "meaning": "Arrival of distinct retained records in simulation; not historical payment timing or same-vendor fraud evidence"}
    return {"transaction_id": job["transaction_id"], "engine_version": ENGINE_VERSION,
            "time_basis": context.time_basis, "evaluation_time": point.isoformat() if point else None,
            "temporal_observation": observation,
            "simulation_indicator": simulation_indicator,
            "rule_results": results, "rule_score": rule_score, "rule_status": summarize_rule_status(results),
            "coverage": coverage, "audit_status": "NOT_EVALUATED" if evaluated == 0 else "PARTIAL" if evaluated < 5
                else "REVIEW" if failed else "PASSED",
            "authority_reference": policies[0].reference if len(policies) == 1 else None,
            "verified_approval_limit": str(transaction["approval_limit"]) if transaction["approval_limit"] is not None else None,
            "approval_currency": transaction.get("currency") if transaction["approval_limit"] is not None else None,
            "vendor_reference": registry.reference if registry and not gates["ghost_vendors"] else None,
            "history_reference": reference.reference if history_verified else None,
            "context_version": job["context_version"], "ai_score": ai_score,"anomaly": anomaly,
            "risk_score": risk,"risk_level": classify_risk_level(risk)}


def enabled() -> bool:
    return all(os.getenv(key,"false").lower()=="true" for key in ("INGESTION_ENABLED","INGESTION_AUDIT_ENABLED"))


async def audit_once(limit: int = 25) -> int:
    if not enabled():
        return 0
    await run_in_threadpool(repository.rpc,"prepare_feed_audits",{"p_limit": max(1,min(limit,25))})
    completed = 0
    for _ in range(max(0,min(limit,25))):
        job = await run_in_threadpool(repository.rpc,"claim_feed_audit",{})
        if job is None:
            break
        if not isinstance(job,dict):
            raise SupabasePersistenceError("Invalid feed audit claim")
        if job.get("blocked"):
            continue
        if not all(key in job for key in ("transaction_id","lease_token","snapshot","context_version","canonical","identity_context")):
            raise SupabasePersistenceError("Invalid feed audit claim")
        code = None
        try:
            if job["snapshot"] is None:
                code = "AUDIT_CONTEXT_MISSING"
            else:
                bundle = await run_in_threadpool(build_bundle,job,
                    allow_model=os.getenv("INGESTION_FEED_ANOMALY_ENABLED","false").lower()=="true")
                saved = await run_in_threadpool(repository.rpc,"finish_feed_audit",{
                    "p_transaction_id":job["transaction_id"],"p_lease_token":job["lease_token"],"p_bundle":bundle})
                if saved is True:
                    completed += 1
                else:
                    code = "AUDIT_UNAVAILABLE"
        except ValidationError:
            code = "AUDIT_CONTEXT_INVALID"
        except ModelUnavailable:
            code = "MODEL_UNAVAILABLE"
        except (SupabaseConfigurationError,SupabasePersistenceError,ValueError,OverflowError,InvalidOperation,TypeError,KeyError):
            code = "AUDIT_UNAVAILABLE"
        if code:
            await run_in_threadpool(repository.rpc,"release_feed_audit",{
                "p_transaction_id":job["transaction_id"],"p_lease_token":job["lease_token"],"p_code":code})
    return completed


async def audit_loop():
    with listen("audit") as wake:
        while enabled():
            wake.clear()
            try:
                completed = await audit_once()
            except (SupabaseConfigurationError,SupabasePersistenceError):
                logger.warning("Scoped feed audit storage unavailable; jobs remain recoverable.")
                await asyncio.sleep(2)
                continue
            if completed == 25:
                await asyncio.sleep(0)
            else:
                await wait(wake)
