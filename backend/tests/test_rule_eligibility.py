from typing import Any

from app.services.rule_eligibility import (
    build_pending_rule_results,
    evaluate_rule_eligibility,
)


def make_complete_transaction() -> dict[str, Any]:
    return {
        "id": "TX-ELIGIBILITY-001",
        "timestamp": "2026-10-01T10:00:00Z",
        "vendor_id": "VEN-001",
        "vendor_name": "Test Vendor",
        "invoice_number": "INV-001",
        "amount": 1000.0,
        "created_by": "EMP-001",
        "approved_by": "MGR-001",
        "approval_limit": 5000.0,
    }


def by_rule_key(
    results: list[dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    return {
        result["rule_key"]: result
        for result in results
    }


def test_complete_transaction_is_eligible_for_all_rules() -> None:
    results = by_rule_key(
        evaluate_rule_eligibility(
            make_complete_transaction()
        )
    )

    assert len(results) == 5
    assert all(
        result["eligible"]
        for result in results.values()
    )


def test_missing_field_only_blocks_affected_rules() -> None:
    transaction = make_complete_transaction()
    transaction["approval_limit"] = None

    results = by_rule_key(
        evaluate_rule_eligibility(transaction)
    )

    assert results[
        "segregation_of_duties"
    ]["eligible"] is True
    assert results[
        "duplicate_payment"
    ]["eligible"] is True
    assert results[
        "ghost_vendors"
    ]["eligible"] is True

    assert results[
        "approval_limits"
    ]["eligible"] is False
    assert results[
        "approval_limits"
    ]["missing_fields"] == [
        "approval_limit"
    ]

    assert results[
        "invoice_splitting"
    ]["eligible"] is False
    assert results[
        "invoice_splitting"
    ]["missing_fields"] == [
        "approval_limit"
    ]


def test_vendor_name_can_replace_missing_vendor_id() -> None:
    transaction = make_complete_transaction()
    transaction["vendor_id"] = None

    results = by_rule_key(
        evaluate_rule_eligibility(transaction)
    )

    assert results[
        "duplicate_payment"
    ]["eligible"] is True
    assert results[
        "invoice_splitting"
    ]["eligible"] is True
    assert results[
        "ghost_vendors"
    ]["eligible"] is True


def test_missing_vendor_identity_is_reported() -> None:
    transaction = make_complete_transaction()
    transaction["vendor_id"] = None
    transaction["vendor_name"] = "   "

    results = by_rule_key(
        evaluate_rule_eligibility(transaction)
    )

    expected_missing_group = [
        [
            "vendor_id",
            "vendor_name",
        ]
    ]

    assert results[
        "duplicate_payment"
    ]["eligible"] is False
    assert results[
        "duplicate_payment"
    ]["missing_any_of"] == expected_missing_group

    assert results[
        "invoice_splitting"
    ]["eligible"] is False
    assert results[
        "ghost_vendors"
    ]["eligible"] is False


def test_pending_results_explain_rule_eligibility() -> None:
    transaction = make_complete_transaction()
    transaction["approval_limit"] = None

    results = by_rule_key(
        build_pending_rule_results(transaction)
    )

    assert len(results) == 5
    assert all(
        result["status"] == "NOT_EVALUATED"
        for result in results.values()
    )
    assert all(
        result["score_contribution"] is None
        for result in results.values()
    )

    approval_result = results["approval_limits"]

    assert (
        approval_result["evidence"]["eligible"]
        is False
    )
    assert approval_result["evidence"][
        "missing_fields"
    ] == ["approval_limit"]

    duplicate_result = results["duplicate_payment"]

    assert (
        duplicate_result["evidence"]["eligible"]
        is True
    )
