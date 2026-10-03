import { useState } from 'react';
import ManagementEmptyState from './ManagementEmptyState.jsx';

export default function CaseEvidencePanel({ evidence = [], canAdd = false, enabled = false, onUpload, onDownload }) {
  const [file, setFile] = useState(null);
  const [category, setCategory] = useState('OTHER');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const upload = async (event) => {
    event.preventDefault(); if (!file) return; const form = event.currentTarget;
    setBusy(true); setError(null);
    try { if (await onUpload?.(file, category, description || null) === false) return; setFile(null); setDescription(''); form.reset(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Evidence could not be uploaded.'); }
    finally { setBusy(false); }
  };
  const download = async (item) => {
    try { const blob = await onDownload?.(item.id); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = item.fileName; link.click(); URL.revokeObjectURL(url); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Evidence could not be downloaded.'); }
  };
  return <section className="workflow-panel" aria-labelledby="case-evidence-heading">
    <div className="workflow-panel-header"><div><h2 id="case-evidence-heading">Evidence Attachments</h2><p>PDF and image evidence is validated and scanned before storage.</p></div></div>
    {canAdd && <form onSubmit={upload} className="case-evidence-form"><label><span>Evidence file</span><input type="file" accept="application/pdf,image/png,image/jpeg" disabled={!enabled || busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><label><span>Category</span><select value={category} disabled={!enabled || busy} onChange={(event) => setCategory(event.target.value)}>{['DOCUMENT', 'SCREENSHOT', 'INVOICE', 'APPROVAL_RECORD', 'OTHER'].map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label><label><span>Description (optional)</span><input value={description} maxLength={1000} disabled={!enabled || busy} onChange={(event) => setDescription(event.target.value)} /></label><button className="btn btn-secondary" disabled={!enabled || busy || !file}>{busy ? 'Uploading…' : 'Add Evidence'}</button><small>{enabled ? 'Maximum file size 10 MiB. Files are rejected when scanning fails.' : 'Uploads are unavailable until a private storage bucket and antivirus scanner are configured.'}</small></form>}
    {error && <p role="alert" className="integration-note">{error}</p>}
    {evidence.length === 0 ? <ManagementEmptyState title="No evidence has been attached." description="Validated attachment metadata will appear here; files are not stored locally." /> : <ul className="case-evidence-list">{evidence.map((item) => <li key={item.id}><div><strong>{item.fileName}</strong><span>{item.category?.replaceAll('_', ' ')} · {Math.ceil(item.fileSize / 1024)} KB · {item.scanStatus}</span></div><button type="button" className="btn btn-secondary" onClick={() => download(item)}>Download</button></li>)}</ul>}
  </section>;
}
