"""Export one database-generated, currently authorized aggregate snapshot."""
from app.services.feed_exception_report import build_rows_export


def summary_rows(report):
    rows = [
        ['Feed audit summary', 'Live saved-outcome summary; not an approved management memorandum'],
        ['As of (UTC)', report['as_of']], ['Source', report['source_id']], ['Scope', report['scope']],
        ['Team filter', report.get('team_id')], ['Period start (inclusive)', report.get('period_start')],
        ['Period end (exclusive)', report.get('period_end')], ['Period basis', report['period_basis']],
        ['Population', 'SOURCE includes canonical transactions; team and Supervisor scopes include only visible rule-failed transactions. Pending validation receipts are excluded.'],
        ['Interpretation', 'Recorded payment amounts are not losses. Rule failures and review decisions are not confirmed fraud. Simulation clocks/references remain simulation inputs.'],
        ['Currency policy', 'Separate totals by currency. No conversion or cross-currency grand total.'],
    ]
    rows.extend([[f'Count: {key}', value] for key, value in report['counts'].items()])
    for currency in report['currencies']:
        label = currency['currency'] or 'UNSPECIFIED'
        for key, value in currency.items():
            if key != 'currency':
                rows.append([f'{label}: {key}', value])
    for rule in report['rules']:
        for key, value in rule.items():
            if key != 'rule_key':
                rows.append([f"{rule['rule_key']}: {key}", value])
    if 'departments' in report:
        rows.append(['Department breakdown', f"{len(report['departments'])} of {report['departments_group_count']} department/currency groups; largest {report['departments_limit']} maximum"])
        for department in report['departments']:
            prefix = f"Department {department['category']} / {department['currency'] or 'Unspecified'}"
            for key, title in [('transactions', 'Transactions'), ('completed', 'Processed'),
                               ('failed_transactions', 'Flagged by rules'), ('recorded_amount', 'Recorded amount'),
                               ('failed_recorded_amount', 'Rule-flagged recorded amount')]:
                rows.append([f'{prefix}: {title}', department.get(key)])
    for clock in report['clocks']:
        rows.append([f"Clock: {clock['time_basis']}", clock['transactions']])
    rows.append(['Schedule coverage', f"{len(report['schedule'])} of {report['counts']['transactions']} transactions; latest {report['schedule_limit']} maximum"])
    for transaction in report['schedule']:
        rows.append(['Transaction', transaction['id']])
        for key, value in transaction.items():
            if key != 'id':
                rows.append(['Department / category' if key == 'category' else key,
                             (value or 'Uncategorized') if key == 'category' else value])
    return [[str(key), 'Not recorded' if value is None else str(value)] for key, value in rows]


def build_summary_export(report, format):
    if format == 'pdf':
        from app.services.feed_summary_pdf import build_summary_pdf
        return build_summary_pdf(report), 'application/pdf'
    if format == 'xlsx':
        from io import BytesIO
        from openpyxl import load_workbook
        from openpyxl.styles import Alignment, Font, PatternFill
        content, media_type = build_rows_export(summary_rows(report), format, 'Feed audit summary', 'Feed summary')
        workbook = load_workbook(BytesIO(content))

        def table_sheet(title, headings, rows, widths):
            sheet = workbook.create_sheet(title)
            sheet.append(headings)
            for row in rows:
                sheet.append(['Not recorded' if value is None else value for value in row])
            for row in sheet.iter_rows():
                for cell in row:
                    if isinstance(cell.value, str):
                        cell.data_type = 's'  # Imported labels/references cannot become formulas.
                    cell.alignment = Alignment(wrap_text=True, vertical='top')
            for cell in sheet[1]:
                cell.font = Font(bold=True, color='FFFFFF')
                cell.fill = PatternFill('solid', fgColor='173651')
            for column, width in zip(sheet.iter_cols(min_row=1, max_row=1), widths):
                sheet.column_dimensions[column[0].column_letter].width = width
            sheet.freeze_panes = 'A2'
            sheet.auto_filter.ref = sheet.dimensions

        if 'departments' in report:
            table_sheet('Departments', ['Department / category', 'Currency', 'Transactions', 'Processed',
                        'Flagged by rules', 'Recorded amount (exact)', 'Rule-flagged amount (exact)'],
                        [[row.get(key) for key in ('category', 'currency', 'transactions', 'completed',
                          'failed_transactions', 'recorded_amount', 'failed_recorded_amount')]
                         for row in report['departments']], [32, 14, 16, 16, 20, 30, 30])
        table_sheet('Transactions', ['Transaction ID', 'Record', 'Department / category', 'Amount (exact)',
                    'Currency', 'Arrival (UTC)', 'Processing'],
                    [[row['id'], row.get('record_id'), row.get('category') or 'Uncategorized',
                      row.get('amount'), row.get('currency'), row.get('received_at'), row.get('job_status')]
                     for row in report['schedule']], [40, 40, 32, 30, 14, 30, 20])
        output = BytesIO()
        workbook.save(output)
        return output.getvalue(), media_type
    return build_rows_export(summary_rows(report), format, 'Feed audit summary', 'Feed summary')
