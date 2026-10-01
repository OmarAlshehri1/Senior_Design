from __future__ import annotations

from typing import Any


RULE_DEFINITIONS: tuple[dict[str, Any], ...] = (
    {
        "key": "segregation_of_duties",
        "name": "Segregation of Duties",
        "required_fields": (
            "created_by",
            "approved_by",
        ),
        "required_any_of": (),
    },
    {
        "key": "approval_limits",
        "name": "Approval Limits",
        "required_fields": (
            "amount",
            "approval_limit",
        ),
        "required_any_of": (),
    },
    {
        "key": "duplicate_payment",
        "name": "Duplicate Payment",
        "required_fields": (
            "invoice_number",
            "amount",
        ),
        "required_any_of": (
            (
                "vendor_id",
                "vendor_name",
            ),
        ),
    },
    {
        "key": "invoice_splitting",
        "name": "Invoice Splitting",
        "required_fields": (
            "timestamp",
            "amount",
            "approval_limit",
        ),
        "required_any_of": (
            (
                "vendor_id",
                "vendor_name",
            ),
        ),
    },
    {
        "key": "ghost_vendors",
        "name": "Ghost Vendors",
        "required_fields": (),
        "required_any_of": (
            (
                "vendor_id",
                "vendor_name",
            ),
        ),
    },
)


def _is_missing(value: Any) -> bool:
    return (
        value is None
        or (
            isinstance(value, str)
            and not value.strip()
        )
    )


def evaluate_rule_eligibility(
    transaction: dict[str, Any],
) -> list[dict[str, Any]]:
    eligibility_results: list[dict[str, Any]] = []

    for definition in RULE_DEFINITIONS:
        missing_fields = [
            field_name
            for field_name in definition["required_fields"]
            if _is_missing(transaction.get(field_name))
        ]

        missing_any_of = [
            list(field_group)
            for field_group in definition["required_any_of"]
            if all(
                _is_missing(transaction.get(field_name))
                for field_name in field_group
            )
        ]

        eligibility_results.append(
            {
                "rule_key": definition["key"],
                "rule_name": definition["name"],
                "eligible": (
                    not missing_fields
                    and not missing_any_of
                ),
                "missing_fields": missing_fields,
                "missing_any_of": missing_any_of,
            }
        )

    return eligibility_results


def build_pending_rule_results(
    transaction: dict[str, Any],
) -> list[dict[str, Any]]:
    rule_results: list[dict[str, Any]] = []

    for eligibility in evaluate_rule_eligibility(
        transaction
    ):
        if eligibility["eligible"]:
            detail = (
                "Required transaction fields are available; "
                "rule execution is pending."
            )
        else:
            detail = (
                "Rule was not evaluated because required "
                "transaction fields are unavailable."
            )

        rule_results.append(
            {
                "rule_key": eligibility["rule_key"],
                "rule_name": eligibility["rule_name"],
                "status": "NOT_EVALUATED",
                "score_contribution": None,
                "detail": detail,
                "evidence": {
                    "eligible": eligibility["eligible"],
                    "missing_fields": eligibility[
                        "missing_fields"
                    ],
                    "missing_any_of": eligibility[
                        "missing_any_of"
                    ],
                },
            }
        )

    return rule_results
