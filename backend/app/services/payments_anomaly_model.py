"""Payments-only fitted artifact. Scores are anomaly ranks, not fraud probabilities."""
from dataclasses import dataclass

import numpy as np
from sklearn.ensemble import IsolationForest

from app.services.payments_anomaly_features import FEATURE_NAMES, FEATURE_VERSION, SourceNameBaseline

MODEL_VERSION = 'payments-isolation-forest-1.0.0'


def feature_matrix(baseline, rows):
    def values():
        for row in rows:
            features = baseline.transform(row)
            yield from (features[name] for name in FEATURE_NAMES)
    matrix = np.fromiter(values(), dtype=np.float32).reshape((-1, len(FEATURE_NAMES)))
    if not np.isfinite(matrix).all():
        raise ValueError('NONFINITE_MODEL_FEATURE')
    return matrix


@dataclass
class PaymentsAnomalyModel:
    baseline: SourceNameBaseline
    estimator: IsolationForest
    fit_reference_severities: np.ndarray
    model_version: str = MODEL_VERSION
    feature_version: str = FEATURE_VERSION
    feature_names: tuple = FEATURE_NAMES
    decision_threshold: float | None = None

    def score_matrix(self, matrix):
        if matrix.shape[1:] != (len(self.feature_names),):
            raise ValueError('PAYMENTS_FEATURE_SHAPE_MISMATCH')
        if not len(matrix):
            return np.empty(0), np.empty(0)
        severity = -self.estimator.score_samples(matrix)
        percentiles = 100*np.searchsorted(self.fit_reference_severities, severity, side='right')/len(self.fit_reference_severities)
        return severity, percentiles

    def score_rows(self, rows):
        return self.score_matrix(feature_matrix(self.baseline, rows))
