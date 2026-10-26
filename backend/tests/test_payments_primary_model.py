from datetime import datetime, timezone
from unittest.mock import Mock

import numpy as np
import pytest

from app.services.payments_anomaly_features import SourceNameBaseline
from app.services.payments_primary_model import PaymentsPrimaryModel, FEATURES, MODEL_VERSION, validate_bundle
from app.services import primary_dataset


def model():
    baseline = SourceNameBaseline.fit([
        {'AMOUNT': '100', 'CHECK DATE': '01/01/2023', 'VENDOR NAME': 'Synthetic vendor'},
        {'AMOUNT': '200', 'CHECK DATE': '01/02/2023', 'VENDOR NAME': 'Synthetic vendor'},
    ])
    estimator = Mock(n_features_in_=4)
    estimator.score_samples.side_effect = lambda values: -np.full(len(values), 0.5)
    return PaymentsPrimaryModel({'baseline': baseline, 'estimator': estimator,
        'fit_reference_severities': np.linspace(0, 1, 199092), 'percentile_threshold': 99.51,
        'model_version': MODEL_VERSION, 'schema': 'payments-primary-runtime-v1',
        'dataset_key': 'test', 'feature_names': FEATURES, 'fit_count': 199092, 'validation_count': 49614})


def transaction(**changes):
    return {'id': 'synthetic', 'timestamp': '2026-10-01T12:00:00Z', 'amount': 100,
            'currency': 'USD', 'vendor_name': 'Synthetic vendor', **changes}


def test_canonical_dates_and_simulated_fields_do_not_change_features():
    m = model()
    first = transaction()
    other = transaction(timestamp=datetime(2025, 2, 5, tzinfo=timezone.utc),
                        approval_limit=1, created_by='other', approved_by='other')
    assert m.score_transactions([first, other]) == [50.0, 50.0]
    rows = [{'AMOUNT': '100', 'CHECK DATE': day, 'VENDOR NAME': 'Synthetic vendor'}
            for day in ['10/01/2026', '02/05/2025']]
    np.testing.assert_array_equal(m.matrix(rows)[0], m.matrix(rows)[1])


@pytest.mark.parametrize('changes', [{'amount': None}, {'amount': 0}, {'amount': -1},
                                   {'currency': 'SAR'}, {'timestamp': None}, {'amount': float('nan')}])
def test_inapplicable_inputs_have_no_ai_score(changes):
    assert model().score_transactions([transaction(**changes)]) == [None]


def test_model_cannot_cross_dataset_binding():
    m = model()
    assert validate_bundle(m.bundle, 'test').version == MODEL_VERSION
    with pytest.raises(ValueError, match='BINDING'):
        validate_bundle(m.bundle, 'another-dataset')


def test_selection_follows_saved_transaction_and_does_not_fallback(monkeypatch):
    monkeypatch.setenv('PAYMENTS_PRIMARY_ENABLED', 'true')
    legacy = Mock()
    monkeypatch.setattr(primary_dataset, 'metadata', lambda identifier: {'id': 0, 'source_schema': 'LEGACY'})
    assert primary_dataset.model_for_transaction('old', legacy) is legacy.return_value
    legacy.reset_mock()
    monkeypatch.setattr(primary_dataset, 'metadata', lambda identifier: {'id': 1, 'source_schema': 'PAYMENTS_SIMULATION_WORKBOOK', 'state': 'IMPORTING'})
    with pytest.raises(ValueError, match='NOT_READY'):
        primary_dataset.model_for_transaction('new', legacy)
    legacy.assert_not_called()


def test_new_secret_is_not_sent_as_a_bearer_jwt():
    assert primary_dataset.storage_headers('sb_secret_test') == {'apikey': 'sb_secret_test'}
