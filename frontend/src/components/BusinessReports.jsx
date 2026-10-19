import { useEffect, useState } from 'react';
import { businessReportsService } from '../services/businessReportsService.js';
import '../businessReports.css';

export default function BusinessReports() {
  const [result, setResult] = useState({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState('');
  const [html, setHtml] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [day, setDay] = useState('');
  const [recipient, setRecipient] = useState('Management and Audit Supervisor');
  const [sender, setSender] = useState('Continuous Auditing System — automated preparation');
  const [dataContext, setDataContext] = useState('UNVERIFIED');
  const [useGemini, setUseGemini] = useState(true);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [error, setError] = useState('');
  const [previewError, setPreviewError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    businessReportsService.list({ query: { page, page_size: 10 }, signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) return;
        setResult(value);
        setSelectedId((id) => value.items.some((item) => item.id === id) ? id : value.items[0]?.id ?? '');
      }).catch((e) => { if (!controller.signal.aborted) { setError(e.message); setResult({ items: [], total: 0 }); setSelectedId(''); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [page, reload]);

  useEffect(() => {
    const controller = new AbortController();
    setHtml('');
    setPreviewError('');
    setPreviewLoading(Boolean(selectedId));
    if (selectedId) businessReportsService.download(selectedId, 'html', { signal: controller.signal })
      .then((blob) => blob.text()).then((value) => { if (!controller.signal.aborted) { setHtml(value); setPreviewId(selectedId); } })
      .catch((e) => { if (!controller.signal.aborted) setPreviewError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setPreviewLoading(false); });
    return () => controller.abort();
  }, [selectedId, reload]);

  const generate = async (event) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const saved = await businessReportsService.create({ day, recipient, sender, dataContext, useGemini });
      setSelectedId(saved.id);
      setPage(1);
      setReload((value) => value + 1);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const download = async (format) => {
    setBusy(true);
    setError('');
    try {
      const blob = await businessReportsService.download(selectedId, format);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `BR-${selectedId}.${format}`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  };

  const selected = result.items.find((r) => r.id === selectedId);
  const previewReady = Boolean(html && previewId === selectedId && !loading && !previewLoading);
  return <div className="business-reports">
    <div className="page-header"><div><h1>Business Audit Reports</h1><p>Management memoranda with findings, conclusions, recommendations and supporting evidence.</p></div></div>
    <section className="card business-report-controls" aria-labelledby="business-create-heading">
      <h2 id="business-create-heading">Create a memorandum</h2>
      <p>Each generation saves a separate draft. Admin reports cover the organization; Supervisor reports cover transactions linked to their team’s alerts or cases.</p>
      <form onSubmit={generate}>
        <div className="business-report-fields">
          <label>Transaction day (UTC)<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /><small>Leave empty to use the latest dated transaction in your scope.</small></label>
          <label>Data context<select value={dataContext} onChange={(e) => setDataContext(e.target.value)}><option value="UNVERIFIED">Unverified provenance</option><option value="DEMONSTRATION">Project demonstration / test data</option><option value="OPERATIONAL">Operational data (user declared)</option></select></label>
          <label>To<input value={recipient} required maxLength={200} onChange={(e) => setRecipient(e.target.value)} /></label>
          <label>From<input value={sender} required maxLength={200} onChange={(e) => setSender(e.target.value)} /><small>This label is not a signature or approval.</small></label>
        </div>
        <label className="business-report-ai-option"><input type="checkbox" checked={useGemini} onChange={(e) => setUseGemini(e.target.checked)} />Add AI-assisted explanations of findings</label>
        <p>Gemini can explain the findings using anonymized aggregate facts. If unavailable, standard explanations are saved instead. AI commentary is advisory and requires review.</p>
        <button className="btn btn-primary" type="submit" disabled={busy || loading}>{busy ? 'Saving…' : 'Generate Business Report'}</button>
      </form>
      {error && <p role="alert" className="integration-error">{error}</p>}
    </section>
    <section className="card business-report-controls" aria-labelledby="business-saved-heading">
      <h2 id="business-saved-heading">Saved drafts</h2>
      {loading ? <p role="status">Loading saved reports…</p> : <>
        {!result.items.length ? <p>No business reports are available in your current scope.</p> : <label>Report / revision<select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>{result.items.map((r) => <option key={r.id} value={r.id}>{r.period_start?.slice(0, 10)} · {r.scope} · {r.created_at} · {r.id.slice(0, 8)}</option>)}</select></label>}
        <div className="business-report-actions"><button className="btn btn-secondary" disabled={page <= 1 || busy} onClick={() => setPage((p) => p - 1)}>Previous</button><span>Page {page} · {result.total} drafts</span><button className="btn btn-secondary" disabled={page * 10 >= result.total || busy} onClick={() => setPage((p) => p + 1)}>Next</button><button className="btn btn-secondary" onClick={() => setReload((r) => r + 1)} disabled={busy}>Refresh</button></div>
      </>}
      {selected && <p>Evidence for {selected.period_start?.slice(0, 10)} to {selected.period_end?.slice(0, 10)} UTC (exclusive) · {selected.scope} · Draft, not approved.</p>}
      {selectedId && <div className="business-report-actions"><button className="btn btn-secondary" disabled={busy || !previewReady} onClick={() => download('pdf')}>Download Business Report</button><button className="btn btn-secondary" disabled={busy || !previewReady} onClick={() => download('xlsx')}>Download Excel Appendix</button></div>}
    </section>
    {previewLoading && <p role="status">Loading memorandum…</p>}
    {previewError && <p role="alert" className="integration-error">{previewError}</p>}
    {previewReady && <iframe className="business-report-preview" title="Business audit memorandum preview" sandbox="allow-same-origin" srcDoc={html} />}
  </div>;
}
