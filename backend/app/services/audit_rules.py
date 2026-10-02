from __future__ import annotations

from decimal import Decimal
from typing import Any, Callable

from app.services.rule_eligibility import (
    evaluate_rule_eligibility,
)


RuleEvaluation = tuple[
    str,
    str,
    dict[str, Any],
]

RuleEvaluator = Callable[
    [
        dict[str, Any],
        dict[str, Any],
    ],
    RuleEvaluation,
]


RULE_VERSIONS = {
    "segregation_of_duties": "1.0.0",
    "approval_limits": "1.0.0",
    "duplicate_payment": "1.0.0",
    "invoice_splitting": "1.0.0",
    "ghost_vendors": "1.0.0",
}


def _normalize_actor(value: Any) -> str:
    return str(value).strip().casefold()


def _evaluate_segregation_of_duties(
    transaction: dict[str, Any],
    _context: dict[str, Any],
) -> RuleEvaluation:
    same_actor = (
        _normalize_actor(transaction["created_by"])
        == _normalize_actor(transaction["approved_by"])
    )

    if same_actor:
        return (
            "FAILED",
            (
                "The transaction creator and approver "
                "are the same actor."
            ),
            {
                "same_actor": True,
            },
        )

    return (
        "PASSED",
        (
            "The transaction creator and approver "
            "are different actors."
        ),
        {
            "same_actor": False,
        },
    )


def _evaluate_approval_limits(
    transaction: dict[str, Any],
    _context: dict[str, Any],
) -> RuleEvaluation:
    amount = Decimal(str(transaction["amount"]))
    approval_limit = Decimal(
        str(transaction["approval_limit"])
    )
    exceeds_limit = amount > approval_limit

    if exceeds_limit:
        return (
            "FAILED",
            "The transaction amount exceeds the approval limit.",
            {
                "amount_exceeds_limit": True,
                "excess_amount": float(
                    amount - approval_limit
                ),
            },
        )

    return (
        "PASSED",
        (
            "The transaction amount is within "
            "the approval limit."
        ),
        {
            "amount_exceeds_limit": False,
            "excess_amount": 0.0,
        },
    )


def _evaluate_duplicate_payment(
    _transaction: dict[str, Any],
    context: dict[str, Any],
) -> RuleEvaluation:
    matching_count = context.get(
        "duplicate_payment_count"
    )

    if (
        isinstance(matching_count, bool)
        or not isinstance(matching_count, int)
        or matching_count < 0
    ):
        return (
            "NOT_EVALUATED",
            (
                "Duplicate-payment history was not "
                "available for evaluation."
            ),
            {
                "historical_context_available": False,
                "matching_transaction_count": None,
            },
        )

    if matching_count > 0:
        return (
            "FAILED",
            (
                "One or more matching historical "
                "transactions were found."
            ),
            {
                "historical_context_available": True,
                "matching_transaction_count": (
                    matching_count
                ),
            },
        )

    return (
        "PASSED",
        "No matching historical transaction was found.",
        {
            "historical_context_available": True,
            "matching_transaction_count": 0,
        },
    )


def _evaluate_invoice_splitting(
    transaction: dict[str, Any],
    context: dict[str, Any],
) -> RuleEvaluation:
    splitting_context = context.get(
        "invoice_splitting_context"
    )
    approval_limit = transaction.get(
        "approval_limit"
    )

    if not isinstance(splitting_context, dict):
        return (
            "NOT_EVALUATED",
            (
                "Invoice-splitting history was not "
                "available for evaluation."
            ),
            {
                "historical_context_available": False,
                "historical_transaction_count": None,
                "window_total_amount": None,
                "window_hours": 24,
            },
        )

    historical_count = splitting_context.get(
        "historical_transaction_count"
    )
    window_total = splitting_context.get(
        "window_total_amount"
    )

    if (
        isinstance(historical_count, bool)
        or not isinstance(historical_count, int)
        or historical_count < 0
        or isinstance(window_total, bool)
        or not isinstance(window_total, (int, float))
        or window_total < 0
        or isinstance(approval_limit, bool)
        or not isinstance(approval_limit, (int, float))
        or approval_limit <= 0
    ):
        return (
            "NOT_EVALUATED",
            (
                "Invoice-splitting history was not "
                "available for evaluation."
            ),
            {
                "historical_context_available": False,
                "historical_transaction_count": None,
                "window_total_amount": None,
                "window_hours": 24,
            },
        )

    evidence = {
        "historical_context_available": True,
        "historical_transaction_count": (
            historical_count
        ),
        "window_total_amount": float(
            window_total
        ),
        "window_hours": 24,
    }

    if (
        historical_count > 0
        and window_total > approval_limit
    ):
        return (
            "FAILED",
            (
                "Multiple transactions for the same vendor "
                "exceeded the approval limit within 24 hours."
            ),
            evidence,
        )

    return (
        "PASSED",
        (
            "No invoice-splitting pattern exceeded the "
            "approval limit within 24 hours."
        ),
        evidence,
    )


def _evaluate_ghost_vendors(
    _transaction: dict[str, Any],
    context: dict[str, Any],
) -> RuleEvaluation:
    vendor_context = context.get(
        "ghost_vendor_context"
    )

    if not isinstance(vendor_context, dict):
        return (
            "NOT_EVALUATED",
            (
                "The approved-vendor registry was not "
                "available for evaluation."
            ),
            {
                "vendor_registry_available": False,
                "vendor_registered": None,
                "vendor_active": None,
                "manual_review_required": False,
            },
        )

    registry_authoritative = vendor_context.get(
        "registry_authoritative"
    )
    vendor_registered = vendor_context.get(
        "vendor_registered"
    )
    vendor_active = vendor_context.get(
        "vendor_active"
    )

    if (
        not isinstance(registry_authoritative, bool)
        or not isinstance(vendor_registered, bool)
        or not isinstance(vendor_active, bool)
        or not registry_authoritative
    ):
        return (
            "NOT_EVALUATED",
            (
                "The approved-vendor registry was not "
                "available for evaluation."
            ),
            {
                "vendor_registry_available": False,
                "vendor_registered": None,
                "vendor_active": None,
                "manual_review_required": False,
            },
        )

    evidence = {
        "vendor_registry_available": True,
        "vendor_registered": vendor_registered,
        "vendor_active": (
            vendor_active
            if vendor_registered
            else None
        ),
        "manual_review_required": (
            not vendor_registered
            or not vendor_active
        ),
    }

    if not vendor_registered:
        return (
            "FAILED",
            (
                "The vendor is not registered in the "
                "approved-vendor registry; manual review "
                "is required."
            ),
            evidence,
        )

    if not vendor_active:
        return (
            "FAILED",
            (
                "The vendor is registered but inactive; "
                "manual review is required."
            ),
            evidence,
        )

    return (
        "PASSED",
        (
            "The vendor is active in the approved-vendor "
            "registry."
        ),
        evidence,
    )


RULE_EVALUATORS: dict[str, RuleEvaluator] = {
    "segregation_of_duties": (
        _evaluate_segregation_of_duties
    ),
    "duplicate_payment": _evaluate_duplicate_payment,
    "approval_limits": _evaluate_approval_limits,
    "invoice_splitting": _evaluate_invoice_splitting,
    "ghost_vendors": _evaluate_ghost_vendors,
}


def evaluate_transaction_rules(
    transaction: dict[str, Any],
    *,
    context: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    rule_results: list[dict[str, Any]] = []
    rule_context = context or {}

    for eligibility in evaluate_rule_eligibility(
        transaction
    ):
        rule_key = eligibility["rule_key"]
        evaluator = RULE_EVALUATORS.get(rule_key)

        evidence = {
            "eligible": eligibility["eligible"],
            "missing_fields": eligibility[
                "missing_fields"
            ],
            "missing_any_of": eligibility[
                "missing_any_of"
            ],
        }

        if not eligibility["eligible"]:
            status = "NOT_EVALUATED"
            detail = (
                "Rule was not evaluated because required "
                "transaction fields are unavailable."
            )
            rule_evidence = evidence
        elif evaluator is None:
            status = "NOT_EVALUATED"
            detail = (
                "Required fields are available, but this "
                "rule implementation is pending."
            )
            rule_evidence = evidence
        else:
            (
                status,
                detail,
                evaluation_evidence,
                        ) = evaluator(
                transaction,
                rule_context,
            )

            rule_evidence = {
                **evidence,
                **evaluation_evidence,
            }

        rule_results.append(
            {
                "rule_key": rule_key,
                "rule_name": eligibility["rule_name"],
                "rule_version": RULE_VERSIONS[rule_key],
                "status": status,
                "score_contribution": None,
                "detail": detail,
                "evidence": rule_evidence,
            }
        )

    return rule_results

def summarize_rule_status(
    rule_results: list[dict[str, Any]],
) -> str:
    statuses = {
        result.get("status")
        for result in rule_results
    }

    if "FAILED" in statuses:
        return "REVIEW"

    if "PASSED" in statuses:
        return "PASSED"

    return "NOT_EVALUATED"