import httpx
import pytest
from app.repositories import case_storage
from app.repositories.identity import IdentityError

@pytest.fixture
def storage(monkeypatch):
    monkeypatch.setattr(case_storage,'_get_configuration',lambda:('https://synthetic.supabase.invalid','sb_secret_SYNTHETIC'))
    original=httpx.Client
    def install(handler):
        monkeypatch.setattr(case_storage.httpx,'Client',lambda **kw:original(transport=httpx.MockTransport(handler),**kw))
    return install

def test_modern_and_legacy_headers():
    assert case_storage.server_headers('sb_secret_SYNTHETIC')=={'apikey':'sb_secret_SYNTHETIC'}
    assert case_storage.server_headers('synthetic.jwt.key')['Authorization']=='Bearer synthetic.jwt.key'

def test_private_download_auth_and_bytes(storage):
    def handle(request):
        assert request.url.host=='synthetic.supabase.invalid'
        assert request.headers['apikey']=='sb_secret_SYNTHETIC'
        assert 'authorization' not in request.headers
        return httpx.Response(200,content=b'%PDF-synthetic',headers={'Content-Type':'application/pdf'})
    storage(handle)
    assert case_storage.download('private','quarantine/case/file.pdf')==(b'%PDF-synthetic','application/pdf')

def test_oversized_download_fails_closed(storage):
    class Parts(httpx.SyncByteStream):
        def __iter__(self):
            yield b'x'*case_storage.MAX_EVIDENCE_BYTES
            yield b'overflow'
            pytest.fail('Must stop consuming oversized upstream data')
    storage(lambda request:httpx.Response(200,stream=Parts(),headers={'Content-Length':'1'}))
    with pytest.raises(IdentityError) as error:case_storage.download('private','quarantine/case/file.pdf')
    assert error.value.code=='EVIDENCE_STORAGE_INTEGRITY_ERROR'

def test_redirect_is_not_followed(storage):
    def handle(request):
        assert request.url.host=='synthetic.supabase.invalid'
        return httpx.Response(302,headers={'Location':'https://untrusted.invalid/steal'})
    storage(handle)
    with pytest.raises(IdentityError):case_storage.download('private','quarantine/case/file.pdf')

def test_public_bucket_is_not_accepted(storage):
    storage(lambda request:httpx.Response(200,json={'public':True}))
    assert case_storage.bucket_available('private') is False
