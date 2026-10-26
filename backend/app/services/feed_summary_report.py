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
    for clock in report['clocks']:
        rows.append([f"Clock: {clock['time_basis']}", clock['transactions']])
    rows.append(['Schedule coverage', f"{len(report['schedule'])} of {report['counts']['transactions']} transactions; latest {report['schedule_limit']} maximum"])
    for transaction in report['schedule']:
        rows.append(['Transaction', transaction['id']])
        for key, value in transaction.items():
            if key != 'id':
                rows.append([key, value])
    return [[str(key), 'Not recorded' if value is None else str(value)] for key, value in rows]


def build_summary_export(report, format):
    if format == 'pdf':
        from app.services.feed_summary_pdf import build_summary_pdf
        return build_summary_pdf(report), 'application/pdf'
    return build_rows_export(summary_rows(report), format, 'Feed audit summary', 'Feed summary')
