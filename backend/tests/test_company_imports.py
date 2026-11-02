from io import BytesIO
from zipfile import ZipFile, ZIP_DEFLATED
import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.main import app
from app.api import company_imports as api
from app.services.company_imports import MAX_FILE, MAX_ROWS, parse_file, build_preview, ImportProblem
from app.services.ingestion_mapping import MappingConfiguration
from app.services.identity import get_current_user


def mapping(**fields):
    return MappingConfiguration.model_validate({"schema_version": "1.0", "supported_currencies": ["USD"],
        "fields": fields or {"amount": {"path": ["Value"]}, "currency": {"path": ["CCY"]}}})


def xlsx(rows):
    workbook = Workbook()
    for row in rows:
        workbook.active.append(row)
    buffer = BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


def test_csv_mapping_preserves_money_and_leading_zero_identity():
    document = parse_file(b'ID,Value,CCY\n001,123456789012345.12,USD\n', 'payments.csv')
    preview = build_preview(document, mapping(), 'ID')
    assert preview['rows'][0]['record_id'] == '001'
    assert preview['examples'][0]['canonical']['amount'] == '123456789012345.12'
    assert preview['counts']['REJECTED'] == 0
    assert preview['examples'][0]['canonical']['approved_by'] is None


def test_xlsx_uses_numeric_xml_lexeme_and_sheet_names():
    original = xlsx([['ID', 'Value', 'CCY'], ['001', 12.5, 'USD']])
    source, target = BytesIO(original), BytesIO()
    with ZipFile(source) as zin, ZipFile(target, 'w', ZIP_DEFLATED) as zout:
        for member in zin.infolist():
            content = zin.read(member.filename)
            if member.filename == 'xl/worksheets/sheet1.xml':
                content = content.replace(b'<v>12.5</v>', b'<v>123456789012345.123456</v>')
            zout.writestr(member, content)
    document = parse_file(target.getvalue(), 'payments.xlsx')
    assert document['sheets'] == ['Sheet']
    assert document['records'][0]['record']['Value'] == '123456789012345.123456'
    assert document['records'][0]['record']['ID'] == '001'
    with pytest.raises(ImportProblem):
        parse_file(target.getvalue(), 'payments.xlsx', 'Missing')


@pytest.mark.parametrize('content,name', [(b'A,A\n1,2', 'x.csv'), (b'A,\n1,2', 'x.csv'),
    (b'A,B\n1', 'x.csv'), (b'\xff\xfe', 'x.csv'), (b'\x00', 'x.csv'),
    (b'text', 'x.pdf'), (b'text', 'x.xlsx'), (b'A\n', 'x.csv')])
def test_invalid_and_oversized_tables_rejected(content, name):
    with pytest.raises(ImportProblem):
        parse_file(content, name)


def test_more_than_maximum_rows_is_rejected():
    with pytest.raises(ImportProblem, match='50,000'):
        parse_file(b'A\n'+b'1\n'*(MAX_ROWS+1), 'x.csv')


def test_formula_rejected_even_when_workbook_has_cached_values():
    with pytest.raises(ImportProblem, match='formulas'):
        parse_file(xlsx([['ID', 'Value'], ['001', '=1+1']]), 'x.xlsx')


def test_file_over_the_new_byte_limit_is_rejected():
    with pytest.raises(ImportProblem, match='25 MiB'):
        parse_file(b'x'*(MAX_FILE+1), 'large.csv')


def test_single_row_must_fit_the_durable_ingestion_envelope():
    headers = ','.join(f'column{i}' for i in range(20))
    row = ','.join('x'*14000 for _ in range(20))
    with pytest.raises(ImportProblem, match='too large for a transaction receipt'):
        parse_file((headers+'\n'+row+'\n').encode(), 'wide.csv')


def test_capabilities_expose_the_actual_parser_limits(session):
    client, _, _ = session
    capability = client.get('/api/v1/company-imports/capabilities').json()
    assert capability['max_rows'] == MAX_ROWS == 50000
    assert capability['max_bytes'] == MAX_FILE == 25*1024*1024


def test_full_size_csv_over_old_byte_limit_is_parsed_and_previewed():
    lines = ['ID,Value,CCY,Description']
    lines.extend(f'BULK-{index:05d},100.01,USD,'+'x'*110 for index in range(MAX_ROWS))
    content = ('\n'.join(lines)+'\n').encode()
    assert len(content) > 5*1024*1024
    document = parse_file(content, 'large.csv')
    result = build_preview(document, mapping(), 'ID')
    assert len(document['records']) == MAX_ROWS
    assert result['counts']['PARTIAL'] == MAX_ROWS
    assert result['counts']['REJECTED'] == 0
    assert len(result['examples']) == 10
    assert result['rows'][-1]['record_id'] == 'BULK-49999'


def test_full_size_xlsx_preserves_numeric_values():
    workbook = Workbook(write_only=True)
    sheet = workbook.create_sheet('Transactions')
    sheet.append(['ID', 'Value', 'CCY'])
    for index in range(MAX_ROWS):
        sheet.append([f'XLSX-{index:05d}', 100.01, 'USD'])
    buffer = BytesIO()
    workbook.save(buffer)
    document = parse_file(buffer.getvalue(), 'large.xlsx', 'Transactions')
    assert len(document['records']) == MAX_ROWS
    assert document['records'][0]['record']['Value'] == '100.01'
    assert document['records'][-1]['record']['ID'] == 'XLSX-49999'


def test_native_excel_date_only_does_not_invent_a_timezone():
    from datetime import date
    document = parse_file(xlsx([['ID', 'Date'], ['001', date(2026, 1, 2)]]), 'x.xlsx')
    assert document['records'][0]['record']['Date'] == '2026-01-02'
    configuration = mapping(timestamp={'path': ['Date'], 'time': {'precision': 'date', 'format': '%Y-%m-%d'}})
    result = build_preview(document, configuration, 'ID')
    assert result['examples'][0]['canonical']['timestamp'] is None
    assert result['examples'][0]['canonical']['source_date'] == '2026-01-02'
    assert result['counts']['REJECTED'] == 0


@pytest.mark.parametrize('values', ['001,wrong,USD', '001,-1,USD', '001,1,BAD', ',1,USD', 'bad id,1,USD'])
def test_bad_values_and_identifiers_cannot_be_confirmed(values):
    preview = build_preview(parse_file(('ID,Value,CCY\n'+values+'\n').encode(), 'x.csv'), mapping(), 'ID')
    assert preview['counts']['REJECTED'] == 1
    assert preview['issues'][0]['row'] == 2


def test_repeated_reference_rejected_and_revision_binds_mapping():
    document = parse_file(b'ID,Value,CCY\n001,1,USD\n001,2,USD\n', 'x.csv')
    assert build_preview(document, mapping(), 'ID')['counts']['REJECTED'] == 1
    changed = mapping(amount={'path': ['Value']})
    assert build_preview(document, mapping(), 'ID')['revision'] != build_preview(document, changed, 'ID')['revision']


@pytest.fixture
def session(monkeypatch):
    user = {'id': '10000000-0000-4000-8000-000000000001', 'role': 'ADMIN'}
    for flag in ('COMPANY_IMPORTS_ENABLED', 'INGESTION_ENABLED', 'INGESTION_VALIDATION_ENABLED', 'INGESTION_AUDIT_ENABLED', 'FEED_REVIEW_ENABLED'):
        monkeypatch.setenv(flag, 'true')
    app.dependency_overrides[get_current_user] = lambda: user
    calls = []
    def rpc(name, **payload):
        calls.append((name, payload))
        return [] if name == 'list_company_import_sources' else {}
    monkeypatch.setattr(api.identity, 'rpc', rpc)
    yield TestClient(app), user, calls
    app.dependency_overrides.pop(get_current_user, None)


def test_non_admin_and_disabled_imports_make_no_storage_calls(session, monkeypatch):
    client, user, calls = session
    user['role'] = 'SUPERVISOR'
    assert client.get('/api/v1/company-imports/sources').status_code == 403
    assert calls == []
    user['role'] = 'ADMIN'
    monkeypatch.setenv('COMPANY_IMPORTS_ENABLED', 'false')
    assert client.get('/api/v1/company-imports/capabilities').json()['enabled'] is False
    assert client.get('/api/v1/company-imports/sources').status_code == 404
    assert calls == []


def test_upload_checks_source_permission_before_parsing(session, monkeypatch):
    client, _, _ = session
    def denied(*args, **kwargs):
        raise api.identity.IdentityError('FORBIDDEN', 403)
    monkeypatch.setattr(api.identity, 'rpc', denied)
    response = client.post('/api/v1/company-imports/uploads?source_id=outside&filename=x.pdf', content=b'bad')
    assert response.status_code == 403


def test_upload_only_persists_draft_not_receipts(session, monkeypatch):
    client, _, calls = session
    def rpc(name, **payload):
        calls.append((name, payload))
        return '10000000-0000-4000-8000-000000000002' if name == 'store_company_import' else {}
    monkeypatch.setattr(api.identity, 'rpc', rpc)
    response = client.post('/api/v1/company-imports/uploads?source_id=A&filename=x.csv', content=b'ID,Value\n001,1\n')
    assert response.status_code == 201
    assert [name for name, _ in calls] == ['company_import_history', 'store_company_import']
    assert response.json()['sample'][0]['record']['ID'] == '001'


def test_confirmation_does_not_accept_client_records_or_scores(session):
    client, _, calls = session
    response = client.post('/api/v1/company-imports/10000000-0000-4000-8000-000000000002/confirm', json={
        'source_id': 'A', 'revision': 'a'*64, 'rows': [], 'risk_score': 0})
    assert response.status_code == 422
    assert calls == []
