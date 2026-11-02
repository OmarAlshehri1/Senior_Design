from io import BytesIO

from openpyxl import load_workbook

from app.services.feed_summary_report import build_summary_export


def test_summary_formats_preserve_currency_totals_scope_and_missing_scores():
    report = {'as_of': '2026-10-24T00:00:00Z', 'source_id': '<script>SYNTHETIC</script>',
              'scope': 'SOURCE', 'period_basis': 'RECEIPT_ARRIVAL_INCLUSIVE_START_EXCLUSIVE_END',
              'counts': {'transactions': 2, 'combined_risk_scored': 0, 'combined_risk_unscored': 2},
              'currencies': [{'currency': 'USD', 'recorded_amount': '123456789012345678.01'},
                             {'currency': 'EUR', 'recorded_amount': '20.02'}],
              'rules': [{'rule_key': 'ghost_vendors', 'failed': 1, 'missing_or_unknown': 0}],
              'clocks': [{'time_basis': 'SIMULATED_ARRIVAL_TIME', 'transactions': 2}],
              'schedule': [{'id': 'SYNTHETIC', 'record_id': '=SUM(1,2)', 'amount': None}], 'schedule_limit': 100}
    html, _ = build_summary_export(report, 'html')
    assert '<script>' not in html
    assert '&lt;script&gt;' in html
    assert '1 of 2' in html
    assert '123456789012345678.01' in html
    payload, _ = build_summary_export(report, 'xlsx')
    sheet = load_workbook(BytesIO(payload), data_only=False).active
    values = {row[0].value: row[1].value for row in sheet.iter_rows()}
    assert values['USD: recorded_amount'] == '123456789012345678.01'
    assert values['EUR: recorded_amount'] == '20.02'
    assert values['record_id'] == '=SUM(1,2)'
    assert all(cell.data_type != 'f' for row in sheet.iter_rows() for cell in row)
    pdf, media = build_summary_export(report, 'pdf')
    assert pdf.startswith(b'%PDF-') and media == 'application/pdf'


def test_summary_pdf_keeps_all_schedule_rows_and_exact_amounts_compactly():
    from pypdf import PdfReader
    report = {
        'as_of': '2026-10-24T18:54:06Z', 'source_id': '<SYNTHETIC>', 'scope': 'SOURCE',
        'period_basis': 'RECEIPT_ARRIVAL_INCLUSIVE_START_EXCLUSIVE_END',
        'counts': {'transactions': 100, 'completed': 100, 'failed_transactions': 20,
                   'open_exceptions': 19, 'in_review': 1},
        'currencies': [{'currency': 'USD', 'transactions': 100, 'amounts_recorded': 100,
                        'recorded_amount': '809324.9099999999911',
                        'failed_recorded_amount': '565128.2099999999901'}],
        'rules': [{'rule_key': 'invoice_splitting', 'passed': 87, 'failed': 13,
                   'not_evaluated': 0, 'missing_or_unknown': 0}],
        'clocks': [{'time_basis': 'SIMULATED_ARRIVAL_TIME', 'transactions': 100}],
        'schedule_limit': 100,
        'schedule': [{'id': f'00000000-0000-0000-0000-{i:012d}',
                      'record_id': f'SIMULATED-prefix-workbook-row-{i}',
                      'amount': '27181.3300000000001', 'currency': 'USD',
                      'received_at': '2026-10-24T16:46:10Z', 'job_status': 'COMPLETED',
                      'failed': True, 'review_status': 'IN_REVIEW', 'resolution': None,
                      'version': 1, 'team_id': None} for i in range(100)],
    }
    pdf, _ = build_summary_export(report, 'pdf')
    reader = PdfReader(BytesIO(pdf))
    text = '\n'.join(page.extract_text() for page in reader.pages)
    assert len(reader.pages) < 15
    for row in report['schedule']:
        assert row['id'] in text
        assert row['record_id'] in text
    for token in ('809324.9099999999911', '565128.2099999999901', '27181.3300000000001',
                  '24 Oct 2026, 18:54:06 UTC', '100 of 100', 'In review', '<SYNTHETIC>'):
        assert token in text
    assert 'Transaction ID / record' in reader.pages[-1].extract_text()


def test_department_exports_are_readable_exact_and_do_not_execute_imported_labels():
    from pypdf import PdfReader
    report = {'as_of': '2026-11-02T00:00:00Z', 'source_id': 'Synthetic', 'scope': 'SOURCE',
              'period_basis': 'RECEIPT_ARRIVAL_INCLUSIVE_START_EXCLUSIVE_END',
              'counts': {'transactions': 2, 'completed': 1}, 'currencies': [], 'rules': [], 'clocks': [],
              'departments_limit': 100, 'departments_group_count': 2, 'departments_truncated': False,
              'departments': [
                  {'category': '=HYPERLINK("unsafe")', 'currency': 'USD', 'transactions': 1, 'completed': 1,
                   'failed_transactions': 0, 'recorded_amount': '123456789012345678.01', 'failed_recorded_amount': None},
                  {'category': 'Uncategorized', 'currency': 'EUR', 'transactions': 1, 'completed': 0,
                   'failed_transactions': 0, 'recorded_amount': '20.02', 'failed_recorded_amount': None}],
              'schedule': [{'id': 'SYNTHETIC', 'record_id': '=SUM(1,2)', 'category': None,
                            'amount': '123456789012345678.01', 'currency': 'USD'}], 'schedule_limit': 100}
    payload, _ = build_summary_export(report, 'xlsx')
    workbook = load_workbook(BytesIO(payload), data_only=False)
    assert workbook.sheetnames == ['Feed summary', 'Departments', 'Transactions']
    assert workbook['Departments']['A2'].value == '=HYPERLINK("unsafe")'
    assert workbook['Departments']['F2'].value == '123456789012345678.01'
    assert workbook['Transactions']['C2'].value == 'Uncategorized'
    assert workbook['Departments'].freeze_panes == 'A2'
    assert all(cell.data_type != 'f' for sheet in workbook for row in sheet for cell in row)
    pdf, _ = build_summary_export(report, 'pdf')
    text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(pdf)).pages)
    for expected in ('Department / category', 'Uncategorized', '123456789012345678.01', '20.02', '2 of 2 department/currency groups'):
        assert expected in text
