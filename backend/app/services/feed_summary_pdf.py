"""Compact aggregate snapshot and complete bounded transaction schedule."""
from html import escape
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, LongTable, TableStyle, CondPageBreak

from app.services.business_report_pdf import _register_fonts
from app.services.feed_exception_pdf import display, label, timestamp


def build_summary_pdf(report):
    _register_fonts()
    output = BytesIO()
    size = landscape(A4)
    navy, muted, border = [colors.HexColor(c) for c in ('#173651', '#536779', '#dce4eb')]
    doc = SimpleDocTemplate(output, pagesize=size, leftMargin=36, rightMargin=36,
                            topMargin=43, bottomMargin=36, title='Feed audit summary',
                            author='Continuous Auditing System')
    styles = {
        'body': ParagraphStyle('SummaryBody', fontName='MemoVera', fontSize=7.5, leading=10,
                               textColor=navy, splitLongWords=True),
        'bold': ParagraphStyle('SummaryBold', fontName='MemoVeraBold', fontSize=7.5, leading=10,
                               textColor=navy),
        'title': ParagraphStyle('SummaryTitle', fontName='MemoVeraBold', fontSize=22, leading=27,
                                textColor=navy, spaceAfter=7),
        'section': ParagraphStyle('SummarySection', fontName='MemoVeraBold', fontSize=11, leading=15,
                                  textColor=navy, spaceBefore=8, spaceAfter=5, keepWithNext=True),
        'note': ParagraphStyle('SummaryNote', fontName='MemoVera', fontSize=7.5, leading=10,
                               textColor=muted, spaceAfter=5),
    }
    story = []

    def p(value, style='body'):
        return Paragraph(escape(display(value)).replace('\n', '<br/>'), styles[style])

    def section(text):
        story.append(p(text, 'section'))

    def table(rows, widths, header=True):
        cells = [[p(value, 'bold' if header and i == 0 else 'body') for value in row]
                 for i, row in enumerate(rows)]
        result = LongTable(cells, colWidths=widths, repeatRows=int(header), splitInRow=1, hAlign='LEFT')
        commands = [('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 7), ('RIGHTPADDING', (0, 0), (-1, -1), 7),
                    ('TOPPADDING', (0, 0), (-1, -1), 4), ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
                    ('LINEBELOW', (0, 0), (-1, -1), .4, border),
                    ('ROWBACKGROUNDS', (0, int(header)), (-1, -1),
                     [colors.white, colors.HexColor('#f5f8fb')])]
        if header:
            commands.append(('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8eff5')))
        result.setStyle(TableStyle(commands))
        story.append(result)

    story.extend([p('Feed audit summary', 'title'),
                  p(f"Saved-outcome snapshot | As of {timestamp(report['as_of'])}", 'note'),
                  p(f"Source: {report['source_id']} | Scope: {label(report['scope'])} | Team filter: {display(report.get('team_id'))}", 'note'),
                  p(f"Arrival period: {timestamp(report.get('period_start'))} (inclusive) to {timestamp(report.get('period_end'))} (exclusive)", 'note'),
                  p(f"Period basis: {label(report['period_basis'])}", 'note')])
    section('01  Processing and review')
    counts = list(report['counts'].items())
    count_rows = [['Measure', 'Count', 'Measure', 'Count']]
    for index in range(0, len(counts), 2):
        pair = counts[index:index+2]
        row = []
        for key, value in pair:
            row.extend([label(key), value])
        count_rows.append(row + (['—', '—'] if len(pair) == 1 else []))
    table(count_rows, [doc.width*.39, doc.width*.11, doc.width*.39, doc.width*.11])
    section('02  Amounts by currency')
    table([['Currency', 'Transactions', 'Amounts recorded', 'Recorded amount (exact)', 'Rule-failed amount (exact)']] + [
        [c.get('currency') or 'Unspecified', c.get('transactions'), c.get('amounts_recorded'),
         c.get('recorded_amount'), c.get('failed_recorded_amount')] for c in report['currencies']],
        [65, 85, 100, (doc.width-250)/2, (doc.width-250)/2])
    if 'departments' in report:
        section('03  Department / category breakdown')
        story.append(p(f"{len(report['departments'])} of {report['departments_group_count']} department/currency groups; "
                       f"largest {report['departments_limit']} maximum. Missing classifications are Uncategorized. "
                       'Currency amounts remain separate; flagged payments are not confirmed losses.', 'note'))
        table([['Department / category', 'Currency', 'Transactions', 'Processed', 'Flagged by rules',
                'Recorded amount (exact)', 'Rule-flagged amount (exact)']] + [
            [d['category'], d.get('currency') or 'Unspecified', d['transactions'], d['completed'],
             d['failed_transactions'], d.get('recorded_amount'), d.get('failed_recorded_amount')]
            for d in report['departments']], [doc.width*fraction for fraction in (.22, .08, .10, .10, .10, .20, .20)])
    section('04  Rule outcomes')
    table([['Rule', 'Passed', 'Failed', 'Not evaluated', 'Missing / unknown']] + [
        [label(r['rule_key']), r.get('passed'), r.get('failed'), r.get('not_evaluated'),
         r.get('missing_or_unknown')] for r in report['rules']],
        [doc.width-360, 80, 80, 100, 100])
    story.append(p('Evaluation clocks: ' + '; '.join(
        f"{label(c['time_basis'])}: {c['transactions']} transactions" for c in report['clocks']), 'note'))
    story.append(p('Scope: source reports include canonical transactions; team and Supervisor reports include only visible '
                   'rule-failed transactions. Pending validation receipts are excluded. Recorded amounts are not losses. '
                   'Currency totals remain separate; no currency conversion is applied. Rule failures and review decisions '
                   'are not confirmed fraud. Simulation inputs remain simulated. This is not an approved management memorandum.', 'note'))
    story.append(CondPageBreak(180))
    section('05  Transaction schedule')
    story.append(p(f"{len(report['schedule'])} of {report['counts']['transactions']} transactions shown; "
                   f"latest {report['schedule_limit']} maximum. "
                   'Aggregates above cover the entire authorized report population.', 'note'))
    story.append(p('A rule-failed transaction without a saved review starts in Open. A dash means not recorded. '
                   'The review column lists failure / review state, then decision / version (v). Amounts preserve exact stored precision.', 'note'))
    rows = [['Transaction ID / record / department', 'Amount / currency', 'Arrival (UTC)', 'Processing',
             'Rule failure / review', 'Assigned team']]
    for tx in report['schedule']:
        review = tx.get('review_status') or ('OPEN' if tx.get('failed') else None)
        decision = label(tx['resolution']) if tx.get('resolution') else '—'
        version = str(tx['version']) if tx.get('version') is not None else '—'
        rows.append([
            f"{tx['id']}\n{display(tx.get('record_id'))}\nDepartment / category: {tx.get('category') or 'Uncategorized'}",
            f"{display(tx.get('amount'))}\n{display(tx.get('currency'))}",
            timestamp(tx.get('received_at')),
            label(tx.get('job_status') or 'Not recorded'),
            f"{display(tx.get('failed'))} / {label(review) if review else '—'}\n{decision} / v{version}",
            tx.get('team_id') or '—',
        ])
    table(rows, [214, 104, 112, 78, 155, doc.width-663])

    def frame(canvas, document):
        canvas.saveState()
        canvas.setFont('MemoVeraBold', 8)
        canvas.setFillColor(navy)
        canvas.drawString(36, size[1]-24, 'CONTINUOUS AUDITING  /  FEED SUMMARY')
        canvas.setStrokeColor(border)
        canvas.line(36, 28, size[0]-36, 28)
        canvas.setFont('MemoVera', 7)
        canvas.setFillColor(muted)
        canvas.drawString(36, 17, 'Current saved snapshot | Review indicators are not confirmed fraud')
        canvas.drawRightString(size[0]-36, 17, f'Page {document.page}')
        canvas.restoreState()

    doc.build(story, onFirstPage=frame, onLaterPages=frame)
    return output.getvalue()
