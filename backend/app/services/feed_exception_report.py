"""Bounded export of one currently authorized exception; no model or remote assets."""
from datetime import datetime, timezone
from html import escape
from io import BytesIO
import json


def report_rows(record):
    review = record['review']
    rows = [
        ['Feed exception evidence', 'One saved transaction; current review snapshot, not an approved memorandum'],
        ['Generated at (UTC)', datetime.now(timezone.utc).isoformat()],
        ['Transaction', record['id']], ['Source', record['source_id']],
        ['Record', record['record_id']], ['Vendor', record.get('vendor_name')],
        ['Invoice', record.get('invoice_number')], ['Amount (exact text)', record.get('amount')],
        ['Currency', record.get('currency')], ['Original day', record.get('source_date')],
        ['Original timestamp', record.get('transaction_timestamp')], ['Receipt arrival', record.get('received_at')],
        ['Clock', record.get('time_basis')], ['Evaluated at', record.get('evaluated_at')],
        ['Coverage', json.dumps(record.get('coverage'), ensure_ascii=False)],
        ['Verified approval limit', record.get('verified_approval_limit')],
        ['Combined risk', record.get('risk_score')], ['Unscored reason', record.get('unscored_reason')],
        ['Review status', review['status']], ['Resolution', review.get('resolution')],
        ['Team', review.get('team_id')], ['Review version', review['version']],
        ['Interpretation', 'Rule failures and review decisions are not confirmed fraud. Simulated references and arrival timing remain simulation inputs.'],
    ]
    for rule in record.get('rules') or []:
        rows.extend([[rule['rule_key'], rule['status']], ['Description', rule.get('detail')]])
    for evidence in record.get('evidence') or []:
        rows.append([f"Metrics: {evidence['rule_key']}", json.dumps(evidence['metrics'], ensure_ascii=False)])
    events = record.get('events') or []
    rows.append(['Review events included', f"{len(events)} of {record.get('event_count', 0)} (latest 100 maximum)"])
    for event in events:
        rows.append([f"Version {event['version']} · {event['action']}", json.dumps(event, ensure_ascii=False)])
    return [[str(key), 'Not recorded' if value is None else str(value)] for key, value in rows]


def build_exception_export(record, format):
    if format == 'pdf':
        from app.services.feed_exception_pdf import build_exception_pdf
        return build_exception_pdf(record), 'application/pdf'
    return build_rows_export(report_rows(record), format)


def build_rows_export(rows, format, title='Feed exception evidence', sheet_name='Exception evidence'):
    if format == 'html':
        heading = escape(title)
        content = f'<!doctype html><html><head><meta charset="utf-8"><title>{heading}</title></head><body><h1>{heading}</h1><table>'
        content += ''.join(f'<tr><th>{escape(k)}</th><td>{escape(v)}</td></tr>' for k, v in rows)
        return content + '</table></body></html>', 'text/html'
    output = BytesIO()
    if format == 'xlsx':
        from openpyxl import Workbook
        from openpyxl.styles import Alignment, Font
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = sheet_name
        for row in rows:
            sheet.append(row)
            for cell in sheet[sheet.max_row]:
                cell.data_type = 's'  # Source names/notes never become spreadsheet formulas.
                cell.alignment = Alignment(wrap_text=True, vertical='top')
            sheet.cell(sheet.max_row, 1).font = Font(bold=True)
        sheet.column_dimensions['A'].width = 32
        sheet.column_dimensions['B'].width = 100
        sheet.freeze_panes = 'B2'
        workbook.save(output)
        return output.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    if format == 'pdf':
        from reportlab.lib import colors
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.platypus import SimpleDocTemplate, Paragraph, LongTable, TableStyle
        from app.services.business_report_pdf import _register_fonts
        _register_fonts()
        styles = getSampleStyleSheet()
        style = styles['BodyText']
        style.fontName = 'MemoVera'
        style.fontSize = 8
        table = LongTable([[Paragraph(escape(k), style), Paragraph(escape(v), style)] for k, v in rows],
                          colWidths=[140, 360], splitInRow=1)
        table.setStyle(TableStyle([('VALIGN', (0, 0), (-1, -1), 'TOP'),
                                   ('LINEBELOW', (0, 0), (-1, -1), .3, colors.lightgrey)]))
        SimpleDocTemplate(output, title=title).build([table])
        return output.getvalue(), 'application/pdf'
    raise ValueError('Unsupported exception export format')
