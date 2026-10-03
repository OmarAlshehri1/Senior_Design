import logging

from fastapi import APIRouter, HTTPException, Query, status
from starlette.concurrency import run_in_threadpool
from typing import Literal

from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path

from app.repositories.supabase_alerts import create_high_risk_alert
from app.repositories.supabase_transactions import (
    SupabaseConfigurationError,
    SupabasePersistenceError,
    get_transaction_by_id,
    list_transactions,
    insert_transaction,
    TransactionAlreadyExistsError,
    persist_transaction_evaluation,
    get_duplicate_payment_counts,
    get_invoice_splitting_contexts,
    get_ghost_vendor_contexts,
    persist_transaction_anomaly_scores,
    persist_transaction_risk_scores,
    persist_transaction_explanations,
)
from app.schemas.transaction import TransactionCreate

from app.services.audit_rules import (
    calculate_rule_score,
    RULE_SCORE_VERSION,
    evaluate_transaction_rules,
    summarize_rule_status,
)

from app.services.anomaly_features import (
    build_anomaly_features,
)
from app.services.anomaly_model import (
    AnomalyScoringModel,
    load_anomaly_model,
)

from app.services.alert_stream import alert_manager
from app.services.gemini_explanations import (
    GEMINI_PROMPT_VERSION,
    GeminiExplanationError,
    generate_risk_explanation,
    get_gemini_model_name,
)
from app.services.risk_scoring import (
    RISK_SCORING_VERSION,
    calculate_risk_score,
    classify_risk_level,
)

logger = logging.getLogger(__name__)


ANOMALY_MODEL_PATH = (
    Path(__file__).resolve().parents[2]
    / "models"
    / "isolation_forest_v1.joblib"
)


@lru_cache(maxsize=1)
def _get_anomaly_model() -> AnomalyScoringModel:
    return load_anomaly_model(ANOMALY_MODEL_PATH)


router = APIRouter(
    prefix="/transactions",
    tags=["transactions"],
)


@router.get("")
async def get_transactions(
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=25, ge=1, le=100),
    search: str | None = Query(default=None, max_length=100),
    sort_by: Literal[
        "newest",
        "oldest",
        "highest-amount",
        "lowest-amount",
    ] = Query(default="newest"),
) -> dict[str, object]:
    try:
        transactions, total = await run_in_threadpool(
            list_transactions,
            page=page,
            page_size=page_size,
            search=search,
            sort_by=sort_by,
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transaction storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transactions could not be retrieved.",
        ) from exc

    return {
        "items": transactions,
        "total": total,
        "page": page,
        "page_size": page_size,
    }


@router.get("/{transaction_id}")
async def get_transaction(
    transaction_id: str,
) -> dict[str, object]:
    try:
        transaction = await run_in_threadpool(
            get_transaction_by_id,
            transaction_id,
        )
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transaction storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transaction could not be retrieved.",
        ) from exc

    if transaction is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Transaction not found.",
        )

    return transaction


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_transaction(
    transaction: TransactionCreate,
) -> dict[str, object]:
    request_received_at = datetime.now(timezone.utc)
    transaction_data = transaction.model_dump(mode="python")

    transaction_data["amount"] = (
        float(transaction.amount)
        if transaction.amount is not None
        else None
    )
    transaction_data["approval_limit"] = (
        float(transaction.approval_limit)
        if transaction.approval_limit is not None
        else None
    )

    missing_fields = [
        field_name
        for field_name, value in transaction_data.items()
        if value is None
    ]

    data_quality_status = (
        "COMPLETE"
        if not missing_fields
        else "PARTIAL"
    )

    storage_transaction = {
        **transaction_data,
        "data_quality_status": data_quality_status,
        "missing_fields": missing_fields,
        "metadata": {},
    }

    try:
        await run_in_threadpool(
            insert_transaction,
            storage_transaction,
        )
    except TransactionAlreadyExistsError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Transaction ID already exists.",
        ) from exc
    except SupabaseConfigurationError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Transaction storage is not configured.",
        ) from exc
    except SupabasePersistenceError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transaction could not be stored.",
        ) from exc

    try:
        duplicate_counts = await run_in_threadpool(
            get_duplicate_payment_counts,
            [transaction_data["id"]],
        )
    except (
        SupabaseConfigurationError,
        SupabasePersistenceError,
    ):
        duplicate_counts = {}

    try:
        invoice_splitting_contexts = (
            await run_in_threadpool(
                get_invoice_splitting_contexts,
                [transaction_data["id"]],
            )
        )
    except (
        SupabaseConfigurationError,
        SupabasePersistenceError,
    ):
        invoice_splitting_contexts = {}

    try:
        ghost_vendor_contexts = await run_in_threadpool(
            get_ghost_vendor_contexts,
            [transaction_data["id"]],
        )
    except (
        SupabaseConfigurationError,
        SupabasePersistenceError,
    ):
        ghost_vendor_contexts = {}

    rule_results = evaluate_transaction_rules(
        transaction_data,
        context={
            "duplicate_payment_count": (
                duplicate_counts.get(
                    transaction_data["id"]
                )
            ),
            "invoice_splitting_context": (
                invoice_splitting_contexts.get(transaction_data["id"])
            ),
            "ghost_vendor_context": (
                ghost_vendor_contexts.get(transaction_data["id"])
            ),
        },
    )

    rule_score = calculate_rule_score(rule_results)
    rule_status = summarize_rule_status(rule_results)

    anomaly_context = {
        "duplicate_payment_count": (
            duplicate_counts.get(transaction_data["id"])
        ),
        "invoice_splitting_context": (
            invoice_splitting_contexts.get(
                transaction_data["id"]
            )
        ),
        "ghost_vendor_context": (
            ghost_vendor_contexts.get(
                transaction_data["id"]
            )
        ),
    }

    anomaly_features = build_anomaly_features(
        transaction_data,
        context=anomaly_context,
    )

    try:
        anomaly_model = await run_in_threadpool(
            _get_anomaly_model
        )
        ai_scores = await run_in_threadpool(
            anomaly_model.score,
            [anomaly_features],
        )
        ai_score = ai_scores[0]
    except (OSError, ValueError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Anomaly scoring model is unavailable.",
        ) from exc

    risk_score = calculate_risk_score(
        rule_score,
        ai_score,
    )
    risk_level = classify_risk_level(
        risk_score
    )

    try:
        await run_in_threadpool(
            persist_transaction_evaluation,
            transaction_id=transaction_data["id"],
            evaluation_version=RULE_SCORE_VERSION,
            rule_status=rule_status,
            rule_score=rule_score,
            rule_results=rule_results,
        )
    except (
        SupabaseConfigurationError,
        SupabasePersistenceError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transaction evaluation could not be stored.",
        ) from exc

    try:
        await run_in_threadpool(
            persist_transaction_anomaly_scores,
            [
                {
                    "transaction_id": transaction_data["id"],
                    "model_version": anomaly_model.version,
                    "ai_score": ai_score,
                    "threshold": anomaly_model.threshold,
                    "is_anomalous": (
                        anomaly_model.is_anomalous(ai_score)
                    ),
                }
            ],
        )
    except (
        SupabaseConfigurationError,
        SupabasePersistenceError,
    ) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Transaction anomaly score could not be stored.",
        ) from exc

    if (
    risk_score is not None
    and risk_level is not None
):
        try:
            await run_in_threadpool(
                persist_transaction_risk_scores,
                [
                    {
                        "transaction_id": (
                            transaction_data["id"]
                        ),
                        "scoring_version": (
                            RISK_SCORING_VERSION
                        ),
                        "rule_evaluation_version": (
                            RULE_SCORE_VERSION
                        ),
                        "anomaly_model_version": (
                            anomaly_model.version
                        ),
                        "rule_score": rule_score,
                        "ai_score": ai_score,
                        "risk_score": risk_score,
                        "risk_level": risk_level,
                    }
                ],
            )
        except (
            SupabaseConfigurationError,
            SupabasePersistenceError,
        ) as exc:
            raise HTTPException(
                status_code=(
                    status.HTTP_502_BAD_GATEWAY
                ),
                detail=(
                    "Transaction risk score "
                    "could not be stored."
                ),
            ) from exc

    if risk_level == "HIGH" and risk_score is not None:
        try:
            alert = await run_in_threadpool(
                create_high_risk_alert,
                transaction_id=transaction_data["id"],
                risk_score=risk_score,
                risk_scoring_version=RISK_SCORING_VERSION,
                request_received_at=request_received_at,
            )
        except (
            SupabaseConfigurationError,
            SupabasePersistenceError,
        ) as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Transaction alert could not be created.",
            ) from exc

        await alert_manager.publish_created(alert)

    explanation: str | None = None

    if (
        rule_score is not None
        and risk_score is not None
        and risk_level is not None
    ):
        try:
            explanation = await run_in_threadpool(
                generate_risk_explanation,
                transaction={
                    **transaction_data,
                    "data_quality_status": data_quality_status,
                    "missing_fields": missing_fields,
                },
                rule_results=rule_results,
                rule_score=rule_score,
                ai_score=ai_score,
                risk_score=risk_score,
                risk_level=risk_level,
            )

            await run_in_threadpool(
                persist_transaction_explanations,
                [
                    {
                        "transaction_id": transaction_data["id"],
                        "model_name": get_gemini_model_name(),
                        "prompt_version": GEMINI_PROMPT_VERSION,
                        "rule_evaluation_version": RULE_SCORE_VERSION,
                        "anomaly_model_version": anomaly_model.version,
                        "risk_scoring_version": RISK_SCORING_VERSION,
                        "explanation": explanation,
                    }
                ],
            )
        except (
            GeminiExplanationError,
            SupabaseConfigurationError,
            SupabasePersistenceError,
        ) as exc:
            logger.warning(
                (
                    "Transaction explanation unavailable "
                    "for %s (%s): %s"
                ),
                transaction_data["id"],
                type(exc).__name__,
                str(exc),
            )
            explanation = None

    return {
        **transaction_data,
        "vendor_monitoring_status": None,
        "data_quality_status": data_quality_status,
        "missing_fields": missing_fields,
        "rule_status": rule_status,
        "rule_score": rule_score,
        "ai_score": ai_score,
        "risk_score": risk_score,
        "risk_level": risk_level,
        "rule_results": rule_results,
        "explanation": explanation,
    }
