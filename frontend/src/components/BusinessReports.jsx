import { formatTimestamp, formatUtcDate } from '../utils/dateTime.js';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { businessReportsService } from '../services/businessReportsService.js';
import '../businessReports.css';
import { createBusinessReportController } from '../utils/businessReportState.js';
import { Badge, Field, PageHeader, Panel, Switch } from './ui/Layout.jsx';
import { EmptyState, ErrorState, LoadingState } from './RequestStateView.jsx';
import { DownloadIcon, ReportIcon, SparkIcon } from './icons.jsx';
import { titleCase } from './statusUtils.js';

const DATA_CONTEXTS = Object.freeze([
  { value: 'UNVERIFIED', label: 'Source not verified', hint: 'Use when the data source has not been independently confirmed.' },
  { value: 'DEMONSTRATION', label: 'Demonstration or test data', hint: 'Findings are for workflow validation, not business conclusions.' },
  { value: 'OPERATIONAL', label: 'Operational data', hint: 'Declared by you as live business data; not independently validated.' },
]);

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
  const [showMemo, setShowMemo] = useState(true);
  useEffect(() => { controller.loadList(); return controller.cancel; }, [controller]);
  return <BusinessReportsView state={state} controller={controller} form={form} setForm={setForm} showMemo={showMemo} setShowMemo={setShowMemo} />;
}

export function BusinessReportsView({ state, controller, form, setForm, showMemo = true, setShowMemo = () => {} }) {
  const { list, selected, preview, busy, errors, notice } = state;
  const { day, recipient, sender, dataContext, useGemini } = form;
  const setField = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const previewReady = preview.status === 'success' && preview.reportId === selected?.id && list.status !== 'loading';
  const context = DATA_CONTEXTS.find((item) => item.value === dataContext) ?? DATA_CONTEXTS[0];
  const pageCount = Math.max(1, Math.ceil((list.total ?? 0) / 10));
  return <div className="page business-reports">
    <PageHeader title="Daily Business Reports" description="Clear daily totals, possible issues and recommended actions." />

    <div className="reports-layout">
      <div className="reports-side">
        <Panel id="business-create-heading" title="Generate a report" description="Each run saves a new draft for review.">
          <form className="report-form" onSubmit={(event) => { event.preventDefault(); controller.generate(form); }} aria-busy={busy.generate}>
            <Field label="Report date" hint="Leave empty for the latest day with activity. Days run 00:00–24:00 UTC.">
              <input type="date" value={day} onChange={(e) => setField('day', e.target.value)} />
            </Field>
            <Field label="Data source" hint={context.hint}>
              <select value={dataContext} onChange={(e) => setField('dataContext', e.target.value)}>{DATA_CONTEXTS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select>
            </Field>
            <Switch checked={useGemini} onChange={(value) => setField('useGemini', value)} label="AI explanations in Excel" description="Adds explanations to the Excel supporting details. The PDF stays a plain-language summary." />
            <details className="inline-disclosure report-settings">
              <summary>Memo settings</summary>
              <div className="report-settings-fields">
                <Field label="To"><input value={recipient} required maxLength={200} onChange={(e) => setField('recipient', e.target.value)} /></Field>
                <Field label="From" hint="A label only, not a signature or approval."><input value={sender} required maxLength={200} onChange={(e) => setField('sender', e.target.value)} /></Field>
              </div>
            </details>
            <button className="btn btn-primary btn-block" type="submit" disabled={busy.generate} aria-busy={busy.generate}><SparkIcon aria-hidden="true" />{busy.generate ? 'Generating…' : 'Generate report'}</button>
          </form>
          {errors.generate && <p role="alert" className="inline-alert report-form-message">Generation failed: {errors.generate}</p>}
          {notice && <p role="status" className="inline-status report-form-message">{notice}</p>}
        </Panel>

        <Panel id="business-saved-heading" title="Report library" flush aria-busy={list.status === 'loading'}
          description={list.status === 'success' ? `${list.total} saved ${list.total === 1 ? 'report' : 'reports'}` : 'Saved drafts in your scope'}>
          {list.status === 'loading' && !list.refreshing && <LoadingState compact message="Loading saved reports…" />}
          {list.refreshing && <p className="inline-status report-library-status" role="status">Refreshing saved reports… Previous results are shown until the request completes.</p>}
          {list.status === 'error' && <ErrorState compact title={list.unavailable ? 'Reporting integration unavailable.' : 'Saved reports could not be loaded.'} message={list.error} onRetry={() => controller.loadList()} retryLabel="Retry saved reports" />}
          {(list.status === 'success' || list.refreshing) && <>
            {!list.items.length ? <EmptyState compact title={list.total > 0 ? 'No reports on this page.' : 'No reports yet.'} message={list.total > 0 ? 'Go back a page or refresh.' : 'Generate your first report to start the library.'} />
              : <ul className="report-library">{list.items.map((report) => {
                const isOpen = selected?.id === report.id;
                return <li key={report.id} className={isOpen ? 'is-open' : undefined}>
                  <button type="button" className="report-library-item" aria-current={isOpen ? 'true' : undefined} disabled={list.status === 'loading'} onClick={() => { controller.selectId(report.id); setShowMemo(false); }}>
                    <span className="report-library-icon" aria-hidden="true"><ReportIcon /></span>
                    <span className="report-library-copy">
                      <strong>{formatUtcDate(report.period_start)}</strong>
                      <span>{titleCase(report.scope)} · Created {formatTimestamp(report.created_at, { showZone: false, seconds: false })}</span>
                    </span>
                    <span className="report-library-state">{isOpen ? 'Open' : 'Draft'}</span>
                  </button>
                </li>;
              })}</ul>}
            <div className="report-library-pages">
              <button type="button" className="btn btn-ghost btn-sm" disabled={list.page <= 1 || list.status === 'loading'} onClick={() => controller.loadList(list.page - 1)}>Previous</button>
              <span>Page {list.page} of {pageCount}</span>
              <button type="button" className="btn btn-ghost btn-sm" disabled={list.page * 10 >= list.total || list.status === 'loading'} onClick={() => controller.loadList(list.page + 1)}>Next</button>
            </div>
          </>}
        </Panel>
      </div>

      <div className="reports-main">
        {busy.generate ? <section className="panel report-generating" role="status" aria-live="polite">
          <span className="spinner spinner-lg" aria-hidden="true" />
          <h2>Generating business report</h2>
          <p>Analyzing transaction activity and preparing findings…</p>
          <p className="muted">This may take a few moments.</p>
        </section> : !selected ? <section className="panel">{list.status === 'loading' ? <LoadingState message="Loading report…" /> : <EmptyState title="No report selected." message="Generate a report or open one from the library." />}</section>
          : <section className="panel report-view" aria-labelledby="report-view-heading">
            <header className="report-view-header">
              <div>
                <p className="page-eyebrow">Daily audit report</p>
                <h2 id="report-view-heading">{formatUtcDate(selected.period_start)}</h2>
                <div className="detail-title-row"><Badge tone="info">{titleCase(selected.scope)}</Badge><Badge>Draft, not approved</Badge>
                  <span className="muted report-view-meta">UTC day · {formatUtcDate(selected.period_start)} to {formatUtcDate(selected.period_end)} (exclusive) · Created {formatTimestamp(selected.created_at, { showZone: false, seconds: false })}</span></div>
              </div>
              <div className="report-view-actions">
                <button type="button" className="btn btn-secondary btn-sm business-export-button" disabled={busy.pdf} aria-busy={busy.pdf} onClick={() => controller.download('pdf')}><DownloadIcon aria-hidden="true" />{busy.pdf ? 'Downloading PDF…' : 'Download PDF'}</button>
                <button type="button" className="btn btn-secondary btn-sm business-export-button" disabled={busy.xlsx} aria-busy={busy.xlsx} onClick={() => controller.download('xlsx')}><DownloadIcon aria-hidden="true" />{busy.xlsx ? 'Downloading Excel…' : 'Download Excel'}</button>
              </div>
            </header>
            {errors.pdf && <p role="alert" className="inline-alert">PDF download failed: {errors.pdf}</p>}
            {errors.xlsx && <p role="alert" className="inline-alert">Excel download failed: {errors.xlsx}</p>}
            <section className="report-memo" aria-labelledby="report-memo-heading">
              <div className="report-memo-header">
                <div><h3 id="report-memo-heading">Business report</h3><p className="muted">The plain-language summary. Detailed evidence is available in Excel.</p></div>
                {previewReady && <button type="button" className="btn btn-secondary btn-sm" aria-expanded={showMemo} onClick={() => setShowMemo((value) => !value)}>{showMemo ? 'Hide report' : 'View business report'}</button>}
              </div>
              {preview.status === 'loading' && <p className="inline-status" role="status">Loading memorandum preview…</p>}
              {preview.status === 'error' && <div role="alert" className="inline-alert">Memorandum preview unavailable. {preview.error} You can still try the PDF or Excel download.<button type="button" className="btn btn-secondary btn-sm" onClick={() => controller.retryPreview()}>Retry preview</button></div>}
              {previewReady && showMemo && <iframe className="business-report-preview" title="Daily business report preview" sandbox="allow-same-origin" srcDoc={preview.html} />}
            </section>
          </section>}
      </div>
    </div>
  </div>;
}
