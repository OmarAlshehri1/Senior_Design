from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from app.main import app
from app.services.identity import get_current_user
from app.services import business_reports as service
from app.api import business_reports as api
from app.repositories.identity import IdentityError


REPORT_ID = '10000000-0000-4000-8000-000000000001'


@pytest.fixture(autouse=True)
def no_live_report_provider(monkeypatch):
    monkeypatch.setenv('REPORT_GEMINI_ENABLED','false')


def source():
    transactions = []
    for index, (currency, amount, risk) in enumerate([('SAR', 500, 88), ('USD', 100, 60), ('SAR', None, None)]):
        transactions.append({
            'id': f'TX-{index}', 'timestamp': '2026-10-03T12:00:00Z', 'vendor_name': '=SUM(1,2)<script>alert(1)</script>',
            'amount': amount, 'currency': currency, 'data_quality_status': 'PARTIAL', 'missing_fields': ['approval_limit'],
            'evaluation_id': index+1, 'evaluation_version': '1.0.0', 'evaluated_at': '2026-10-10T00:00:00Z',
            'rule_results': [
                {'rule_key': 'ghost_vendors', 'rule_name': 'Ghost Vendors', 'rule_version': '1.0.0', 'status': 'FAILED', 'evidence': {'vendor_registered': False}},
                {'rule_key': 'duplicate_payment', 'rule_name': 'Duplicate Payments', 'rule_version': '1.0.0', 'status': 'FAILED'},
                {'rule_key': 'approval_limits', 'status': 'NOT_EVALUATED', 'evidence': {'missing_fields': ['approval_limit']}},
            ] if index<2 else [],
            'risk_snapshot_id': index+10, 'scoring_version': '1.0.0', 'calculated_at': '2026-10-11T00:00:00Z',
            'rule_evaluation_version': '1.0.0', 'anomaly_model_version': '1.0.0',
            'risk_score': risk, 'risk_level': 'HIGH' if index==0 else 'MEDIUM' if index==1 else None,
            'rule_score': 80 if risk else None, 'ai_score': 100 if risk else None,
        })
    return {'organization_name': '<Org & Co>', 'prepared_by': {'id': 'admin', 'name': 'Admin', 'role': 'ADMIN'},
            'scope': 'ORGANIZATION', 'team_id': None, 'team_name': None,
            'as_of': '2026-10-19T10:30:00Z', 'period_start': '2026-10-03T00:00:00Z', 'period_end': '2026-10-04T00:00:00Z',
            'undated_in_scope': 2, 'transactions': transactions,
            'alerts': [{'id': 'AL-1', 'transaction_id': 'TX-0', 'severity': 'HIGH', 'status': 'ACTIVE', 'created_at': '2026-10-05T00:00:00Z'}],
            'cases': [{'id': 'case-1', 'case_number': 1, 'transaction_id': 'TX-0', 'status': 'CLOSED', 'priority': 'HIGH',
                       'sla_status': 'COMPLETED', 'created_at': '2026-10-11T00:00:00Z', 'updated_at': '2026-10-19T00:00:00Z',
                       'closed_at': '2026-10-19T00:00:00Z', 'resolution_outcome': 'NO_ISSUE_FOUND'}]}


def report():
    return {'id': REPORT_ID, 'created_at': '2026-10-19T10:31:00Z',
            'document': service.build_document(source(), recipient='<Directors>', sender='System', data_context='DEMONSTRATION')}


def test_document_aggregates_stored_scores_without_double_counting_or_currency_conversion():
    evidence = source()
    snapshot = deepcopy(evidence)
    doc = service.build_document(evidence, recipient='Management', sender='System', data_context='DEMONSTRATION')
    m = doc['metrics']
    assert (m['total_transactions'], m['evaluated_transactions'], m['coverage_percent']) == (3, 2, '66.67')
    assert (m['unique_exception_transactions'], m['rule_failure_occurrences']) == (2, 4)
    assert m['unscored_transactions'] == 1
    assert m['average_risk_score'] == '74.00'
    assert m['amount_totals'] == [{'currency': 'SAR', 'amount': '500', 'transactions': 1}, {'currency': 'USD', 'amount': '100', 'transactions': 1}]
    assert m['high_risk_amount_totals'] == [{'currency': 'SAR', 'amount': '500', 'transactions': 1}]
    approval = next(r for r in doc['rules'] if r['key']=='approval_limits')
    assert approval['not_evaluated'] == 3
    assert approval['exclusions'] == {'MISSING_REQUIRED_FIELDS': 2, 'SNAPSHOT_OR_RULE_MISSING': 1}
    assert doc['approval_status'] == 'DRAFT'
    assert not any(doc['review'].values())
    assert evidence == snapshot


def test_empty_and_unscored_periods_do_not_claim_zero_risk_or_assurance():
    data = source()
    data.update(transactions=[], alerts=[], cases=[])
    doc = service.build_document(data, recipient='Management', sender='System', data_context='UNVERIFIED')
    assert doc['metrics']['coverage_percent'] is None
    assert doc['metrics']['average_risk_score'] is None
    assert 'No assurance' in doc['conclusion']
    assert not doc['recommendations']


def test_average_rounding_matches_postgres_half_up_without_recalculating_scores():
    data = source()
    data['transactions'][0].update(risk_score=1, risk_level='LOW')
    data['transactions'][1].update(risk_score=1.01, risk_level='LOW')
    doc = service.build_document(data, recipient='M', sender='S', data_context='UNVERIFIED')
    assert doc['metrics']['average_risk_score'] == '1.01'


def test_html_and_excel_keep_same_evidence_versions_dates_and_safe_text():
    saved = report()
    before = deepcopy(saved)
    html = service.render_business_html(saved)
    assert '<script>' not in html
    assert '&lt;Org &amp; Co&gt;' in html
    assert '&lt;Directors&gt;' in html
    for label in ['Terms of Reference', 'Procedure / Methodology', 'Findings', 'Conclusion', 'Recommendations', 'Review / Sign-off', 'Appendix D']:
        assert label in html
    assert '2026-10-19T10:30:00Z' in html
    assert '2026-10-03T00:00:00Z' in html
    assert 'not confirmed losses' in html
    book = load_workbook(BytesIO(service.build_business_workbook(saved)))
    assert book['Transactions']['D2'].value == 500
    assert book['Transactions']['E3'].value == 'USD'
    assert book['Transactions']['C2'].data_type == 's'
    assert book['Rule Evidence']['B2'].value == 1
    assert book['Cases']['H2'].value == '2026-10-19T00:00:00Z'
    assert len(book['Risk Distribution']._charts) == 1
    assert saved == before


def test_generation_fetches_authorized_source_and_persists_document_once(monkeypatch):
    calls = []
    def rpc(name, **kwargs):
        calls.append((name, kwargs))
        if name=='get_business_report_source':
            return source()
        return {'id': REPORT_ID, 'document': kwargs['p_document']}
    monkeypatch.setattr(service.identity, 'rpc', rpc)
    saved = service.generate_business_report(actor_id='admin', data_context='DEMONSTRATION')
    assert [name for name,_ in calls] == ['get_business_report_source', 'save_business_report']
    assert calls[0][1] == {'p_actor': 'admin', 'p_start': None}
    assert calls[1][1]['p_actor'] == 'admin'
    assert saved['document']['organization_name'] == '<Org & Co>'
    # Stored evidence must not be an alias of mutable source data.
    data = source()
    doc = service.build_document(data, recipient='M', sender='S', data_context='UNVERIFIED')
    data['transactions'][0]['risk_score'] = 0
    assert doc['evidence']['transactions'][0]['risk_score'] == 88


def test_generation_rejects_non_daily_period_before_database_access(monkeypatch):
    monkeypatch.setattr(service.identity, 'rpc', lambda *a, **k: pytest.fail('Unexpected database access'))
    with pytest.raises(ValueError):
        service.generate_business_report(actor_id='admin', period_start=datetime(2026,10,3,tzinfo=timezone.utc),
                                         period_end=datetime(2026,10,5,tzinfo=timezone.utc))


@pytest.mark.parametrize('role,status', [('AUDITOR',403),('SUPERVISOR',200),('ADMIN',200)])
def test_business_list_enforces_role_and_forwards_actor(monkeypatch, role, status):
    app.dependency_overrides[get_current_user] = lambda: {'id':'actor','role':role,'account_status':'ACTIVE'}
    monkeypatch.setattr(api, 'read_business_reports', lambda **kw: {'items': [], 'total': 0, 'actor': kw['actor_id']})
    response = TestClient(app).get('/api/v1/reports/business')
    assert response.status_code == status
    if status==200:
        assert response.json()['actor'] == 'actor'


def test_business_api_validates_periods_and_disallows_scope_injection(monkeypatch):
    monkeypatch.setattr(api, 'generate_business_report', lambda **kw: pytest.fail('Should not generate'))
    client = TestClient(app)
    for body in [{'period_start':'2026-10-03T00:00:00Z'}, {'team_id':'other'}, {'data_context':'FAKE'}, {'sender':'   '}]:
        assert client.post('/api/v1/reports/business', json=body).status_code == 422


def test_read_and_download_reauthorize_and_do_not_accept_arbitrary_ids(monkeypatch):
    calls = []
    def read(**kwargs):
        calls.append(kwargs)
        return report()
    monkeypatch.setattr(api, 'read_business_reports', read)
    client = TestClient(app)
    for format in ['html','xlsx','pdf']:
        response = client.get(f'/api/v1/reports/business/{REPORT_ID}/download?format={format}')
        assert response.status_code == 200
        assert response.headers['cache-control'] == 'no-store'
        assert format in response.headers['content-disposition']
        if format == 'pdf':
            assert response.headers['content-type'] == 'application/pdf'
            assert response.content.startswith(b'%PDF-')
    assert all(call['actor_id'] and call['report_id']==UUID(REPORT_ID) for call in calls)
    assert client.get('/api/v1/reports/business/invalid/download').status_code == 422
    assert client.get(f'/api/v1/reports/business/{REPORT_ID}/download?format=exe').status_code == 422
    monkeypatch.setattr(api, 'read_business_reports', lambda **kwargs: None)
    assert client.get(f'/api/v1/reports/business/{REPORT_ID}/download').status_code == 404
    assert client.get(f'/api/v1/reports/business/{REPORT_ID}/download?format=pdf').status_code == 404


def test_schema_unavailable_fails_without_creating_a_fake_report(monkeypatch):
    def unavailable(**kwargs):
        raise IdentityError('REPORT_SOURCE_UNAVAILABLE')
    monkeypatch.setattr(api, 'generate_business_report', unavailable)
    response = TestClient(app).post('/api/v1/reports/business',json={})
    assert response.status_code == 503
