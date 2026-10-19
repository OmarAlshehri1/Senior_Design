from copy import deepcopy
from io import BytesIO
import re

from pypdf import PdfReader
import pytest

from app.services.business_report_pdf import build_business_pdf, _MemorandumBlocks
from app.services.business_reports import render_business_html, build_document
from tests.test_business_reports import report, source


def normalize(text):
    # Wide schedules wrap identifiers between glyphs as well as words.
    return re.sub(r'\s+', '', text)


def test_pdf_contains_saved_narrative_all_schedules_and_safe_literal_text(monkeypatch):
    saved = report()
    saved['document']['findings'][0]['analysis']['interpretation'] = 'Saved Gemini prose must remain identical in the downloaded memorandum.'
    saved['document']['narrative'].update(provider='GEMINI', status='GENERATED', model='gemini-3.8-flash')
    before = deepcopy(saved)
    monkeypatch.setattr('httpx.Client', lambda **kwargs: pytest.fail('PDF must not access network or regenerate narrative'))
    result = build_business_pdf(saved)
    assert result.startswith(b'%PDF-')
    reader = PdfReader(BytesIO(result))
    text = '\n'.join(p.extract_text() for p in reader.pages)
    parsed = _MemorandumBlocks()
    parsed.feed(render_business_html(saved))
    # Every textual block and every table cell survives in the actual PDF.
    for tag, value in parsed.blocks:
        values = [cell for row in value for cell in row] if tag == 'table' else [value]
        for value in values:
            if value is not None:
                assert normalize(value) in normalize(text), (tag, value)
    assert '<script>alert(1)</script>' in normalize(text)
    assert len(reader.pages) >= 5
    assert float(reader.pages[0].mediabox.width) < float(reader.pages[0].mediabox.height)
    assert any(float(p.mediabox.width) > float(p.mediabox.height) for p in reader.pages)
    assert not reader.trailer['/Root'].get('/OpenAction')
    assert all(not p.get('/Annots') for p in reader.pages)
    assert saved == before


def test_pdf_splits_long_evidence_and_repeats_schedule_headers():
    saved = report()
    transaction = saved['document']['evidence']['transactions'][0]
    transaction['rule_results'][0]['detail'] = ('Long recorded evidence requiring safe page splitting. ' * 150) + 'END-OF-LONG-EVIDENCE'
    saved['document']['evidence']['transactions'] = [
        dict(deepcopy(transaction), id=f'UNIQUE-TRANSACTION-{index:04}') for index in range(24)
    ]
    reader = PdfReader(BytesIO(build_business_pdf(saved)))
    text = normalize(''.join(p.extract_text() for p in reader.pages))
    for index in range(24):
        assert f'UNIQUE-TRANSACTION-{index:04}' in text
    assert 'END-OF-LONG-EVIDENCE' in text
    assert text.count('Recordedevidence') > 1


def test_empty_period_pdf_is_a_valid_draft_with_appendices():
    saved = report()
    data = source()
    data.update(transactions=[], alerts=[], cases=[])
    saved['document'] = build_document(data, recipient='Management', sender='System', data_context='DEMONSTRATION')
    reader = PdfReader(BytesIO(build_business_pdf(saved)))
    text = ''.join(p.extract_text() for p in reader.pages)
    assert 'Appendix D' in text
    assert 'DRAFT' in text
