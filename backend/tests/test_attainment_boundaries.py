"""Synthetic rule behavior, not fraud/model accuracy or hosted acceptance."""
from copy import deepcopy

import pytest

from app.services.audit_rules import evaluate_transaction_rules


def fixture():
    return {
        "id": "SYNTHETIC-ATTAINMENT", "timestamp": "2026-11-16T00:00:00Z",
        "vendor_id": "SYNTHETIC-VENDOR", "invoice_number": "SYNTHETIC-INVOICE",
        "amount": 500.0, "currency": "SAR", "created_by": "Maker",
        "approved_by": "Checker", "approval_limit": 1000.0,
    }, {
        "duplicate_payment_count": 0,
        "invoice_splitting_context": {"historical_transaction_count": 1, "window_total_amount": 900.0},
        "ghost_vendor_context": {"registry_authoritative": True, "vendor_registered": True, "vendor_active": True},
    }


@pytest.mark.parametrize("rule,tx,context,expected", [
    ("segregation_of_duties", {}, {}, "PASSED"),
    ("segregation_of_duties", {"approved_by": "Maker"}, {}, "FAILED"),
    ("segregation_of_duties", {"approved_by": "  mAkEr  "}, {}, "FAILED"),
    ("approval_limits", {"amount": 999.99}, {}, "PASSED"),
    ("approval_limits", {"amount": 1000.01}, {}, "FAILED"),
    ("approval_limits", {"amount": 1000.00}, {}, "PASSED"),
    ("duplicate_payment", {}, {"duplicate_payment_count": 0}, "PASSED"),
    ("duplicate_payment", {}, {"duplicate_payment_count": 1}, "FAILED"),
    ("duplicate_payment", {}, {"duplicate_payment_count": -1}, "NOT_EVALUATED"),
    ("duplicate_payment", {}, {"duplicate_payment_count": True}, "NOT_EVALUATED"),
    ("invoice_splitting", {}, {"invoice_splitting_context": {"historical_transaction_count": 1, "window_total_amount": 999.99}}, "PASSED"),
    ("invoice_splitting", {}, {"invoice_splitting_context": {"historical_transaction_count": 1, "window_total_amount": 1000.01}}, "FAILED"),
    ("invoice_splitting", {}, {"invoice_splitting_context": {"historical_transaction_count": 1, "window_total_amount": 1000}}, "PASSED"),
    ("ghost_vendors", {}, {}, "PASSED"),
    ("ghost_vendors", {}, {"ghost_vendor_context": {"registry_authoritative": True, "vendor_registered": False, "vendor_active": False}}, "FAILED"),
    ("ghost_vendors", {}, {"ghost_vendor_context": {"registry_authoritative": False, "vendor_registered": True, "vendor_active": True}}, "NOT_EVALUATED"),
    ("ghost_vendors", {}, {"ghost_vendor_context": {"registry_authoritative": True, "vendor_registered": True, "vendor_active": False}}, "FAILED"),
])
def test_positive_negative_and_boundary(rule, tx, context, expected):
    transaction, ctx = fixture()
    transaction.update(tx)
    ctx.update(deepcopy(context))
    result = {r["rule_key"]: r for r in evaluate_transaction_rules(transaction, context=ctx)}
    assert result[rule]["status"] == expected


@pytest.mark.parametrize("amount,total,expected", [
    (500, 999.99, "PASSED"), (500, 1000, "PASSED"),
    (500, 1000.01, "FAILED"), (1000, 1500, "PASSED"),
    (1000.01, 1500, "PASSED"), (0, 1500, "PASSED"),
])
def test_subthreshold_splitting_boundary(amount, total, expected):
    transaction, ctx = fixture()
    transaction["amount"] = amount
    ctx["invoice_splitting_mode"] = "SUBTHRESHOLD_PAYMENTS"
    ctx["invoice_splitting_context"] = {
        "calculation_basis": "SUBTHRESHOLD_CURRENT_APPROVAL_LIMIT",
        "approval_limit": 1000, "historical_transaction_count": 1,
        "window_total_amount": total,
    }
    result = {r["rule_key"]: r for r in evaluate_transaction_rules(transaction, context=ctx)}
    assert result["invoice_splitting"]["status"] == expected


@pytest.mark.parametrize("field,affected", [
    ("created_by", {"segregation_of_duties"}),
    ("approved_by", {"segregation_of_duties"}),
    ("amount", {"approval_limits", "duplicate_payment", "invoice_splitting"}),
    ("approval_limit", {"approval_limits", "invoice_splitting"}),
    ("vendor_id", {"duplicate_payment", "invoice_splitting", "ghost_vendors"}),
    ("invoice_number", {"duplicate_payment"}),
    ("timestamp", {"invoice_splitting"}),
])
def test_missing_fields_never_silently_pass(field, affected):
    transaction, ctx = fixture()
    transaction[field] = None
    result = {r["rule_key"]: r for r in evaluate_transaction_rules(transaction, context=ctx)}
    assert {k for k, r in result.items() if r["status"] == "NOT_EVALUATED"} == affected
    assert all(r["status"] == "PASSED" for k, r in result.items() if k not in affected)
