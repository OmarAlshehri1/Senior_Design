"""Render the saved memorandum as PDF without a browser or external resources."""
from html import escape
from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
from threading import Lock

import reportlab
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate, Frame, LongTable, NextPageTemplate, PageBreak, PageTemplate,
    Paragraph, Spacer, TableStyle,
)
from reportlab.graphics.shapes import Drawing, Rect, String


_FONT_LOCK = Lock()


def _register_fonts():
    # ReportLab ships these redistributable fonts; no host font installation.
    with _FONT_LOCK:
        if 'MemoVera' not in pdfmetrics.getRegisteredFontNames():
            directory = Path(reportlab.__file__).parent / 'fonts'
            pdfmetrics.registerFont(TTFont('MemoVera', str(directory / 'Vera.ttf')))
            pdfmetrics.registerFont(TTFont('MemoVeraBold', str(directory / 'VeraBd.ttf')))


class _MemorandumBlocks(HTMLParser):
    """Read only the known server-generated report vocabulary, never user markup.

    The HTML renderer escapes all evidence. Decoded text is escaped again before
    ReportLab sees it. CSS and the duplicate HTML bar chart are not PDF content.
    """
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self.in_body = False
        self.skip_bars = False
        self.tag = None
        self.text = []
        self.rows = None
        self.row = None
        self.header_label = ''

    def handle_starttag(self, tag, attrs):
        if tag == 'body':
            self.in_body = True
        if not self.in_body:
            return
        if tag == 'div' and dict(attrs).get('class') == 'bars':
            self.skip_bars = True
        if self.skip_bars:
            return
        if tag in ('table', 'dl'):
            self.rows = []
        elif tag == 'tr':
            self.row = []
        elif tag in ('h1', 'h2', 'h3', 'h4', 'p', 'li', 'th', 'td', 'dt', 'dd'):
            self.tag, self.text = tag, []

    def handle_data(self, data):
        if self.in_body and not self.skip_bars and self.tag:
            self.text.append(data)

    def handle_endtag(self, tag):
        if not self.in_body:
            return
        if self.skip_bars:
            # Only the following section closes the generated bars container.
            if tag == 'section':
                self.skip_bars = False
                self.blocks.append(('risk_chart', None))
            return
        if tag == self.tag:
            text = ''.join(self.text)
            if tag in ('td', 'th'):
                self.row.append(text)
            elif tag == 'dt':
                self.header_label = text
            elif tag == 'dd':
                self.rows.append([self.header_label, text])
            else:
                self.blocks.append((tag, text))
            self.tag, self.text = None, []
        elif tag == 'tr':
            self.rows.append(self.row)
            self.row = None
        elif tag in ('table', 'dl'):
            self.blocks.append(('table', self.rows))
            self.rows = None
        elif tag == 'body':
            self.in_body = False


def build_business_pdf(report: dict) -> bytes:
    # Reuse the complete HTML content: no parallel fact/narrative reconstruction.
    from app.services.business_reports import render_business_html

    _register_fonts()
    parsed = _MemorandumBlocks()
    parsed.feed(render_business_html(report))
    parsed.close()
    output = BytesIO()
    margin = 36
    ink = colors.HexColor('#172536')
    blue = colors.HexColor('#0876b9')
    body = ParagraphStyle('MemoBody', fontName='MemoVera', fontSize=9, leading=14,
                          textColor=ink, spaceAfter=8, splitLongWords=True)
    heading_styles = {
        tag: ParagraphStyle(tag, parent=body, fontName='MemoVeraBold', fontSize=size,
                            leading=size + 5, spaceBefore=10, spaceAfter=8,
                            keepWithNext=True, textColor=blue if tag == 'h2' else ink)
        for tag, size in [('h1', 24), ('h2', 14), ('h3', 11), ('h4', 9)]
    }
    cell = ParagraphStyle('MemoCell', parent=body, fontSize=7, leading=10,
                          spaceAfter=0)
    header_cell = ParagraphStyle('MemoHeaderCell', parent=cell, fontName='MemoVeraBold')

    def paragraph(value, style=body):
        return Paragraph(escape(value).replace('\n', '<br/>'), style)

    def footer(canvas, doc):
        canvas.saveState()
        width, _ = canvas._pagesize
        canvas.setFont('MemoVera', 6)
        canvas.setFillColor(ink)
        canvas.drawString(margin, 19, f"BR-{report['id']} | Draft — human review required")
        canvas.drawRightString(width - margin, 19, f'Page {doc.page}')
        canvas.restoreState()

    doc = BaseDocTemplate(output, pagesize=A4, leftMargin=margin, rightMargin=margin,
                          topMargin=margin, bottomMargin=margin,
                          title=f"Business Audit Report BR-{report['id']}",
                          author='Continuous Auditing System')
    for name, page_size in [('memo', A4), ('appendix', landscape(A4))]:
        width, height = page_size
        doc.addPageTemplates(PageTemplate(name, [Frame(margin, margin, width-2*margin,
                            height-2*margin, leftPadding=0, rightPadding=0,
                            topPadding=0, bottomPadding=0)], pagesize=page_size, onPage=footer))
    story = []
    width = A4[0] - 2*margin
    for tag, value in parsed.blocks:
        if tag == 'h2' and value.startswith('Appendix '):
            story.extend([NextPageTemplate('appendix'), PageBreak()])
            width = landscape(A4)[0] - 2*margin
        if tag in heading_styles:
            story.append(paragraph(value, heading_styles[tag]))
        elif tag in ('p', 'li'):
            story.append(paragraph(('• ' if tag == 'li' else '') + value))
        elif tag == 'table' and value:
            count = len(value[0])
            # Wider identifier/detail columns; wrap all text, including long IDs.
            weights = [max(1, min(2.6, len(label)/12)) for label in value[0]]
            if count == 2:
                weights = [1, 2]
            widths = [width*w/sum(weights) for w in weights]
            rows = [[paragraph(text, header_cell if index == 0 else cell)
                     for text in row] for index, row in enumerate(value)]
            table = LongTable(rows, colWidths=widths, repeatRows=1, splitInRow=1,
                              hAlign='LEFT', spaceAfter=12)
            table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#edf3f8')),
                ('GRID', (0, 0), (-1, -1), 0.4, colors.HexColor('#cbd5e1')),
                ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                ('LEFTPADDING', (0, 0), (-1, -1), 5),
                ('RIGHTPADDING', (0, 0), (-1, -1), 5),
                ('TOPPADDING', (0, 0), (-1, -1), 5),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
            ]))
            story.append(table)
        elif tag == 'risk_chart':
            values = report['document']['metrics']['risk_distribution']
            chart = Drawing(width, 22*len(values)+12)
            maximum = max([1, *values.values()])
            for index, (label, count) in enumerate(values.items()):
                y = 22*(len(values)-index-1)+10
                chart.add(String(0, y, f'{label}: {count}', fontName='MemoVera', fontSize=8))
                chart.add(Rect(125, y-2, (width-150)*count/maximum, 10,
                               fillColor=blue, strokeColor=None))
            story.extend([chart, Spacer(1, 8)])
    doc.build(story)
    return output.getvalue()
