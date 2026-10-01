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
    [dict[str, Any]],
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


RULE_EVALUATORS: dict[str, RuleEvaluator] = {
    "segregation_of_duties": (
        _evaluate_segregation_of_duties
    ),
    "approval_limits": _evaluate_approval_limits,
}


def evaluate_transaction_rules(
    transaction: dict[str, Any],
) -> list[dict[str, Any]]:
    rule_results: list[dict[str, Any]] = []

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
            ) = evaluator(transaction)

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