"""Primary dataset metadata and private, hash-bound Payments inference."""
import hashlib
import os
from pathlib import Path
import re
import tempfile
from threading import Lock
from urllib.parse import quote, urlsplit

import httpx

from app.repositories import identity
from app.repositories.supabase_transactions import _get_configuration
from app.services.payments_primary_model import load_payments_primary_model
from app.services.payments_primary_model import PaymentsPrimaryModel

_models = {}
_model_lock = Lock()


def score_transaction(model, transaction, legacy_features):
    if isinstance(model, PaymentsPrimaryModel):
        return model.score_transactions([transaction])[0]
    return model.score([legacy_features])[0]


def enabled():
    return os.getenv('PAYMENTS_PRIMARY_ENABLED', 'false').lower() == 'true'


def metadata(transaction_id=None):
    value = (identity.rpc('get_transaction_dataset', p_id=transaction_id)
             if transaction_id is not None else identity.rpc('get_primary_dataset'))
    if not isinstance(value, dict) or not isinstance(value.get('id'), int):
        raise ValueError('PRIMARY_DATASET_UNAVAILABLE')
    return value


def public_metadata():
    if not enabled():
        return {'enabled': False}
    value = metadata()
    if value['source_schema'] == 'PAYMENTS_SIMULATION_WORKBOOK':
        _model_for_metadata(value)
    return {'enabled': True, 'id': value['id'], 'label': value['label'],
            'currency': value.get('currency'), 'source_schema': value['source_schema'],
            'simulation_enriched': value['source_schema'] == 'PAYMENTS_SIMULATION_WORKBOOK',
            'model_version': value.get('model_version'),
            'model_status': 'READY' if value['source_schema'] == 'PAYMENTS_SIMULATION_WORKBOOK' else None,
            'ai_score_interpretation': 'Rank relative to the model Fit payments; not fraud probability',
            'transaction_count': (value.get('summary') or {}).get('total')}


def storage_headers(secret):
    result = {'apikey': secret}
    if secret.startswith('eyJ'):
        result['Authorization'] = 'Bearer ' + secret
    return result


def _private_artifact(value):
    expected = value.get('model_sha256') or ''
    bucket = value.get('model_bucket') or ''
    name = value.get('model_object') or ''
    if (not re.fullmatch('[0-9a-f]{64}', expected)
            or not re.fullmatch('[a-z0-9][a-z0-9._-]{0,62}', bucket)
            or not name or name.startswith('/') or any(p in ('', '.', '..') for p in name.split('/'))):
        raise ValueError('PAYMENTS_MODEL_STORAGE_BINDING_INVALID')
    directory = Path(os.getenv('PAYMENTS_PRIMARY_CACHE_DIR') or
                     str(Path(tempfile.gettempdir()) / 'payments-primary-models'))
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / (expected + '.joblib')
    if path.exists():
        with path.open('rb') as handle:
            if hashlib.file_digest(handle, 'sha256').hexdigest() == expected:
                return path
    base, secret = _get_configuration()
    parsed = urlsplit(base)
    if parsed.scheme != 'https' or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('PAYMENTS_MODEL_STORAGE_URL_INVALID')
    target = base + '/storage/v1/object/authenticated/' + quote(bucket, safe='') + '/' + quote(name, safe='/')
    body = bytearray()
    with httpx.Client(timeout=40, follow_redirects=False) as client:
        with client.stream('GET', target, headers=storage_headers(secret)) as response:
            response.raise_for_status()
            for chunk in response.iter_bytes():
                body.extend(chunk)
                if len(body) > 10 * 1024 * 1024:
                    raise ValueError('PAYMENTS_MODEL_SIZE_INVALID')
    if hashlib.sha256(body).hexdigest() != expected:
        raise ValueError('PAYMENTS_MODEL_DOWNLOAD_HASH_INVALID')
    temporary = directory / (expected + '.pending')
    temporary.write_bytes(body)
    temporary.replace(path)
    return path


def model_for_transaction(transaction_id, legacy_factory):
    if not enabled():
        return legacy_factory()
    value = metadata(transaction_id)
    if value['source_schema'] == 'LEGACY':
        return legacy_factory()
    return _model_for_metadata(value)


def _model_for_metadata(value):
    if (value['source_schema'] != 'PAYMENTS_SIMULATION_WORKBOOK' or value.get('state') != 'READY'):
        raise ValueError('PAYMENTS_PRIMARY_SOURCE_NOT_READY')
    key = (value['dataset_key'], value['model_sha256'])
    with _model_lock:
        if key not in _models:
            path = _private_artifact(value)
            _models[key] = load_payments_primary_model(path, value['model_sha256'], value['dataset_key'])
        return _models[key]


def model_for_source_binding(digest, dataset_key, bucket, name):
    """Reuse the hash-checked, locked Payments loader for an operator-pinned feed."""
    return _model_for_metadata({'source_schema': 'PAYMENTS_SIMULATION_WORKBOOK', 'state': 'READY',
                               'dataset_key': dataset_key, 'model_sha256': digest,
                               'model_bucket': bucket, 'model_object': name})
