import pytest
from app.services import free_gemini as policy


@pytest.fixture
def verified(monkeypatch):
    monkeypatch.setenv('GEMINI_FREE_TIER_CONFIRMED','true')
    monkeypatch.setenv('GEMINI_FREE_PROJECT_ID','synthetic-free-project')
    monkeypatch.setenv('GEMINI_FREE_API_KEY','synthetic-free-key')
    monkeypatch.setenv('GEMINI_API_KEY','possibly-paid-key-must-not-be-used')
    monkeypatch.setattr(policy,'_blocked_until',0.0)


def test_verified_free_key_and_no_model_fallback(verified):
    assert policy.configuration('gemini-3.8-flash')=='synthetic-free-key'
    with pytest.raises(policy.FreeTierUnavailable,match='MODEL_NOT_APPROVED'):
        policy.configuration('gemini-4-carbon')


@pytest.mark.parametrize('setting,value',[
    ('GEMINI_FREE_TIER_CONFIRMED','false'),('GEMINI_FREE_PROJECT_ID',''),
    ('GEMINI_FREE_API_KEY',''),
])
def test_unverified_configuration_never_falls_back_to_generic_key(verified,monkeypatch,setting,value):
    monkeypatch.setenv(setting,value)
    with pytest.raises(policy.FreeTierUnavailable):
        policy.configuration('gemini-3.8-flash')


def test_quota_trip_stops_both_commentary_paths(verified):
    policy.quota_exhausted()
    with pytest.raises(policy.FreeTierUnavailable,match='FREE_QUOTA_EXHAUSTED'):
        policy.configuration('gemini-3.8-flash')


def test_owner_confirmation_does_not_expire_daily(verified,monkeypatch):
    monkeypatch.setenv('GEMINI_FREE_TIER_VERIFIED_UNTIL','2000-01-01T00:00:00Z')
    assert policy.configuration('gemini-3.8-flash')=='synthetic-free-key'


def test_quota_circuit_recovers_for_a_later_request_without_daily_confirmation(verified,monkeypatch):
    monkeypatch.setattr(policy.time,'monotonic',lambda:100.0)
    policy.quota_exhausted()
    assert policy._blocked_until==1000.0
    monkeypatch.setattr(policy.time,'monotonic',lambda:1001.0)
    assert policy.configuration('gemini-3.8-flash')=='synthetic-free-key'
