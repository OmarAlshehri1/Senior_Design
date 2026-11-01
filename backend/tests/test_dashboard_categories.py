import json

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.repositories import analytics, supabase_transactions as repository
from app.services.identity import get_current_user


def test_category_repository_forwards_actor_and_rejects_missing_results(monkeypatch):
    calls = []
    monkeypatch.setattr(analytics.identity, 'rpc', lambda name, **kw: calls.append((name, kw)) or {'items': [], 'total_transactions': 0})
    assert analytics.get_dashboard_categories(actor_id='actor')['items'] == []
    assert calls == [('get_dashboard_categories', {'p_actor': 'actor'})]
    monkeypatch.setattr(analytics.identity, 'rpc', lambda *args, **kw: None)
    with pytest.raises(analytics.identity.IdentityError):
        analytics.get_dashboard_categories(actor_id='actor')


@pytest.mark.parametrize('category,uncategorized', [('Procurement', False), ('a,b).or.("x"', False), (None, True)])
def test_transaction_category_filter_uses_exact_quoted_values(monkeypatch, category, uncategorized):
    params = {}
    monkeypatch.setenv('SUPABASE_URL', 'https://example.supabase.co')
    monkeypatch.setenv('SUPABASE_SECRET_KEY', 'test-only')

    class Response:
        headers = {'Content-Range': '*/0'}
        def raise_for_status(self):
            pass
        def json(self):
            return []

    class Client:
        def __init__(self, **kw):
            pass
        def __enter__(self):
            return self
        def __exit__(self, *args):
            pass
        def get(self, *args, **kw):
            params.update(kw['params'])
            return Response()

    monkeypatch.setattr(repository.httpx, 'Client', Client)
    rows, total = repository.list_transactions(category=category, uncategorized=uncategorized, page_size=6)
    assert rows == [] and total == 0
    assert params['limit'] == '6'
    if uncategorized:
        assert params['and'] == '(or(category.is.null,category.eq.""))'
        assert 'category' not in params
    else:
        assert params['category'] == 'eq.' + json.dumps(category)


def test_category_filter_api_validates_conflicts_and_forwards_server_query(monkeypatch):
    app.dependency_overrides[get_current_user] = lambda: {'id': 'actor', 'role': 'ADMIN', 'account_status': 'ACTIVE'}
    calls = []
    monkeypatch.setattr('app.api.transactions.list_transactions', lambda **kw: calls.append(kw) or ([], 0))
    try:
        client = TestClient(app)
        assert client.get('/api/v1/transactions?category=Purchasing&page_size=6').status_code == 200
        assert calls[-1]['category'] == 'Purchasing' and calls[-1]['page_size'] == 6
        assert client.get('/api/v1/transactions?uncategorized=true').status_code == 200
        assert calls[-1]['uncategorized'] is True
        count = len(calls)
        assert client.get('/api/v1/transactions?category=Purchasing&uncategorized=true').status_code == 422
        assert len(calls) == count
    finally:
        app.dependency_overrides.clear()
