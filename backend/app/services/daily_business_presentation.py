"""Readable management summaries derived only from a saved report snapshot."""
from collections import Counter
from datetime import datetime, timezone
from decimal import Decimal
from html import escape


ISSUE_LABELS = {
    'invoice_splitting': 'Related invoices needing review',
    'duplicate_payment': 'Possible duplicate payments',
    'ghost_vendors': 'Supplier details needing checks',
    'segregation_of_duties': 'Approvals needing a second person',
    'approval_limits': 'Payments above approval limits',
}

ISSUE_ACTIONS = {
    'invoice_splitting': 'Check whether related invoices should have been approved together.',
    'duplicate_payment': 'Compare invoices and payment records to check whether a payment was repeated.',
    'ghost_vendors': 'Confirm the supplier is registered and active before making further payments.',
    'segregation_of_duties': 'Check that a different authorized person approved the transaction.',
    'approval_limits': 'Check that the approver had permission to approve this amount.',
}


def readable_date(value, *, include_time=False):
    date = datetime.fromisoformat(value.replace('Z', '+00:00')).astimezone(timezone.utc)
    return date.strftime('%d %B %Y, %H:%M UTC' if include_time else '%d %B %Y (UTC)')


def money(value):
    return f'{Decimal(str(value)):,.2f}'


def amount_label(totals):
    return '; '.join(f"{row['currency']} {money(row['amount'])}" for row in totals) or 'No recorded amounts'


def supplier_rows(document):
    """Separate currencies; never add different currencies or unknown amounts."""
    groups = {}
    for t in document['evidence']['transactions']:
        key = (t.get('vendor_name') or 'Supplier not recorded', t.get('currency') or 'Not recorded')
        row = groups.setdefault(key, {'supplier': key[0], 'currency': key[1], 'count': 0,
                                      'amount': Decimal(0), 'missing': 0, 'high': 0})
        row['count'] += 1
        row['high'] += t.get('risk_level') == 'HIGH'
        if t.get('amount') is None or not t.get('currency'):
            row['missing'] += 1
        else:
            row['amount'] += Decimal(str(t['amount']))
    return [groups[key] for key in sorted(groups)]


def chart_values(document, kind):
    if kind == 'issues':
        return {ISSUE_LABELS.get(r['key'], r['name']): r['failed'] for r in document['rules']}
    m = document['metrics']
    values = {label.title() + ' risk': count for label, count in m['risk_distribution'].items()}
    # Classification, not score presence, determines this chart's remainder.
    remainder = m['total_transactions'] - sum(values.values())
    if remainder:
        values['Not yet rated'] = remainder
    return values


def render_daily_overview(report):
    d, e = report['document'], lambda value: escape(str(value), quote=True)
    m = d['metrics']

    def p(value):
        return f'<p>{e(value)}</p>'

    def table(headers, rows):
        return '<table><thead><tr>' + ''.join(f'<th>{e(h)}</th>' for h in headers) + '</tr></thead><tbody>' + ''.join(
            '<tr>' + ''.join(f'<td>{e(v)}</td>' for v in row) + '</tr>' for row in rows) + '</tbody></table>'

    def chart(kind):
        values = chart_values(d, kind)
        maximum = max(1, *values.values())
        description = '; '.join(f'{label}: {count}' for label, count in values.items())
        return (f'<div class="bars" data-chart="{kind}" role="img" aria-label="{e(description)}">' +
                ''.join(f'<div>{e(label)}: {count}<span style="width:{count * 100 / maximum:.2f}%"></span></div>'
                        for label, count in values.items()) + '</div>')

    total, high = m['total_transactions'], m['risk_distribution']['HIGH']
    content = '<h1>Daily Business Report</h1>' + p(f"{d['organization_name']} | {readable_date(d['period_start'])}")
    content += p('Prepared for: ' + d['recipient'])
    if total:
        content += p(f"This report covers {total:,} {'transaction' if total == 1 else 'transactions'}, "
                     f"with a total recorded value of {amount_label(m['amount_totals'])}. "
                     f"Priority review is needed for {high:,} {'transaction' if high == 1 else 'transactions'}. "
                     f"The system flagged {m['unique_exception_transactions']:,} for at least one possible issue.")
    else:
        content += p('No transactions were recorded for this day within the area covered by this report. There are no results to assess.')
    content += table(['Transactions', 'Total value', 'High risk', 'High-risk value'], [[
        f"{m['total_transactions']:,}", amount_label(m['amount_totals']),
        f"{high:,} {'transaction' if high == 1 else 'transactions'}", amount_label(m['high_risk_amount_totals'])]])
    content += '<section><h2>Risk overview</h2>' + p('High risk: review first. Medium risk: review next. Low risk: lower priority, but issues may still exist. Not yet rated means a risk level is not available.') + chart('risk') + '</section>'
    content += '<section><h2>Issues identified</h2>' + p('These are possible issues to check, not confirmed mistakes. One transaction can appear under several issues.') + chart('issues') + '</section>'
    content += '<h2>Management focus</h2>' + p(
        f"Start with the {high} high-risk {'transaction' if high == 1 else 'transactions'}. Check the invoices, supplier details and approvals before deciding what action to take."
        if high else 'Check the possible issues listed and any incomplete checks before deciding whether follow-up is needed.')
    content += '<h2>Supplier Summary and Actions</h2>'
    content += table(['Supplier', 'Transactions', 'Total value', 'High risk'], [
        [r['supplier'], r['count'], f"{r['currency']} {money(r['amount'])}" if r['missing'] < r['count'] else 'Amount unavailable', r['high']]
        for r in supplier_rows(d)])
    if len({r['currency'] for r in supplier_rows(d)}) > 1:
        content += p('Different currencies are shown separately and are not added together.')
    content += '<h2>Recommended actions</h2>'
    content += table(['Issue', 'Affected transactions', 'Recommended action'], [
        [ISSUE_LABELS.get(r['key'], r['name']), r['failed'], ISSUE_ACTIONS[r['key']]] for r in d['rules'] if r['failed']])
    if not any(r['failed'] for r in d['rules']):
        content += p('No possible issues were flagged. Check whether any checks were incomplete before concluding that everything is in order.')
    alerts = Counter(a['status'] for a in d['evidence']['alerts'])
    content += '<h2>Follow-up status</h2>' + p('Status as of ' + readable_date(d['as_of'], include_time=True))
    content += table(['Open alerts', 'Reviewed alerts'], [[alerts['ACTIVE'], alerts['REVIEWED']]])
    content += p((f"Assign the {alerts['ACTIVE']} open {'alert' if alerts['ACTIVE'] == 1 else 'alerts'} for follow-up. " if alerts['ACTIVE'] else 'There are no open alerts in this report. ') + 'Reviewed means someone has checked the alert; it does not necessarily mean the issue is resolved.')
    content += '<h3>About this report</h3>'
    area = ('Organization transactions for the day.' if d['scope'] == 'ORGANIZATION' else
            f"Only transactions linked to alerts or cases assigned to {d.get('team_name') or 'your team'}; other transactions are excluded.")
    context = {'DEMONSTRATION': 'Demonstration only: these figures use test data.',
               'OPERATIONAL': 'The report requester identified these records as business data; their origin has not been independently checked.',
               'UNVERIFIED': 'The origin of these records has not been verified.'}.get(d['data_context'], 'The origin of these records has not been verified.')
    content += p(area + ' ' + context + ' Draft - please review before sharing.')
    if total and any(r['not_evaluated'] for r in d['rules']):
        content += p(f"Checks were incomplete: {m['evaluated_transactions']} of {total} transactions had at least one check completed, but not every check could be completed for every transaction. A zero issue count may mean a check was not completed.")
    if m['missing_amount_or_currency']:
        missing = m['missing_amount_or_currency']
        content += p(f"{missing} {'transaction has' if missing == 1 else 'transactions have'} an amount or currency missing and {'is' if missing == 1 else 'are'} excluded from value totals.")
    content += p('Amounts shown are transaction values, not confirmed losses. Follow-up status reflects the date shown above. Detailed records and checks are available in the Excel download.')
    return content
