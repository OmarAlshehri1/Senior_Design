"""Synthetic transport tests; these do not establish real antivirus readiness."""
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
from pathlib import Path
import sys

import httpx
import pytest

scripts = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(scripts))
spec = importlib.util.spec_from_file_location('evidence_worker_under_test', scripts / 'evidence_scan_worker.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    executable = tmp_path / 'scanner.exe'
    executable.write_bytes(b'synthetic engine, never executed')
    database = tmp_path / 'database'
    database.mkdir()
    (database / 'daily.cvd').write_bytes(b'synthetic fixture')
    config = dict(api_url='https://synthetic.invalid', project_ref='synthetic',
                  executable=str(executable), database=str(database))
    content = b'%PDF-1.7\nSynthetic\n%%EOF'
    metadata = dict(id='synthetic-id', file_size=len(content), file_name='synthetic.pdf',
                    mime_type='application/pdf', content_sha256=hashlib.sha256(content).hexdigest(),
                    lease_token='synthetic-lease',
                    lease_until=(datetime.now(timezone.utc) + timedelta(seconds=120)).isoformat())
    proof = dict(status='PASS_REAL_OFFICIAL_DATABASE_SCANS', engine_sha256='a'*64,
                 database={'main.cvd':'b'*64,'daily.cvd':'c'*64,'bytecode.cvd':'d'*64})
    calls = []
    state = dict(binding='synthetic', content=content, finish_status=200)
    def handler(request):
        calls.append(request)
        assert request.headers['authorization'] == 'Bearer SYNTHETIC_SCOPED_TOKEN'
        if request.url.path.endswith('/status'):
            return httpx.Response(200, json={'project_ref':state['binding'], 'bucket_private':True})
        if request.url.path.endswith('/claim'):
            return httpx.Response(200, json=metadata)
        if request.url.path.endswith('/content'):
            assert request.headers['x-scan-lease'] == metadata['lease_token']
            return httpx.Response(200, content=state['content'])
        if request.url.path.endswith('/finish'):
            import json
            body = json.loads(request.content)
            assert body['lease_token'] == metadata['lease_token']
            assert body['content_sha256'] == metadata['content_sha256']
            return httpx.Response(state['finish_status'], json={'scan_status':body['scan_status']})
        pytest.fail('Unexpected endpoint')
    worker = module.Worker(httpx.Client(transport=httpx.MockTransport(handler)), config,
                           'SYNTHETIC_SCOPED_TOKEN', ready=lambda *_:proof, memory=lambda:4*1024**3)
    monkeypatch.setattr(module, 'scan_clean_file', lambda *_:None)
    return worker, calls, state, metadata, proof


def test_clean_file_uses_bound_lease_and_scanner_proof(setup):
    worker, calls, *_ = setup
    assert worker.one()['status'] == 'CLEAN'
    assert [r.method for r in calls] == ['GET','POST','GET','POST']


def test_low_memory_prevents_all_network_requests(setup):
    worker, calls, *_ = setup
    worker.memory = lambda:1
    with pytest.raises(module.ScannerBlocked, match='RAM'):worker.one()
    assert calls == []


def test_failed_real_readiness_prevents_claim(setup):
    worker, calls, *_ = setup
    worker.ready = lambda *_:{'status':'NOT_VERIFIED'}
    with pytest.raises(module.ScannerBlocked, match='REAL_OFFICIAL'):worker.one()
    assert calls == []


def test_wrong_project_prevents_claim(setup):
    worker, calls, state, *_ = setup
    state['binding'] = 'another-project'
    with pytest.raises(module.ScannerBlocked, match='EXACT_PROJECT'):worker.one()
    assert len(calls) == 1


def test_digest_mismatch_retains_quarantine(setup, monkeypatch):
    worker, calls, state, *_ = setup
    state['content'] = b'changed'
    monkeypatch.setattr(module, 'scan_clean_file', lambda *_:pytest.fail('Do not scan altered object'))
    assert worker.one()['status'] == 'ERROR'


@pytest.mark.parametrize('code,expected', [('EVIDENCE_REJECTED_BY_SCANNER','INFECTED'),
                                         ('EVIDENCE_SCANNER_UNAVAILABLE','ERROR')])
def test_scanner_failure_never_marks_clean(setup, monkeypatch, code, expected):
    worker, *_ = setup
    def fail(*_):raise module.EvidenceError(code, 503)
    monkeypatch.setattr(module, 'scan_clean_file', fail)
    assert worker.one()['status'] == expected


def test_uncertain_finish_is_not_replayed(setup):
    worker, calls, state, *_ = setup
    state['finish_status'] = 503
    with pytest.raises(module.ScannerBlocked, match='NO_IMMEDIATE_RETRY'):worker.one()
    assert sum(r.url.path.endswith('/finish') for r in calls) == 1


def test_short_lease_prevents_download(setup):
    worker, calls, state, metadata, _ = setup
    metadata['lease_until'] = (datetime.now(timezone.utc)+timedelta(seconds=10)).isoformat()
    with pytest.raises(module.ScannerBlocked, match='INSUFFICIENT'):worker.one()
    assert len(calls) == 2


def test_real_readiness_is_cached_but_rechecked_on_database_change(setup):
    worker, _, _, _, proof = setup
    count = []
    worker.ready = lambda *_:(count.append(True) or proof)
    worker.scanner_ready();worker.scanner_ready()
    assert len(count) == 1
    (Path(worker.config['database'])/'daily.cvd').write_bytes(b'changed definitions')
    worker.scanner_ready()
    assert len(count) == 2
