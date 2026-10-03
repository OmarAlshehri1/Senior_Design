import pytest

from app.services.risk_scoring import (
    AI_SCORE_WEIGHT,
    RISK_SCORING_VERSION,
    RULE_SCORE_WEIGHT,
    calculate_risk_score,
    classify_risk_level,
)


def test_combines_rule_and_ai_scores() -> None:
    assert RULE_SCORE_WEIGHT == 0.60
    assert AI_SCORE_WEIGHT == 0.40
    assert RISK_SCORING_VERSION == "1.0.0"

    assert calculate_risk_score(
        rule_score=33.33,
        ai_score=95.0,
    ) == 58.0


@pytest.mark.parametrize(
    ("risk_score", "expected_level"),
    [
        (0.0, "LOW"),
        (49.99, "LOW"),
        (50.0, "MEDIUM"),
        (74.99, "MEDIUM"),
        (75.0, "HIGH"),
        (100.0, "HIGH"),
    ],
)
def test_classifies_risk_boundaries(
    risk_score: float,
    expected_level: str,
) -> None:
    assert (
        classify_risk_level(risk_score)
        == expected_level
    )


@pytest.mark.parametrize(
    ("rule_score", "ai_score"),
    [
        (None, 50.0),
        (50.0, None),
        (None, None),
        (-1.0, 50.0),
        (50.0, 101.0),
        (float("nan"), 50.0),
    ],
)
def test_missing_or_invalid_inputs_return_none(
    rule_score: float | None,
    ai_score: float | None,
) -> None:
    assert (
        calculate_risk_score(
            rule_score,
            ai_score,
        )
        is None
    )


def test_missing_or_invalid_risk_has_no_level() -> None:
    assert classify_risk_level(None) is None
    assert classify_risk_level(-1.0) is None
    assert classify_risk_level(101.0) is None
