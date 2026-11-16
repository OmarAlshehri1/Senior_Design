import importlib.util
from pathlib import Path
import smtplib

path = Path(__file__).resolve().parents[1]/'scripts/check_free_smtp_once.py'
spec = importlib.util.spec_from_file_location('smtp_check_under_test', path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Connection:
    def __init__(self, *args, **kwargs):
        assert args == ('smtp.gmail.com',465)
        assert kwargs['context'].check_hostname is True
        assert kwargs['timeout'] == 15
        self.logins = []
    def __enter__(self):return self
    def __exit__(self, *_):pass
    def ehlo(self):pass
    def login(self, address, password):self.logins.append((address,password))
    def sendmail(self, *_):raise AssertionError('No email permitted')

def test_authentication_only_uses_verified_tls_and_one_login():
    connections=[]
    def factory(*args, **kwargs):
        value=Connection(*args, **kwargs);connections.append(value);return value
    result=module.check('synthetic@gmail.com','abcd efgh ijkl mnop',factory)
    assert result['status']=='PASS_AUTH_ONLY_DELIVERY_NOT_VERIFIED'
    assert result['messages_sent']==0
    assert len(connections[0].logins)==1
    assert connections[0].logins[0][1]=='abcdefghijklmnop'

def test_ineligible_sender_never_connects():
    assert module.check('custom@example.com','a'*16,lambda *_:1)['login_requests']==0

def test_normal_password_format_is_not_sent():
    assert module.check('synthetic@gmail.com','short',lambda *_:1)['login_requests']==0

def test_authentication_rejection_stops_without_retry():
    class Rejected(Connection):
        def login(self,*_):raise smtplib.SMTPAuthenticationError(535,b'private response suppressed')
    result=module.check('synthetic@gmail.com','a'*16,Rejected)
    assert result['login_requests']==1
    assert result['status']=='STOP_AUTH_REJECTED_NO_RETRY'
    assert 'private response' not in str(result)
