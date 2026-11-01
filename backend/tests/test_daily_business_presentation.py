from copy import deepcopy
from io import BytesIO

from openpyxl import load_workbook
from pypdf import PdfReader

from app.services.business_reports import render_business_html, build_business_workbook
from app.services.business_report_pdf import build_business_pdf
from app.services.daily_business_presentation import supplier_rows, chart_values
from tests.test_business_reports import report


def test_daily_exports_use_saved_values_with_currencies_and_missing_values_separate():
    saved = report()
    before = deepcopy(saved)
    rows = supplier_rows(saved['document'])
    assert sum(r['count'] for r in rows) == 3
    assert {r['currency']: str(r['amount']) for r in rows} == {'SAR': '500', 'USD': '100'}
    assert sum(r['missing'] for r in rows) == 1
    assert chart_values(saved['document'], 'risk')['Not yet rated'] == 1
    html = render_business_html(saved)
    assert 'Supporting audit detail' not in html
    assert 'Detailed records and checks are available in the Excel download.' in html
    assert 'Checks were incomplete' in html
    assert 'SAR 500.00; USD 100.00' in html
    assert 'data-chart="issues"' in html
    assert 'Possible duplicate payments' in html
    assert 'Supplier Summary and Actions' in html
    book = load_workbook(BytesIO(build_business_workbook(saved)))
    assert book.sheetnames[0] == 'Daily Business Report'
    assert book['Daily Business Report']['B4'].value == 3
    assert len(book['Daily Business Report']._charts) == 2
    assert sum(row[1] for row in book['Risk Distribution'].iter_rows(min_row=2, values_only=True)) == 3
    assert book['Supplier Summary']['D2'].data_type == 'n'
    assert book['Supplier Summary']['A2'].data_type == 's'
    reader = PdfReader(BytesIO(build_business_pdf(saved)))
    text = '\n'.join(page.extract_text() for page in reader.pages)
    for label in ['Daily Business Report', 'Issues identified', 'Supplier Summary and Actions', 'Follow-up status']:
        assert label in text
    assert saved == before
