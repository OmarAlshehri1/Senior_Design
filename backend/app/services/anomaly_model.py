from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest
from sklearn.feature_extraction import DictVectorizer

from app.services.anomaly_features import (
    ANOMALY_MODEL_VERSION,
)


FeatureRecord = dict[str, float | str]


@dataclass
class AnomalyScoringModel:
    vectorizer: DictVectorizer
    estimator: IsolationForest
    reference_severities: np.ndarray
    threshold: float
    version: str = ANOMALY_MODEL_VERSION

    def score(
        self,
        feature_records: list[FeatureRecord],
    ) -> list[float]:
        if not feature_records:
            return []

        matrix = self.vectorizer.transform(
            cast(Any, feature_records)
        )
        severities = -self.estimator.score_samples(
            matrix
        )

        percentiles = (
            np.searchsorted(
                self.reference_severities,
                severities,
                side="right",
            )
            / len(self.reference_severities)
            * 100
        )

        return [
            round(
                float(np.clip(score, 0.0, 100.0)),
                2,
            )
            for score in percentiles
        ]

    def is_anomalous(self, ai_score: float) -> bool:
        return ai_score >= self.threshold


def train_anomaly_model(
    feature_records: list[FeatureRecord],
    *,
    random_state: int = 42,
) -> AnomalyScoringModel:
    if len(feature_records) < 2:
        raise ValueError(
            "At least two feature records are required."
        )

    vectorizer = DictVectorizer(sparse=False)
    matrix = vectorizer.fit_transform(
        feature_records
    )

    estimator = IsolationForest(
        n_estimators=400,
        max_samples="auto",
        contamination="auto",
        random_state=random_state,
        n_jobs=-1,
    )
    estimator.fit(matrix)

    reference_severities = np.sort(
        -estimator.score_samples(matrix)
    )

    return AnomalyScoringModel(
        vectorizer=vectorizer,
        estimator=estimator,
        reference_severities=reference_severities,
        threshold=100.0,
    )


def calculate_detection_metrics(
    scores: list[float],
    labels: list[bool],
    *,
    threshold: float,
) -> dict[str, float]:
    if len(scores) != len(labels) or not scores:
        raise ValueError(
            "Scores and labels must be non-empty "
            "and have equal lengths."
        )

    positives = sum(labels)
    negatives = len(labels) - positives

    if positives == 0 or negatives == 0:
        raise ValueError(
            "Both positive and negative labels are required."
        )

    predictions = [
        score >= threshold
        for score in scores
    ]

    true_positives = sum(
        predicted and label
        for predicted, label in zip(
            predictions,
            labels,
            strict=True,
        )
    )
    false_positives = sum(
        predicted and not label
        for predicted, label in zip(
            predictions,
            labels,
            strict=True,
        )
    )

    return {
        "detection_rate": round(
            true_positives / positives,
            4,
        ),
        "false_positive_rate": round(
            false_positives / negatives,
            4,
        ),
    }


def select_anomaly_threshold(
    model: AnomalyScoringModel,
    validation_features: list[FeatureRecord],
    validation_labels: list[bool],
    *,
    minimum_detection_rate: float = 0.90,
    maximum_false_positive_rate: float = 0.10,
) -> dict[str, float]:
    scores = model.score(validation_features)
    candidates: list[
        tuple[float, dict[str, float]]
    ] = []

    for threshold in np.linspace(
        0.0,
        100.0,
        1001,
    ):
        metrics = calculate_detection_metrics(
            scores,
            validation_labels,
            threshold=float(threshold),
        )

        if (
            metrics["detection_rate"]
            >= minimum_detection_rate
            and metrics["false_positive_rate"]
            <= maximum_false_positive_rate
        ):
            candidates.append(
                (float(threshold), metrics)
            )

    if not candidates:
        raise ValueError(
            "No threshold satisfies the validation targets."
        )

    threshold, metrics = max(
        candidates,
        key=lambda candidate: candidate[0],
    )
    model.threshold = round(threshold, 2)

    return {
        "threshold": model.threshold,
        **metrics,
    }


def save_anomaly_model(
    model: AnomalyScoringModel,
    path: Path,
) -> None:
    path.parent.mkdir(
        parents=True,
        exist_ok=True,
    )
    joblib.dump(model, path)


def load_anomaly_model(
    path: Path,
) -> AnomalyScoringModel:
    model: Any = joblib.load(path)

    if not isinstance(model, AnomalyScoringModel):
        raise ValueError(
            "The anomaly model artifact is invalid."
        )

    if model.version != ANOMALY_MODEL_VERSION:
        raise ValueError(
            "The anomaly model version is unsupported."
        )

    return model
