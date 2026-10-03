from copy import deepcopy
from typing import Any

import httpx
import pytest

from app.services import gemini_explanations as service


def build_transaction() -> dict[str, Any]:
    return {
        "id": "TX-PRIVATE-001",
        "vendor_id": "VND-PRIVATE-001",
        "vendor_name": "Example Vendor",
        "invoice_number": "INV-PRIVATE-001",
        "category": "Inventory",
        "amount": 500.0,
        "currency": "SAR",
        "created_by": "EMP-PRIVATE-001",
        "approved_by": "MGR-PRIVATE-001",
        "data_quality_status": "COMPLETE",
        "missing_fields": [],
        "ground_truth": {
            "is_anomaly": True,
        },
    }


def build_rule_results() -> list[dict[str, Any]]:
    return [
        {
            "rule_key": "duplicate_payment",
            "rule_name": "Duplicate Payment",
            "status": "FAILED",
            "score_contribution": 20.0,
            "evidence": {
                "matching_transaction_count": 1,
                "transaction_id": "TX-SECRET-MATCH",
                "ground_truth": {
                    "violation_type": "duplicate",
                },
            },
        }
    ]


def test_prompt_excludes_private_fields() -> None:
    prompt = service._build_prompt(
        transaction=build_transaction(),
        rule_results=build_rule_results(),
        rule_score=20.0,
        ai_score=90.0,
        risk_score=48.0,
        risk_level="LOW",
    )

    assert "TX-PRIVATE-001" not in prompt
    assert "VND-PRIVATE-001" not in prompt
    assert "INV-PRIVATE-001" not in prompt
    assert "EMP-PRIVATE-001" not in prompt
    assert "MGR-PRIVATE-001" not in prompt
    assert "TX-SECRET-MATCH" not in prompt
    assert "ground_truth" not in prompt
    assert "violation_type" not in prompt
    assert '"rule_score": 20.0' in prompt
    assert '"ai_score": 90.0' in prompt
    assert '"risk_score": 48.0' in prompt


def test_generate_risk_explanation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request: dict[str, Any] = {}
    transaction = build_transaction()
    rules = build_rule_results()
    original_transaction = deepcopy(transaction)
    original_rules = deepcopy(rules)

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, Any]:
            return {
                "candidates": [
                    {
                        "content": {
                            "parts": [
                                {
                                    "text": (
                                        "The transaction has one "
                                        "failed control indicator. "
                                        "Human review is appropriate."
                                    )
                                }
                            ]
                        }
                    }
                ]
            }

    class FakeClient:
        def __init__(self, timeout: float) -> None:
            request["timeout"] = timeout

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(
            self,
            exc_type: object,
            exc_value: object,
            traceback: object,
        ) -> None:
            return None

        def post(
            self,
            endpoint: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> FakeResponse:
            request.update(
                {
                    "endpoint": endpoint,
                    "headers": headers,
                    "json": json,
                }
            )
            return FakeResponse()

    monkeypatch.setenv(
        "GEMINI_API_KEY",
        "gemini_test_key",
    )
    monkeypatch.setenv(
        "GEMINI_MODEL",
        "gemini-3.8-flash",
    )
    monkeypatch.setattr(
        service.httpx,
        "Client",
        FakeClient,
    )

    explanation = service.generate_risk_explanation(
        transaction=transaction,
        rule_results=rules,
        rule_score=20.0,
        ai_score=90.0,
        risk_score=48.0,
        risk_level="LOW",
    )

    assert explanation == (
        "The transaction has one failed control indicator. "
        "Human review is appropriate."
    )
    assert request["endpoint"].endswith(
        "/v1beta/models/"
        "gemini-3.8-flash:generateContent"
    )
    assert request["headers"]["x-goog-api-key"] == (
        "gemini_test_key"
    )
    assert request["json"]["generationConfig"] == {
        "temperature": 0.2,
        "maxOutputTokens": 800,
        "thinkingConfig": {
            "thinkingLevel": "low",
        },
    }

    assert transaction == original_transaction
    assert rules == original_rules


def test_missing_api_key_does_not_call_gemini(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv(
        "GEMINI_API_KEY",
        raising=False,
    )
    monkeypatch.setattr(
        service.httpx,
        "Client",
        lambda timeout: pytest.fail(
            "Gemini must not be called without a key."
        ),
    )

    with pytest.raises(
        service.GeminiConfigurationError,
        match="GEMINI_API_KEY",
    ):
        service.generate_risk_explanation(
            transaction=build_transaction(),
            rule_results=build_rule_results(),
            rule_score=20.0,
            ai_score=90.0,
            risk_score=48.0,
            risk_level="LOW",
        )


def test_gemini_network_failure_is_wrapped(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class FakeClient:
        def __init__(self, timeout: float) -> None:
            self.timeout = timeout

        def __enter__(self) -> "FakeClient":
            return self

        def __exit__(
            self,
            exc_type: object,
            exc_value: object,
            traceback: object,
        ) -> None:
            return None

        def post(
            self,
            endpoint: str,
            *,
            headers: dict[str, str],
            json: dict[str, Any],
        ) -> None:
            raise httpx.ConnectError(
                "Gemini unavailable."
            )

    monkeypatch.setenv(
        "GEMINI_API_KEY",
        "gemini_test_key",
    )
    monkeypatch.setattr(
        service.httpx,
        "Client",
        FakeClient,
    )

    with pytest.raises(
        service.GeminiExplanationError,
        match="generation failed",
    ):
        service.generate_risk_explanation(
            transaction=build_transaction(),
            rule_results=build_rule_results(),
            rule_score=20.0,
            ai_score=90.0,
            risk_score=48.0,
            risk_level="LOW",
        )

def test_incomplete_gemini_response_is_rejected() -> None:
    payload = {
        "candidates": [
            {
                "finishReason": "MAX_TOKENS",
                "content": {
                    "parts": [
                        {
                            "text": (
                                "This explanation was cut off"
                            )
                        }
                    ]
                },
            }
        ]
    }

    with pytest.raises(
        service.GeminiExplanationError,
        match="did not complete",
    ):
        service._extract_response_text(payload)