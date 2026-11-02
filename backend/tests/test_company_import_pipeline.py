"""Real Python API -> in-memory PostgreSQL -> real validation/audit workers.

Only identity is substituted. No HTTP provider, Supabase or business data is used.
"""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import subprocess
from threading import Lock
import time

from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.repositories import identity, ingestion
from app.services.identity import get_current_user
from app.services.ingestion_validation import validate_once
from app.services.feed_auditing import audit_once

BACKEND = Path(__file__).resolve().parents[1]


@pytest.fixture
def pipeline(monkeypatch):
    env = {**os.environ, 'IMPORT_FIXTURE_MODEL_HASH': hashlib.sha256((BACKEND/'models/isolation_forest_v1.joblib').read_bytes()).hexdigest()}
    process = subprocess.Popen(['node', str(BACKEND/'test-support/company-import-bridge.mjs')],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding='utf-8', env=env)
    ready_line = process.stdout.readline()
    if not ready_line:
        raise AssertionError(process.stderr.read())
    ready = json.loads(ready_line)
    lock = Lock()
    def rpc(name, payload=None, **kwargs):
        with lock:
            process.stdin.write(json.dumps({'name': name, 'payload': payload if payload is not None else kwargs})+'\n')
            process.stdin.flush()
            result = json.loads(process.stdout.readline())
        if 'error' in result:
            status = {'42501': 403, 'P0002': 404, '23505': 409, '22023': 422}.get(result.get('code'), 503)
            raise identity.IdentityError(result['error'], status)
        return result['result']
    monkeypatch.setattr(identity, 'rpc', rpc)
    monkeypatch.setattr(ingestion, 'rpc', rpc)
    for flag in ('COMPANY_IMPORTS_ENABLED', 'FEED_REVIEW_ENABLED', 'INGESTION_ENABLED', 'INGESTION_VALIDATION_ENABLED', 'INGESTION_AUDIT_ENABLED', 'INGESTION_FEED_ANOMALY_ENABLED'):
        monkeypatch.setenv(flag, 'true')
    actor = {'id': ready['admin'], 'role': 'ADMIN'}
    app.dependency_overrides[get_current_user] = lambda: actor
    try:
        yield TestClient(app), ready, actor
    finally:
        app.dependency_overrides.pop(get_current_user, None)
        process.stdin.close()
        process.wait(timeout=15)
        process.stdout.close()
        process.stderr.close()


def test_file_and_json_intake_reach_real_saved_audits_without_mixing_sources(pipeline):
    client, ready, actor = pipeline
    fields = ['reference', 'amount', 'currency', 'timestamp', 'vendor_id', 'vendor_name', 'invoice_number', 'created_by', 'approved_by', 'category', 'approver_role']
    original = ['ONLINE-1', '1000000000', 'SAR', '2026-01-02T12:00:00Z', 'V-UNKNOWN', 'Synthetic vendor', 'INV-1', 'ACTOR-1', 'ACTOR-1', 'Inventory', 'Manager']
    content = (','.join(fields)+'\n'+','.join(original)+'\n').encode()
    upload = client.post('/api/v1/company-imports/uploads?source_id=fixture-company&filename=synthetic.csv', content=content)
    assert upload.status_code == 201, upload.text
    batch = upload.json()['id']
    preview = client.post(f'/api/v1/company-imports/{batch}/preview', json={
        'source_id': 'fixture-company', 'identity_column': 'reference', 'mapping': ready['mapping']})
    assert preview.status_code == 200, preview.text
    assert preview.json()['counts']['REJECTED'] == 0
    start = time.perf_counter()
    confirmation = {'source_id': 'fixture-company', 'revision': preview.json()['revision'], 'profile_name': 'Synthetic CSV'}
    result = client.post(f'/api/v1/company-imports/{batch}/confirm', json=confirmation)
    assert result.status_code == 200, result.text
    assert result.json()['inserted'] == 1
    assert asyncio.run(validate_once()) == 1
    assert asyncio.run(audit_once()) == 1
    elapsed = time.perf_counter()-start
    progress = client.get(f'/api/v1/company-imports/{batch}/progress?source_id=fixture-company').json()
    assert progress['completed'] == 1 and progress['pending'] == 0
    assert client.post(f'/api/v1/company-imports/{batch}/confirm', json=confirmation).json()['inserted'] == 1
    rows = client.get('/api/v1/feed-review/transactions?source_id=fixture-company').json()
    assert rows['total'] == 1
    row = rows['items'][0]
    assert row['coverage']['evaluated'] == 5
    assert row['risk_score'] is not None
    alerts = identity.rpc('fixture_alert_summary', p_source='fixture-company')
    assert alerts['alerts'] == 1
    assert float(alerts['maximum_receipt_to_alert_ms']) >= 0
    print(json.dumps({'check': 'single_synthetic_csv_confirm_to_saved_audit', 'seconds': elapsed,
        'coverage': row['coverage'], 'risk_level': row['risk_level'], 'persisted_alert': alerts,
        'limit': 'Local observation, not hosted S4 or notification-delivery proof.'}))
    # A company without reference/model approval still imports, with truthful null risk.
    second = client.post('/api/v1/company-imports/uploads?source_id=unapproved-company&filename=synthetic.csv', content=content).json()['id']
    second_preview = client.post(f'/api/v1/company-imports/{second}/preview', json={
        'source_id': 'unapproved-company', 'identity_column': 'reference', 'mapping': ready['mapping']}).json()
    assert client.post(f'/api/v1/company-imports/{second}/confirm', json={
        'source_id': 'unapproved-company', 'revision': second_preview['revision']}).status_code == 200
    assert asyncio.run(validate_once()) == 1
    assert asyncio.run(audit_once()) == 1
    unapproved = client.get('/api/v1/feed-review/transactions?source_id=unapproved-company').json()['items'][0]
    assert unapproved['risk_score'] is None
    assert unapproved['coverage']['evaluated'] == 0
    assert client.get('/api/v1/feed-review/transactions?source_id=fixture-company').json()['total'] == 1
    # Existing producer authentication submits JSON into the same workers.
    event = {'schema_version': '1.0', 'source_id': 'fixture-company', 'event_id': 'JSON-1', 'record_id': 'JSON-1',
        'event_type': 'transaction.created', 'original_record': dict(zip(fields, original))}
    response = client.post('/api/v1/ingestion/events', json=event, headers={'Authorization': 'Bearer '+'j'*43})
    assert response.status_code == 202, response.text
    assert asyncio.run(validate_once()) == 1
    assert asyncio.run(audit_once()) == 1
    assert client.get('/api/v1/feed-review/transactions?source_id=fixture-company').json()['total'] == 2
    assert client.post('/api/v1/ingestion/events', json=event, headers={'Authorization': 'Bearer '+'j'*43}).status_code == 200
    actor['role'] = 'AUDITOR'
    assert client.get('/api/v1/company-imports/history?source_id=fixture-company').status_code == 403
    actor['role'] = 'ADMIN'
    # Real HTTP path at the new limit. Audit work stays queued, not benchmarked.
    large = ('reference,Value,CCY,Description\n' + ''.join(
        f'LARGE-{index:05d},100.01,USD,'+'x'*110+'\n' for index in range(50000))).encode()
    assert len(large) > 5*1024*1024
    large_upload = client.post('/api/v1/company-imports/uploads?source_id=unapproved-company&filename=large.csv', content=large)
    assert large_upload.status_code == 201, large_upload.text
    large_id = large_upload.json()['id']
    assert large_upload.json()['total'] == 50000
    large_preview = client.post(f'/api/v1/company-imports/{large_id}/preview', json={
        'source_id': 'unapproved-company', 'identity_column': 'reference',
        'mapping': {'schema_version': '1.0', 'supported_currencies': ['USD'],
            'fields': {'amount': {'path': ['Value']}, 'currency': {'path': ['CCY']}}}})
    assert large_preview.status_code == 200, large_preview.text
    assert large_preview.json()['counts']['PARTIAL'] == 50000
    large_confirm = client.post(f'/api/v1/company-imports/{large_id}/confirm', json={
        'source_id': 'unapproved-company', 'revision': large_preview.json()['revision']})
    assert large_confirm.status_code == 200, large_confirm.text
    assert large_confirm.json() == {'inserted': 50000, 'duplicates': 0}
    large_progress = client.get(f'/api/v1/company-imports/{large_id}/progress?source_id=unapproved-company').json()
    assert large_progress['total'] == 50000 and large_progress['pending'] == 50000
