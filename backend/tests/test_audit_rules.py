from app.services.audit_rules import (
    evaluate_transaction_rules,
    summarize_rule_status,
)

from typing import Any


def build_transaction() -> dict[str, Any]:
    return {
        "id": "TX-RULE-001",
        "timestamp": "2026-10-01T10:00:00Z",
        "vendor_id": "V-001",
        "vendor_name": "Test Vendor",
        "invoice_number": "INV-001",
        "category": "Inventory",
        "amount": 500.0,
        "currency": "SAR",
        "created_by": "EMP-001",
        "approved_by": "MGR-001",
        "approver_role": "Manager",
        "approval_limit": 1000.0,
    }


def results_by_key(
    transaction: dict[str, Any],
) -> dict[str, dict[str, Any]]:
    return {
        result["rule_key"]: result
        for result in evaluate_transaction_rules(
            transaction
        )
    }


def test_segregation_of_duties_passes() -> None:
    rules = results_by_key(build_transaction())

    result = rules["segregation_of_duties"]

    assert result["status"] == "PASSED"
    assert result["evidence"]["eligible"] is True
    assert result["evidence"]["same_actor"] is False


def test_segregation_of_duties_fails_for_same_actor() -> None:
    transaction = build_transaction()
    transaction["approved_by"] = " emp-001 "

    rules = results_by_key(transaction)

    result = rules["segregation_of_duties"]

    assert result["status"] == "FAILED"
    assert result["evidence"]["same_actor"] is True


def test_approval_limits_passes_at_limit() -> None:
    transaction = build_transaction()
    transaction["amount"] = 1000.0

    rules = results_by_key(transaction)

    result = rules["approval_limits"]

    assert result["status"] == "PASSED"
    assert (
        result["evidence"]["amount_exceeds_limit"]
        is False
    )


def test_approval_limits_fails_above_limit() -> None:
    transaction = build_transaction()
    transaction["amount"] = 1250.0

    rules = results_by_key(transaction)

    result = rules["approval_limits"]

    assert result["status"] == "FAILED"
    assert (
        result["evidence"]["amount_exceeds_limit"]
        is True
    )
    assert result["evidence"]["excess_amount"] == 250.0


def test_missing_field_does_not_block_other_rules() -> None:
    transaction = build_transaction()
    transaction["approval_limit"] = None

    rules = results_by_key(transaction)

    assert (
        rules["segregation_of_duties"]["status"]
        == "PASSED"
    )
    assert (
        rules["approval_limits"]["status"]
        == "NOT_EVALUATED"
    )
    assert rules["approval_limits"]["evidence"][
        "missing_fields"
    ] == ["approval_limit"]


def test_pending_rules_remain_not_evaluated() -> None:
    rules = results_by_key(build_transaction())

    pending_rule_keys = {
        "duplicate_payment",
        "invoice_splitting",
        "ghost_vendors",
    }

    for rule_key in pending_rule_keys:
        assert rules[rule_key]["status"] == "NOT_EVALUATED"
        assert rules[rule_key]["evidence"]["eligible"] is True


def test_every_rule_result_has_a_version() -> None:
    results = evaluate_transaction_rules(
        build_transaction()
    )

    assert len(results) == 5
    assert all(
        result["rule_version"] == "1.0.0"
        for result in results
    )

def test_rule_status_is_passed_when_rules_pass() -> None:
    results = evaluate_transaction_rules(
        build_transaction()
    )

    assert summarize_rule_status(results) == "PASSED"


def test_rule_status_is_review_when_a_rule_fails() -> None:
    transaction = build_transaction()
    transaction["approved_by"] = "EMP-001"

    results = evaluate_transaction_rules(transaction)

    assert summarize_rule_status(results) == "REVIEW"


def test_rule_status_is_not_evaluated_without_results() -> None:
    results = [
        {
            "status": "NOT_EVALUATED",
        }
    ]

    assert (
        summarize_rule_status(results)
        == "NOT_EVALUATED"
    )

def test_duplicate_payment_passes_without_matches() -> None:
    results = evaluate_transaction_rules(
        build_transaction(),
        context={
            "duplicate_payment_count": 0,
        },
    )
    rules = {
        result["rule_key"]: result
        for result in results
    }

    duplicate = rules["duplicate_payment"]

    assert duplicate["status"] == "PASSED"
    assert duplicate["evidence"][
        "matching_transaction_count"
    ] == 0


def test_duplicate_payment_fails_with_matches() -> None:
    results = evaluate_transaction_rules(
        build_transaction(),
        context={
            "duplicate_payment_count": 2,
        },
    )
    rules = {
        result["rule_key"]: result
        for result in results
    }

    duplicate = rules["duplicate_payment"]

    assert duplicate["status"] == "FAILED"
    assert duplicate["evidence"][
        "matching_transaction_count"
    ] == 2


def test_duplicate_payment_needs_history_context() -> None:
    rules = results_by_key(build_transaction())

    duplicate = rules["duplicate_payment"]

    assert duplicate["status"] == "NOT_EVALUATED"
    assert duplicate["evidence"][
        "historical_context_available"
    ] is False
