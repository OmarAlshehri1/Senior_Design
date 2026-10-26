from datetime import datetime, timezone
from io import BytesIO
from zipfile import ZipFile

import pytest

from scripts.prepare_payments_system_import import adapt, cents, rows, shared_strings


USERS = {'AUD-15': {'ROLE': 'AUDITOR'}, 'SUP-03': {'ROLE': 'SUPERVISOR'}}


def payment(**changes):
    return {'SOURCE_ROW': '29999', 'CHECK DATE': '01/03/2022', 'AMOUNT': '57353.7',
            'APPROVAL_LIMIT': '50000', 'CREATED_BY': 'AUD-15', 'APPROVED_BY': 'SUP-03',
            'TRANSACTION_TIMEZONE': 'UTC', 'TRANSACTION_TIME': '0.5',
            'VENDOR_ID': 'V-0000001', 'VENDOR NAME': 'Example vendor', 'CURRENCY': 'USD',
            'INVOICE_NUMBER': 'PV001', 'VOUCHER NUMBER': 'PV001', 'CONTRACT NUMBER': 'DV',
            'TECHNICAL_VENDOR_ID': 'TV-0000001', **changes}


def test_adapter_preserves_provenance_and_does_not_create_auth_identities():
    record = payment()
    actual, amount, limit = adapt(record, 'workbook-hash', USERS)
    assert amount == 5735370 and limit == 5000000
    assert datetime.fromisoformat(actual['timestamp']) == datetime(2022, 1, 3, 12, tzinfo=timezone.utc)
    assert actual['created_by'] == 'AUD-15' and actual['approved_by'] == 'SUP-03'
    assert actual['category'] is None and actual['missing_fields'] == ['category']
    assert actual['data_quality_status'] == 'PARTIAL'
    assert actual['metadata']['source_amount_text'] == '57353.7'
    assert actual['metadata']['invoice_number_origin'] == 'VOUCHER_MAPPING_USER_DECLARED'
    assert set(actual['metadata']['simulation_fields']) == {'actors', 'approval_limit', 'vendor_registry', 'time'}
    assert record == payment()


def test_retries_keep_identity_but_distinct_source_rows_and_workbooks_do_not_merge():
    first = adapt(payment(), 'one', USERS)[0]['id']
    assert first == adapt(payment(), 'one', USERS)[0]['id']
    assert first != adapt(payment(SOURCE_ROW='30000'), 'one', USERS)[0]['id']
    assert first != adapt(payment(), 'two', USERS)[0]['id']


@pytest.mark.parametrize('change', [{'CREATED_BY': 'UNKNOWN'}, {'TRANSACTION_TIMEZONE': 'UNKNOWN'},
                                  {'TRANSACTION_TIME': '1.0'}, {'CHECK DATE': '2022'}])
def test_invalid_actor_date_or_clock_is_rejected(change):
    with pytest.raises((ValueError, KeyError)):
        adapt(payment(**change), 'one', USERS)


def test_cents_accepts_excel_float_noise_but_rejects_real_precision_loss():
    assert cents('10.09999999999999') == 1010
    with pytest.raises(ValueError, match='PRECISION'):
        cents('10.001')
    with pytest.raises(ValueError, match='RANGE'):
        cents('1000000000000')


def test_shared_strings_and_empty_cells_do_not_shift_reference_columns():
    content = BytesIO()
    prefix = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    with ZipFile(content, 'w') as book:
        book.writestr('xl/sharedStrings.xml', f'<sst xmlns="{prefix}"><si><t>AUD-15</t></si></sst>')
        book.writestr('xl/worksheets/sheet1.xml', f'<worksheet xmlns="{prefix}"><sheetData><row r="2"><c r="A2" t="s"><v>0</v></c><c r="C2"><v>50000</v></c></row></sheetData></worksheet>')
    content.seek(0)
    with ZipFile(content) as book:
        assert list(rows(book, 1, shared_strings(book))) == [(2, {'A': 'AUD-15', 'C': '50000'})]
