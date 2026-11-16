import hashlib
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from app.main import app
from app.services.identity import get_current_user
from app.services.case_evidence import EvidenceError, MAX_EVIDENCE_BYTES
from app.repositories.identity import IdentityError

CASE, EVIDENCE = str(uuid4()), str(uuid4())
CONTENT = b'%PDF-1.7\nsynthetic evidence'
DIGEST = hashlib.sha256(CONTENT).hexdigest()


@pytest.fixture
def fixture(monkeypatch):
    state = {'status':'PENDING', 'uploads':[], 'scans':0, 'finish':[]}
    monkeypatch.setattr('app.repositories.identity.request',lambda *a,**k:pytest.fail('Unmocked hosted persistence is forbidden'))
    monkeypatch.setenv('CASE_EVIDENCE_BUCKET','synthetic-private-evidence')
    monkeypatch.setenv('CASE_EVIDENCE_QUARANTINE_ENABLED','true')
    app.dependency_overrides[get_current_user] = lambda: {'id':'synthetic-actor','role':'AUDITOR','account_status':'ACTIVE'}
    def metadata():
        return dict(id=EVIDENCE,case_id=CASE,file_name='sample.pdf',file_size=len(CONTENT),mime_type='application/pdf',
                    content_sha256=DIGEST,storage_key='quarantine/synthetic/sample.pdf',scan_status=state['status'])
    monkeypatch.setattr('app.api.cases.case_storage.bucket_available',lambda _:True)
    monkeypatch.setattr('app.api.cases.cases.get_case',lambda **_: {'case':{'status':'OPEN'}})
    monkeypatch.setattr('app.api.cases.cases.record_evidence_rejection',lambda **_:None)
    monkeypatch.setattr('app.api.cases.cases.reserve_evidence',lambda **_:metadata())
    monkeypatch.setattr('app.api.cases.cases.evidence_for_scan',lambda **_:metadata())
    monkeypatch.setattr('app.api.cases.cases.get_evidence',lambda **_:metadata())
    monkeypatch.setattr('app.api.cases.case_storage.upload',lambda *args:state['uploads'].append(args))
    monkeypatch.setattr('app.api.cases.case_storage.download',lambda *args:(CONTENT,'application/pdf'))
    def finish(**kwargs):
        state['finish'].append(kwargs)
        state['status']=kwargs['status']
        return metadata()
    monkeypatch.setattr('app.api.cases.cases.finish_evidence_scan',finish)
    def scan(*args):
        state['scans']+=1
        raise EvidenceError('EVIDENCE_STORAGE_OR_SCANNER_UNAVAILABLE',503)
    monkeypatch.setattr('app.api.cases.scan_clean_file',scan)
    with TestClient(app) as client:
        yield client,state
    app.dependency_overrides.pop(get_current_user,None)


def upload(client,content=CONTENT):
    return client.post(f'/api/v1/cases/{CASE}/evidence?category=DOCUMENT',content=content,
                       headers={'X-File-Name':'sample.pdf','Content-Type':'application/pdf'})


def test_unavailable_scanner_retains_private_quarantine_and_blocks_download(fixture):
    client,state=fixture
    response=upload(client)
    assert response.status_code==202
    assert response.json()['scan_status']=='ERROR'
    assert 'storage_key' not in response.json()
    assert len(state['uploads'])==1
    assert client.get(f'/api/v1/cases/{CASE}/evidence/{EVIDENCE}').status_code==423


def test_retry_pass_releases_exact_bytes_for_authorized_download(fixture,monkeypatch):
    client,state=fixture
    upload(client)
    monkeypatch.setattr('app.api.cases.scan_clean_file',lambda *args:None)
    response=client.post(f'/api/v1/cases/{CASE}/evidence/{EVIDENCE}/scan')
    assert response.status_code==200 and state['status']=='CLEAN'
    result=client.get(f'/api/v1/cases/{CASE}/evidence/{EVIDENCE}')
    assert result.status_code==200 and result.content==CONTENT
    monkeypatch.setattr('app.api.cases.case_storage.download',lambda *args:(b'%PDF-tampered','application/pdf'))
    assert client.get(f'/api/v1/cases/{CASE}/evidence/{EVIDENCE}').status_code==503


def test_infected_object_stays_quarantined_without_rescan(fixture,monkeypatch):
    client,state=fixture
    monkeypatch.setattr('app.api.cases.scan_clean_file',lambda *args:(_ for _ in ()).throw(EvidenceError('EVIDENCE_REJECTED_BY_SCANNER',422)))
    assert upload(client).json()['scan_status']=='INFECTED'
    monkeypatch.setattr('app.api.cases.scan_clean_file',lambda *args:pytest.fail('Infected bytes must never be retried/released'))
    assert client.post(f'/api/v1/cases/{CASE}/evidence/{EVIDENCE}/scan').status_code==202
    assert client.get(f'/api/v1/cases/{CASE}/evidence/{EVIDENCE}').status_code==423


def test_oversized_upload_never_reaches_storage(fixture):
    client,state=fixture
    response=upload(client,b'%PDF-'+b'x'*MAX_EVIDENCE_BYTES)
    assert response.status_code==413 and not state['uploads']


def test_cross_case_scan_denial_occurs_before_storage(fixture,monkeypatch):
    client,_=fixture
    monkeypatch.setattr('app.api.cases.cases.evidence_for_scan',lambda **_:(_ for _ in ()).throw(IdentityError('FORBIDDEN',403)))
    monkeypatch.setattr('app.api.cases.case_storage.download',lambda *args:pytest.fail('Denied actor must not fetch bytes'))
    assert client.post(f'/api/v1/cases/{CASE}/evidence/{EVIDENCE}/scan').status_code==403


def test_upload_failure_keeps_reservation_non_downloadable(fixture,monkeypatch):
    client,state=fixture
    monkeypatch.setattr('app.api.cases.case_storage.upload',lambda *args:(_ for _ in ()).throw(IdentityError('EVIDENCE_STORAGE_UNAVAILABLE')))
    assert upload(client).status_code==503
    assert state['status']=='ERROR'
    assert client.get(f'/api/v1/cases/{CASE}/evidence/{EVIDENCE}').status_code==423


def test_external_worker_queues_upload_without_inline_engine(fixture,monkeypatch):
    client,state=fixture
    monkeypatch.setenv('CASE_SCANNER_TOKEN_SHA256','a'*64)
    queued=[]
    def queue(**kwargs):
        queued.append(kwargs)
        return {'id':EVIDENCE,'scan_status':'PENDING','storage_key':'private-path'}
    monkeypatch.setattr('app.api.cases.cases.queue_evidence_scan',queue)
    monkeypatch.setattr('app.api.cases.scan_clean_file',lambda *_:pytest.fail('Render must not load ClamAV in external mode'))
    result=upload(client)
    assert result.status_code==202 and result.json()['scan_status']=='PENDING'
    assert 'storage_key' not in result.json()
    assert len(queued)==1 and queued[0]['evidence_id']==EVIDENCE
    assert len(state['uploads'])==1 and state['scans']==0
    assert client.get(f'/api/v1/cases/{CASE}/evidence/{EVIDENCE}').status_code==423


def test_external_retry_queues_existing_bytes_without_downloading(fixture,monkeypatch):
    client,state=fixture
    monkeypatch.setenv('CASE_SCANNER_TOKEN_SHA256','a'*64)
    monkeypatch.setattr('app.api.cases.cases.queue_evidence_scan',lambda **_: {'id':EVIDENCE,'scan_status':'PENDING'})
    monkeypatch.setattr('app.api.cases.case_storage.download',lambda *_:pytest.fail('Only leased worker may download quarantined bytes'))
    result=client.post(f'/api/v1/cases/{CASE}/evidence/{EVIDENCE}/scan')
    assert result.status_code==202 and result.json()['scan_status']=='PENDING'
    assert state['scans']==0
