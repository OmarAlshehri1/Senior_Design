import { formatTimestamp, formatUtcDate } from '../utils/dateTime.js';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { businessReportsService } from '../services/businessReportsService.js';
import '../businessReports.css';
import { createBusinessReportController } from '../utils/businessReportState.js';

function saveReportFile(blob, id, format) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `BR-${id}.${format}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function BusinessReports() {
  const [controller] = useState(() => createBusinessReportController(businessReportsService, saveReportFile));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [form, setForm] = useState({ day: '', recipient: 'Management and Audit Supervisor',
    sender: 'Continuous Auditing System — automated preparation', dataContext: 'UNVERIFIED', useGemini: true });
  useEffect(() => { controller.loadList(); return controller.cancel; }, [controller]);
  return <BusinessReportsView state={state} controller={controller} form={form} setForm={setForm} />;
}

export function BusinessReportsView({ state, controller, form, setForm }) {
  const { list, selected, preview, busy, errors, notice } = state;
  const { day, recipient, sender, dataContext, useGemini } = form;
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const previewReady = preview.status === 'success' && preview.reportId === selected?.id && list.status !== 'loading';
  return <div className="business-reports">
    <div className="page-header"><div><h1>Business Audit Reports</h1><p>Management memoranda with findings, conclusions, recommendations and supporting evidence.</p></div></div>
    <section className="card business-report-controls" aria-labelledby="business-create-heading">
      <h2 id="business-create-heading">Create a memorandum</h2>
      <p>Each generation saves a separate draft. Admin reports cover the organization; Supervisor reports cover transactions linked to their team’s alerts or cases.</p>
      <form onSubmit={(event) => { event.preventDefault(); controller.generate(form); }} aria-busy={busy.generate}>
        <div className="business-report-fields">
          <label>Transaction day (UTC)<input type="date" value={day} onChange={(e) => setField('day', e.target.value)} /><small>Leave empty to use the latest dated transaction in your scope.</small></label>
          <label>Data context<select value={dataContext} onChange={(e) => setField('dataContext', e.target.value)}><option value="UNVERIFIED">Unverified provenance</option><option value="DEMONSTRATION">Project demonstration / test data</option><option value="OPERATIONAL">Operational data (user declared)</option></select></label>
          <label>To<input value={recipient} required maxLength={200} onChange={(e) => setField('recipient', e.target.value)} /></label>
          <label>From<input value={sender} required maxLength={200} onChange={(e) => setField('sender', e.target.value)} /><small>This label is not a signature or approval.</small></label>
        </div>
        <label className="business-report-ai-option"><input type="checkbox" checked={useGemini} onChange={(e) => setField('useGemini', e.target.checked)} />Add AI-assisted explanations of findings</label>
        <p>Gemini can explain the findings using anonymized aggregate facts. If unavailable, standard explanations are saved instead. AI commentary is advisory and requires review.</p>
        <button className="btn btn-primary business-generate-button" type="submit" disabled={busy.generate} aria-busy={busy.generate}>{busy.generate ? 'Generating…' : 'Generate Business Report'}</button>
      </form>
      {errors.generate && <p role="alert" className="integration-error">Generation failed: {errors.generate}</p>}
      {notice && <p role="status">{notice}</p>}
    </section>
    <section className="card business-report-controls" aria-labelledby="business-saved-heading" aria-busy={list.status === 'loading'}>
      <h2 id="business-saved-heading">Saved drafts</h2>
      {list.status === 'loading' && <p role="status">{list.refreshing ? 'Refreshing saved reports… Previous results are shown until the request completes.' : 'Loading saved reports…'}</p>}
      {list.status === 'error' && <div role="alert" className="integration-error"><p>{list.unavailable ? 'Reporting integration unavailable.' : 'Saved reports could not be loaded.'} {list.error}</p><button type="button" className="btn btn-secondary" onClick={() => controller.loadList()}>Retry saved reports</button></div>}
      {(list.status === 'success' || list.refreshing) && <>
        {!list.items.length ? <p>{list.total > 0 ? 'No saved drafts on this page. Refresh or browse another page.' : 'No business reports are available in your current scope.'}</p> : <label>Report / revision<select value={selected?.id ?? ''} disabled={list.status === 'loading'} onChange={(e) => controller.selectId(e.target.value)}>{!selected && <option value="" disabled>Select a saved draft</option>}{list.items.map((r) => <option key={r.id} value={r.id}>{formatUtcDate(r.period_start)} UTC · {r.scope} · {formatTimestamp(r.created_at)} · {r.id.slice(0, 8)}</option>)}</select></label>}
        <div className="business-report-actions"><button type="button" className="btn btn-secondary" disabled={list.page <= 1 || list.status === 'loading'} onClick={() => controller.loadList(list.page - 1)}>Previous</button><span>Page {list.page} · {list.total} drafts</span><button type="button" className="btn btn-secondary" disabled={list.page * 10 >= list.total || list.status === 'loading'} onClick={() => controller.loadList(list.page + 1)}>Next</button><button type="button" className="btn btn-secondary" onClick={() => controller.loadList()} disabled={list.status === 'loading'}>Refresh</button></div>
      </>}
      {selected && <p>Evidence for {formatUtcDate(selected.period_start)} to {formatUtcDate(selected.period_end)} UTC (exclusive) · {selected.scope} · Draft, not approved.</p>}
      {selected && <div className="business-report-actions">
        <button type="button" className="btn btn-secondary business-export-button" disabled={busy.pdf} aria-busy={busy.pdf} onClick={() => controller.download('pdf')}>{busy.pdf ? 'Downloading PDF…' : 'Download Business Report'}</button>
        <button type="button" className="btn btn-secondary business-export-button" disabled={busy.xlsx} aria-busy={busy.xlsx} onClick={() => controller.download('xlsx')}>{busy.xlsx ? 'Downloading Excel…' : 'Download Excel Appendix'}</button>
      </div>}
      {errors.pdf && <p role="alert" className="integration-error">PDF download failed: {errors.pdf}</p>}
      {errors.xlsx && <p role="alert" className="integration-error">Excel download failed: {errors.xlsx}</p>}
    </section>
    {preview.status === 'loading' && <p role="status">Loading memorandum preview…</p>}
    {preview.status === 'error' && <div role="alert" className="integration-error"><p>Memorandum preview unavailable. {preview.error}</p>{selected && <><p>You can still try the PDF or Excel download.</p><button type="button" className="btn btn-secondary" onClick={() => controller.retryPreview()}>Retry preview</button></>}</div>}
    {previewReady && <iframe className="business-report-preview" title="Business audit memorandum preview" sandbox="allow-same-origin" srcDoc={preview.html} />}
  </div>;
}
