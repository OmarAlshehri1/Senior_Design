"""Readable saved-exception PDF; no network assets or changes to audit evidence."""
from datetime import datetime, timezone
from html import escape
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, LongTable, TableStyle, PageBreak

from app.services.business_report_pdf import _register_fonts


def label(value):
    return str(value).replace('_', ' ').capitalize()


def display(value):
    if value is None or value == '':
        return 'Not recorded'
    if isinstance(value, bool):
        return 'Yes' if value else 'No'
    if isinstance(value, list):
        return '; '.join(display(item) for item in value) or 'None'
    if isinstance(value, dict):
        return '; '.join(f'{label(key)}: {display(item)}' for key, item in value.items()) or 'None'
    return str(value)


def timestamp(value):
    if not value:
        return 'Not recorded'
    try:
        point = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if point.tzinfo is not None:
            return point.astimezone(timezone.utc).strftime('%d %b %Y, %H:%M:%S UTC')
    except (ValueError, TypeError):
        pass
    return str(value)


def build_exception_pdf(record):
    _register_fonts()
    output = BytesIO()
    navy = colors.HexColor('#173651')
    muted = colors.HexColor('#536779')
    border = colors.HexColor('#dce4eb')
    styles = {
        'body': ParagraphStyle('ExceptionBody', fontName='MemoVera', fontSize=8.5, leading=12,
                               textColor=navy, splitLongWords=True),
        'title': ParagraphStyle('ExceptionTitle', fontName='MemoVeraBold', fontSize=23, leading=28,
                                textColor=navy, spaceAfter=8),
        'section': ParagraphStyle('ExceptionSection', fontName='MemoVeraBold', fontSize=12, leading=16,
                                  textColor=navy, spaceBefore=14, spaceAfter=7, keepWithNext=True),
        'muted': ParagraphStyle('ExceptionMuted', fontName='MemoVera', fontSize=8, leading=11,
                                textColor=muted, spaceAfter=7),
        'bold': ParagraphStyle('ExceptionBold', fontName='MemoVeraBold', fontSize=8.5, leading=12,
                               textColor=navy),
    }
    doc = SimpleDocTemplate(output, pagesize=A4, leftMargin=40, rightMargin=40,
                            topMargin=49, bottomMargin=44, title='Feed exception evidence',
                            author='Continuous Auditing System')
    story = []

    def p(value, style='body'):
        return Paragraph(escape(display(value)).replace('\n', '<br/>'), styles[style])

    def section(title):
        story.append(p(title, 'section'))

    def table(rows, widths, header=False):
        rendered = [[p(cell, 'bold' if header and i == 0 else 'body')
                     for cell in row] for i, row in enumerate(rows)]
        result = LongTable(rendered, colWidths=widths, repeatRows=int(header), splitInRow=1,
                           hAlign='LEFT')
        commands = [('VALIGN', (0, 0), (-1, -1), 'TOP'),
                    ('LEFTPADDING', (0, 0), (-1, -1), 9), ('RIGHTPADDING', (0, 0), (-1, -1), 9),
                    ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
                    ('LINEBELOW', (0, 0), (-1, -1), .4, border),
                    ('ROWBACKGROUNDS', (0, int(header)), (-1, -1),
                     [colors.white, colors.HexColor('#f5f8fb')])]
        if header:
            commands.append(('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#e8eff5')))
        result.setStyle(TableStyle(commands))
        story.append(result)

    def pairs(rows):
        table(rows, [155, doc.width - 155])

    review = record['review']
    story.extend([p('Feed exception evidence', 'title'),
                  p('One saved transaction | Current review snapshot', 'muted'),
                  p(f"Generated {timestamp(datetime.now(timezone.utc).isoformat())}", 'muted')])
    section('01  Transaction and review')
    pairs([
        ('Vendor', record.get('vendor_name')),
        ('Payment / currency', f"{display(record.get('amount'))} {display(record.get('currency'))}"),
        ('Invoice', record.get('invoice_number')),
        ('Review status / version', f"{label(review['status'])} / {review['version']}"),
        ('Resolution / team', f"{label(review['resolution']) if review.get('resolution') else 'Not decided'} / {display(review.get('team_id'))}"),
        ('Transaction ID', record['id']), ('Source / record', f"{record['source_id']} / {record['record_id']}"),
        ('Original day / timestamp', f"{display(record.get('source_date'))} / {timestamp(record.get('transaction_timestamp'))}"),
        ('Receipt arrival', timestamp(record.get('received_at'))),
        ('Evaluated at', timestamp(record.get('evaluated_at'))),
        ('Evaluation clock', label(record.get('time_basis') or 'Not recorded')),
        ('Verified approval limit', f"{display(record.get('verified_approval_limit'))} {display(record.get('currency'))}"),
    ])
    section('02  Saved rule results')
    table([['Rule', 'Result', 'Explanation']] + [
        [label(rule['rule_key']), label(rule['status']), rule.get('detail')]
        for rule in record.get('rules') or []], [107, 75, doc.width - 182], header=True)
    story.append(Spacer(1, 9))
    story.append(p('Rule failures and review decisions are not confirmed fraud. Simulated references and '
                   'arrival timing remain simulation inputs. This snapshot is not an approved memorandum.', 'muted'))
    story.append(PageBreak())
    section('03  Supporting evidence')
    pairs([('Coverage', display(record.get('coverage'))),
           ('Combined risk', record.get('risk_score')),
           ('Unscored reason', label(record.get('unscored_reason') or 'Not recorded'))])
    for evidence in record.get('evidence') or []:
        story.append(p(label(evidence['rule_key']), 'section'))
        pairs([(label(key), display(value)) for key, value in evidence['metrics'].items()])
    section('04  Review history')
    events = record.get('events') or []
    story.append(p(f"{len(events)} of {record.get('event_count', 0)} events included (latest 100 maximum).", 'muted'))
    for event in events:
        story.append(p(f"Version {event['version']} | {label(event['action'])}", 'section'))
        pairs([('Recorded at', timestamp(event.get('created_at'))),
               ('Reviewer / role', f"{display(event.get('actor_name'))} / {label(event.get('actor_role') or 'Not recorded')}"),
               ('Status / resolution', f"{label(event.get('status') or 'Not recorded')} / {label(event.get('resolution') or 'Not decided')}"),
               ('Team', event.get('team_id')), ('Review note', event.get('note'))])

    def page_frame(canvas, document):
        canvas.saveState()
        canvas.setFont('MemoVeraBold', 8)
        canvas.setFillColor(navy)
        canvas.drawString(40, A4[1] - 28, 'CONTINUOUS AUDITING  /  EXCEPTION REVIEW')
        canvas.setStrokeColor(border)
        canvas.line(40, 32, A4[0] - 40, 32)
        canvas.setFont('MemoVera', 7)
        canvas.setFillColor(muted)
        canvas.drawString(40, 20, 'Current saved snapshot | Amounts preserve stored precision')
        canvas.drawRightString(A4[0] - 40, 20, f'Page {document.page}')
        canvas.restoreState()

    doc.build(story, onFirstPage=page_frame, onLaterPages=page_frame)
    return output.getvalue()
