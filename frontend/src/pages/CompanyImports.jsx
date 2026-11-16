import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../services/apiClient.js';
import { IMPORT_FIELDS, createImportMapping, restoreImportMapping } from '../services/companyImportMapping.js';
import './feedReview.css';
import './companyImports.css';

const defaults = { decimal: '.', thousands: '', timeFormat: 'iso8601', currencies: '', actorNamespace: '', vendorNamespace: '' };
const message = (e) => e.status === 409
  ? 'A transaction reference already exists with different data or mapping. Nothing was imported. Check the file and try again.'
  : e.status === 422 ? 'Check the file, column mapping and declared formats. Every row must be valid before import.'
    : e.message || 'The import service is unavailable. Try again.';

export default function CompanyImports() {
  const [available, setAvailable] = useState(null);
  const [limits, setLimits] = useState(null);
  const [sources, setSources] = useState([]);
  const [source, setSource] = useState('');
  const [file, setFile] = useState(null);
  const [upload, setUpload] = useState(null);
  const [columns, setColumns] = useState({});
  const [identity, setIdentity] = useState('');
  const [settings, setSettings] = useState(defaults);
  const [preview, setPreview] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [history, setHistory] = useState({ profiles: [], items: [] });
  const [progress, setProgress] = useState(null);
  const [trackingId, setTrackingId] = useState(null);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const capability = await apiClient.get('/company-imports/capabilities', { signal: controller.signal });
        if (controller.signal.aborted) return;
        setAvailable(capability.enabled);
        setLimits({ rows: capability.max_rows, bytes: capability.max_bytes });
        if (capability.enabled) {
          const result = await apiClient.get('/company-imports/sources', { signal: controller.signal });
          if (!controller.signal.aborted) { setSources(result.items); setSource(result.items[0]?.id || ''); }
        }
      } catch (e) { if (!controller.signal.aborted) { setAvailable(false); setError(message(e)); } }
    }
    load();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!source) return;
    const controller = new AbortController();
    apiClient.get('/company-imports/history', { query: { source_id: source }, signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setHistory(value); })
      .catch((e) => { if (!controller.signal.aborted) setError(message(e)); });
    return () => controller.abort();
  }, [source, confirmed]);

  useEffect(() => {
    if (!confirmed || !trackingId) return;
    const controller = new AbortController();
    let timer;
    async function poll() {
      try {
        const value = await apiClient.get(`/company-imports/${trackingId}/progress`, {
          query: { source_id: source }, signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          setProgress(value);
          if (value.pending > 0) timer = setTimeout(poll, 2500);
        }
      } catch (e) { if (!controller.signal.aborted) { setError(message(e)); timer = setTimeout(poll, 5000); } }
    }
    poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [confirmed, trackingId, source]);

  function invalidate() { setPreview(null); setError(''); }
  function reset() { setUpload(null); setPreview(null); setProgress(null); setTrackingId(null); setConfirmed(false); setError(''); }
  async function inspect(sheet) {
    if (!file || !source) return;
    reset(); setBusy(true);
    try {
      const value = await apiClient.postRaw('/company-imports/uploads', file, {
        query: { source_id: source, filename: file.name, ...(sheet ? { sheet } : {}) },
        headers: { 'Content-Type': 'application/octet-stream' },
      });
      setUpload(value);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  async function validate(event) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await apiClient.post(`/company-imports/${upload.id}/preview`, {
        source_id: source, identity_column: identity, mapping: createImportMapping(columns, settings),
      });
      setPreview(result);
    } catch (e) { setPreview(null); setError(message(e)); }
    finally { setBusy(false); }
  }
  async function confirm() {
    setBusy(true); setError('');
    try {
      await apiClient.post(`/company-imports/${upload.id}/confirm`, {
        source_id: source, revision: preview.revision, profile_name: profileName.trim() || null,
      });
      setTrackingId(upload.id); setConfirmed(true);
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  function optionList() { return <><option value="">Not provided</option>{upload.columns.map((c) => <option key={c}>{c}</option>)}</>; }

  return <div className="feed-review company-imports">
    <h1>Import transactions</h1>
    {error && <p role="alert">{error}</p>}
    {available === null ? <p role="status">Checking import availability…</p> : !available
      ? <p>Transaction imports are not enabled for this environment. Contact your administrator.</p>
      : !sources.length ? <p>No company sources are assigned to you. A system operator must register a source and grant import access first.</p>
        : <>
          <section aria-label="Upload transactions">
            <fieldset disabled={busy}>
              <label>Company source<select value={source} onChange={(e) => {
                setSource(e.target.value); setFile(null); reset(); setHistory({ profiles: [], items: [] });
                setColumns({}); setIdentity(''); setSettings(defaults);
              }}>{sources.map((s) => <option key={s.id}>{s.id}</option>)}</select></label>
              <label>Transaction file<input type="file" accept=".csv,.xlsx" onChange={(e) => {
                const selected = e.target.files[0]; reset();
                if (selected && limits && selected.size > limits.bytes) { setError(`Choose a file no larger than ${limits.bytes / (1024 * 1024)} MiB.`); setFile(null); }
                else setFile(selected || null);
              }} /></label>
              <button disabled={!file || busy} onClick={() => inspect()}>Read file</button>
            </fieldset>
          </section>
          {upload && <section aria-label="Column mapping">
            <h2>Match your columns</h2><p>{upload.filename}: {upload.total} rows. A transaction reference must uniquely identify each record across future uploads.</p>
            <fieldset disabled={busy || confirmed}>
              {upload.sheets.length > 1 && <label>Worksheet<select value={upload.sheet} onChange={(e) => inspect(e.target.value)}>{upload.sheets.map((s) => <option key={s}>{s}</option>)}</select></label>}
              {history.profiles.length > 0 && <label>Saved mapping<select defaultValue="" onChange={(e) => {
                const profile = history.profiles.find((p) => p.name === e.target.value);
                if (profile) { const restored = restoreImportMapping(profile); setColumns(restored.columns); setSettings(restored.settings); setIdentity(restored.identity); invalidate(); }
              }}><option value="">Choose a saved mapping</option>{history.profiles.map((p) => <option key={p.name}>{p.name}</option>)}</select></label>}
              <form onSubmit={validate}>
                <label>Unique transaction reference<select required value={identity} onChange={(e) => { setIdentity(e.target.value); invalidate(); }}>{optionList()}</select></label>
                {Object.entries(IMPORT_FIELDS).map(([key, label]) => <label key={key}>{label}<select value={columns[key] || ''} onChange={(e) => { setColumns({ ...columns, [key]: e.target.value }); invalidate(); }}>{optionList()}</select></label>)}
                <label>Date format<select value={settings.timeFormat} onChange={(e) => { setSettings({ ...settings, timeFormat: e.target.value }); invalidate(); }}>
                  <option value="iso8601">Date and time with timezone (ISO 8601)</option><option value="%Y-%m-%d">Date only: YYYY-MM-DD</option><option value="%m/%d/%Y">Date only: MM/DD/YYYY</option><option value="%d/%m/%Y">Date only: DD/MM/YYYY</option>
                </select></label>
                <label>Decimal separator<select value={settings.decimal} onChange={(e) => { setSettings({ ...settings, decimal: e.target.value }); invalidate(); }}><option value=".">Period (123.45)</option><option value=",">Comma (123,45)</option></select></label>
                <label>Thousands separator<select value={settings.thousands} onChange={(e) => { setSettings({ ...settings, thousands: e.target.value }); invalidate(); }}><option value="">None</option><option value=",">Comma</option><option value=".">Period</option><option value=" ">Space</option></select></label>
                {['currencies', 'actorNamespace', 'vendorNamespace'].map((key) => <label key={key}>{({ currencies: 'Allowed currency codes (e.g. USD,SAR)', actorNamespace: 'Actor ID system (when actor columns are mapped)', vendorNamespace: 'Supplier ID system (when supplier reference is mapped)' })[key]}
                  <input value={settings[key]} maxLength={key === 'currencies' ? 255 : 128} onChange={(e) => { setSettings({ ...settings, [key]: e.target.value }); invalidate(); }} /></label>)}
                <button type="submit" disabled={busy}>Check all rows</button>
              </form>
            </fieldset>
            <p>Supplier names do not prove identity. Approval limits in a file do not replace verified company policies. Date-only records cannot support checks requiring an exact event time.</p>
          </section>}
          {preview && <section aria-label="Import preview">
            <h2>Review before importing</h2>
            <dl>{Object.entries(preview.counts).map(([key, value]) => <div key={key}><dt>{({ ACCEPTED: 'Ready', PARTIAL: 'Limited evaluation', REJECTED: 'Needs correction' })[key]}</dt><dd>{value}</dd></div>)}</dl>
            <p>{preview.existing_duplicates} existing records match and will be reused.</p>
            {preview.conflicts > 0 && <p role="alert">Existing references have different content or mapping on file rows {preview.conflict_rows.join(', ')}. Correct these conflicts before importing.</p>}
            <p>Every row was checked. This table shows up to 10 examples. Field readiness is preliminary; verified identities, policy, history and registry are checked during auditing. Missing reference data or an unapproved model leaves affected rules and risk scores unavailable.</p>
            <div className="import-table"><table><thead><tr><th>File row</th><th>Reference</th><th>Amount</th><th>Currency</th><th>Validation</th><th>Rule fields ready</th><th>Details</th></tr></thead><tbody>{preview.examples.map((row) => <tr key={row.row}>
              <td>{row.row}</td><td>{row.record_id || 'Missing'}</td><td>{row.canonical.amount ?? 'Unavailable'}</td><td>{row.canonical.currency ?? 'Unavailable'}</td><td>{row.intake_status}</td><td>{row.field_eligibility.filter((r) => r.eligible).length}/5</td><td>{row.reasons.map((r) => `${r.field}: ${r.code.toLowerCase().replaceAll('_', ' ')}`).join('; ') || 'Valid mapped fields'}</td>
            </tr>)}</tbody></table></div>
            {preview.issues.length > 0 && <p role="alert">Correct these file rows before importing: {preview.issues.map((r) => r.row).join(', ')}{preview.counts.REJECTED > 100 ? ' (first 100 shown)' : ''}.</p>}
            {!confirmed && <><label>Save mapping as (optional)<input maxLength={80} value={profileName} onChange={(e) => setProfileName(e.target.value)} disabled={busy} /></label>
              <button disabled={busy || preview.counts.REJECTED > 0 || preview.conflicts > 0} onClick={confirm}>{busy ? 'Working…' : 'Confirm import'}</button></>}
          </section>}
          {confirmed && <section aria-label="Import progress"><h2>Import received</h2>
            <p>The confirmed import is saved. Validation and auditing continue on the server.</p>
            {progress && <dl>{['total', 'inserted', 'duplicates', 'completed', 'pending', 'blocked', 'rejected'].map((key) => <div key={key}><dt>{key}</dt><dd>{progress[key] ?? 0}</dd></div>)}</dl>}
            <p>Completed means processing finished; it does not mean every rule ran or that fraud was confirmed.</p>
            <Link to="/feed-review">View imported transactions, exceptions and reports</Link>
          </section>}
          <section aria-label="Import history"><h2>Recent imports</h2>
            {history.items.length ? <ul>{history.items.map((item) => <li key={item.id}>{item.filename} — {item.confirmed_at ? `Confirmed: ${item.inserted} new, ${item.duplicates} reused` : 'Draft; not imported'}
              {item.confirmed_at && <button disabled={busy} onClick={() => {
                setUpload(null); setPreview(null); setProgress(null); setError(''); setTrackingId(item.id); setConfirmed(true);
              }}>Check processing</button>}
            </li>)}</ul> : <p>No recent uploads for this source.</p>}
          </section>
        </>}
  </div>;
}
