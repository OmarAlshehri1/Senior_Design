from __future__ import annotations

import math
from typing import TypeGuard


RISK_SCORING_VERSION = "1.0.0"
RULE_SCORE_WEIGHT = 0.60
AI_SCORE_WEIGHT = 0.40

NumericScore = int | float


def _is_valid_score(
    score: object,
) -> TypeGuard[NumericScore]:
    return (
        isinstance(score, (int, float))
        and not isinstance(score, bool)
        and math.isfinite(float(score))
        and 0 <= float(score) <= 100
    )


def calculate_risk_score(
    rule_score: NumericScore | None,
    ai_score: NumericScore | None,
) -> float | None:
    if not _is_valid_score(rule_score):
        return None

    if not _is_valid_score(ai_score):
        return None

    combined_score = (
        RULE_SCORE_WEIGHT * float(rule_score)
        + AI_SCORE_WEIGHT * float(ai_score)
    )

    return round(
        min(100.0, max(0.0, combined_score)),
        2,
    )


def classify_risk_level(
    risk_score: NumericScore | None,
) -> str | None:
    if not _is_valid_score(risk_score):
        return None

    score = float(risk_score)

    if score < 50:
        return "LOW"

    if score < 75:
        return "MEDIUM"

    return "HIGH"
