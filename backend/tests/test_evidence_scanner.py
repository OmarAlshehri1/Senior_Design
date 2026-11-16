import hashlib
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.repositories.identity import IdentityError

TOKEN = 'synthetic-scanner-token-with-sufficient-length'
CASE, EVIDENCE, LEASE = map(str, (uuid4(), uuid4(), uuid4()))
DATA = b'%PDF-synthetic'
DIGEST = hashlib.sha256(DATA).hexdigest()


@pytest.fixture
def scanner(monkeypatch):
    monkeypatch.setenv('CASE_EVIDENCE_QUARANTINE_ENABLED', 'true')
    monkeypatch.setenv('CASE_EVIDENCE_BUCKET', 'case-evidence-private')
    monkeypatch.setenv('CASE_SCANNER_TOKEN_SHA256', hashlib.sha256(TOKEN.encode()).hexdigest())
    monkeypatch.setenv('SUPABASE_URL', 'https://synthetic-project.supabase.co')
    calls = []
    metadata = dict(id=EVIDENCE, case_id=CASE, file_size=len(DATA), mime_type='application/pdf',
                    file_name='synthetic.pdf', content_sha256=DIGEST, scan_status='PENDING',
                    storage_key=f'quarantine/{CASE}/synthetic.pdf', lease_token=LEASE)
    def rpc(name, **values):
        calls.append((name, values))
        if name == 'finish_claimed_case_evidence_scan':
            return {'id': EVIDENCE, 'scan_status': values['p_status']}
        return dict(metadata)
    monkeypatch.setattr('app.api.evidence_scanner.identity.rpc', rpc)
    monkeypatch.setattr('app.api.evidence_scanner.case_storage.download', lambda *args: (DATA, 'application/pdf'))
    monkeypatch.setattr('app.api.evidence_scanner.case_storage.bucket_available', lambda *args: True)
    return TestClient(app), calls, metadata


def headers(**extra):
    return {'Authorization': 'Bearer ' + TOKEN, **extra}


def test_wrong_or_human_token_never_reaches_rpc(scanner):
    client, calls, _ = scanner
    for value in ({}, {'Authorization': 'Bearer synthetic-human-user-session'}):
        assert client.post('/api/v1/internal/evidence-scans/claim', headers=value).status_code == 401
    assert calls == []


def test_missing_config_is_fail_closed(scanner, monkeypatch):
    client, calls, _ = scanner
    monkeypatch.delenv('CASE_SCANNER_TOKEN_SHA256')
    assert client.post('/api/v1/internal/evidence-scans/claim', headers=headers()).status_code == 503
    assert calls == []


def test_status_and_claim_do_not_return_storage_path(scanner):
    client, calls, _ = scanner
    status = client.get('/api/v1/internal/evidence-scans/status', headers=headers()).json()
    assert status['project_ref'] == 'synthetic-project' and status['bucket_private'] is True
    job = client.post('/api/v1/internal/evidence-scans/claim', headers=headers()).json()
    assert job['id'] == EVIDENCE and 'storage_key' not in job


def test_content_requires_live_lease_and_exact_hash(scanner):
    client, calls, _ = scanner
    result = client.get(f'/api/v1/internal/evidence-scans/{EVIDENCE}/content', headers=headers(**{'X-Scan-Lease': LEASE}))
    assert result.status_code == 200 and result.content == DATA
    assert result.headers['cache-control'] == 'no-store'
    assert calls[-1] == ('read_claimed_case_evidence_scan', {'p_evidence': EVIDENCE, 'p_lease': LEASE})


def test_tampered_object_never_reaches_worker(scanner, monkeypatch):
    client, _, _ = scanner
    monkeypatch.setattr('app.api.evidence_scanner.case_storage.download', lambda *args: (b'tampered', 'application/pdf'))
    assert client.get(f'/api/v1/internal/evidence-scans/{EVIDENCE}/content', headers=headers(**{'X-Scan-Lease': LEASE})).status_code == 503


def test_wrong_case_path_is_denied(scanner):
    client, _, metadata = scanner
    metadata['storage_key'] = 'quarantine/another-case/file.pdf'
    assert client.get(f'/api/v1/internal/evidence-scans/{EVIDENCE}/content', headers=headers(**{'X-Scan-Lease': LEASE})).status_code == 503


def finish_body():
    return {'lease_token': LEASE, 'content_sha256': DIGEST, 'scan_status': 'CLEAN',
            'proof': {'engine_sha256': 'a' * 64, 'database': {name + '.cvd': 'b' * 64 for name in ('main', 'daily', 'bytecode')}}}


def test_finish_forwards_only_scoped_result(scanner):
    client, calls, _ = scanner
    response = client.post(f'/api/v1/internal/evidence-scans/{EVIDENCE}/finish', headers=headers(), json=finish_body())
    assert response.status_code == 200 and response.json()['scan_status'] == 'CLEAN'
    assert calls[-1][0] == 'finish_claimed_case_evidence_scan'
    assert 'p_actor' not in calls[-1][1]


def test_incomplete_signature_proof_is_rejected(scanner):
    client, calls, _ = scanner
    body = finish_body(); body['proof']['database'] = {'main.cvd': 'b' * 64}
    assert client.post(f'/api/v1/internal/evidence-scans/{EVIDENCE}/finish', headers=headers(), json=body).status_code == 422
    assert calls == []


def test_large_finish_body_is_bounded(scanner):
    client, calls, _ = scanner
    assert client.post(f'/api/v1/internal/evidence-scans/{EVIDENCE}/finish', headers=headers(), content=b'x' * 8193).status_code == 413
    assert calls == []


def test_lease_failure_is_not_retried(scanner, monkeypatch):
    client, calls, _ = scanner
    def denied(*args, **kwargs):
        calls.append(('failed', {})); raise IdentityError('CONFLICT', 409)
    monkeypatch.setattr('app.api.evidence_scanner.identity.rpc', denied)
    assert client.get(f'/api/v1/internal/evidence-scans/{EVIDENCE}/content', headers=headers(**{'X-Scan-Lease': LEASE})).status_code == 409
    assert len(calls) == 1
