import { useState } from 'react';
import ManagementEmptyState from './ManagementEmptyState.jsx';
import { Panel } from './ui/Layout.jsx';

export default function CaseEvidencePanel({ evidence = [], canAdd = false, enabled = false, onUpload, onDownload, onScan }) {
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('OTHER');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const upload = async (event) => {
    event.preventDefault(); if (!file) return; const form = event.currentTarget;
    if (file.size > 5 * 1024 * 1024) { setError('Files must be 5 MiB or smaller.'); return; }
    setBusy(true); setError(null);
    try { if (await onUpload?.(file, category, description || null) === false) return; setFile(null); setDescription(''); form.reset(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Evidence could not be uploaded.'); }
    finally { setBusy(false); }
  };
  const download = async (item) => {
    if (item.scanStatus !== 'CLEAN') return;
    try { const blob = await onDownload?.(item.id); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = item.fileName; link.click(); URL.revokeObjectURL(url); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Evidence could not be downloaded.'); }
  };
  const scan = async (item) => {
    setBusy(true); setError(null);
    try { await onScan?.(item.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Scanning is unavailable; the file remains quarantined.'); }
    finally { setBusy(false); }
  };
  return <Panel id="case-evidence-heading" title="Evidence" description="Files stay private and quarantined until a virus scan passes. Only clean files can be downloaded.">
    {evidence.length === 0 ? <ManagementEmptyState title="No evidence attached." description="Attached files appear here with category and scan result." /> : <ul className="stack-list evidence-list">{evidence.map((item) => <li key={item.id}><div><strong>{item.fileName}</strong><span className="secondary-metadata">{item.category?.replaceAll('_', ' ')} · {Math.ceil(item.fileSize / 1024)} KB · {item.scanStatus}</span>{item.scanStatus !== 'CLEAN' && <span className="field-hint">Quarantined — download blocked.</span>}</div><button type="button" className="btn btn-secondary btn-sm" disabled={item.scanStatus !== 'CLEAN'} onClick={() => download(item)}>Download</button>{canAdd && enabled && onScan && ['PENDING','ERROR'].includes(item.scanStatus) && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => scan(item)}>Retry scan</button>}</li>)}</ul>}
    {canAdd && (enabled ? <details className="inline-disclosure"><summary>Attach evidence</summary><form onSubmit={upload} className="form-grid evidence-form"><label className="field"><span className="field-label">File</span><input type="file" accept="application/pdf,image/png,image/jpeg" disabled={busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><label className="field"><span className="field-label">Category</span><select value={category} disabled={busy} onChange={(event) => setCategory(event.target.value)}>{['DOCUMENT', 'SCREENSHOT', 'INVOICE', 'APPROVAL_RECORD', 'OTHER'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><label className="field"><span className="field-label">Description (optional)</span><input value={description} maxLength={1000} disabled={busy} onChange={(event) => setDescription(event.target.value)} /></label><div className="form-actions"><button className="btn btn-secondary btn-sm" disabled={busy || !file}>{busy ? 'Uploading…' : 'Add evidence'}</button><span className="field-hint">Up to 5 MiB. Failed or unavailable scans leave files quarantined with downloads blocked.</span></div></form></details>
      : <p className="field-hint evidence-unavailable">File uploads are not enabled for this workspace.</p>)}
    {error && <p role="alert" className="inline-alert">{error}</p>}
  </Panel>;
}
