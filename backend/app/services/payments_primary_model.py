"""Source-bound Payments ranks. Never treats synthetic authority as a model feature."""
from dataclasses import dataclass
import hashlib
from pathlib import Path

import joblib
import numpy as np

FEATURES = ('amount_log', 'source_name_frequency_log',
            'source_name_amount_delta_log', 'source_name_seen_in_fit')
MODEL_VERSION = 'payments-primary-no-calendar-1.0.0'


@dataclass
class PaymentsPrimaryModel:
    bundle: dict

    @property
    def version(self):
        return self.bundle['model_version']

    @property
    def threshold(self):
        return self.bundle['percentile_threshold']

    def is_anomalous(self, score):
        return score is not None and score >= self.threshold

    def matrix(self, source_rows):
        baseline = self.bundle['baseline']
        values = []
        for row in source_rows:
            features = baseline.transform(row)
            values.append([features[name] for name in FEATURES])
        result = np.asarray(values, dtype=np.float32)
        if not len(source_rows):
            return np.empty((0, len(FEATURES)), dtype=np.float32)
        if result.shape != (len(source_rows), len(FEATURES)) or not np.isfinite(result).all():
            raise ValueError('PAYMENTS_FEATURE_INPUT_INVALID')
        return result

    def score_source_rows(self, source_rows):
        if not source_rows:
            return np.empty(0), []
        matrix = self.matrix(source_rows)
        severity = -self.bundle['estimator'].score_samples(matrix)
        ranks = np.searchsorted(self.bundle['fit_reference_severities'], severity, side='right')
        ranks = 100 * ranks / len(self.bundle['fit_reference_severities'])
        return severity, [round(float(np.clip(rank, 0, 100)), 2) for rank in ranks]

    def score_transactions(self, transactions):
        from datetime import datetime
        from decimal import Decimal, InvalidOperation
        rows = []
        eligible = []
        scores = [None] * len(transactions)
        for index, transaction in enumerate(transactions):
            try:
                amount = Decimal(str(transaction.get('amount')))
                value = transaction.get('timestamp')
                timestamp = value if isinstance(value, datetime) else datetime.fromisoformat(value.replace('Z', '+00:00'))
                if not amount.is_finite() or amount <= 0 or transaction.get('currency') != 'USD':
                    continue
            except (ValueError, TypeError, AttributeError, InvalidOperation):
                continue
            eligible.append(index)
            rows.append({'AMOUNT': str(transaction['amount']),
                         'CHECK DATE': timestamp.strftime('%m/%d/%Y'),
                         'VENDOR NAME': (transaction.get('metadata') or {}).get(
                             'original_vendor_name', transaction.get('vendor_name'))})
        for index, score in zip(eligible, self.score_source_rows(rows)[1]):
            scores[index] = score
        return scores


def validate_bundle(bundle, dataset_key):
    if (not isinstance(bundle, dict) or bundle.get('schema') != 'payments-primary-runtime-v1'
            or bundle.get('dataset_key') != dataset_key
            or tuple(bundle.get('feature_names', ())) != FEATURES
            or bundle.get('model_version') != MODEL_VERSION
            or bundle.get('fit_count') != 199092
            or bundle.get('validation_count') != 49614):
        raise ValueError('PAYMENTS_MODEL_BINDING_INVALID')
    reference = bundle['fit_reference_severities']
    if (not isinstance(reference, np.ndarray) or reference.shape != (bundle['fit_count'],)
            or not np.isfinite(reference).all() or np.any(reference[1:] < reference[:-1])
            or not 0 <= bundle['percentile_threshold'] <= 100
            or bundle['estimator'].n_features_in_ != len(FEATURES)):
        raise ValueError('PAYMENTS_MODEL_REFERENCE_INVALID')
    return PaymentsPrimaryModel(bundle)


def load_payments_primary_model(path, expected_sha256, dataset_key):
    path = Path(path)
    if path.stat().st_size > 10 * 1024 * 1024:
        raise ValueError('PAYMENTS_MODEL_SIZE_INVALID')
    with path.open('rb') as handle:
        actual = hashlib.file_digest(handle, 'sha256').hexdigest()
    if actual != expected_sha256:
        raise ValueError('PAYMENTS_MODEL_HASH_INVALID')
    # Only a pre-provisioned operator-approved hash may reach this trusted loader.
    return validate_bundle(joblib.load(path), dataset_key)
