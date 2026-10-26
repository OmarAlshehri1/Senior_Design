import { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient.js';
import useAuthorization from '../auth/useAuthorization.js';

const label = (value) => String(value).replaceAll('_', ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
const metric = (value) => value == null ? 'Unavailable' : typeof value === 'boolean' ? (value ? 'Yes' : 'No')
  : Array.isArray(value) ? value.map(label).join(', ') || 'None' : String(value);

export default function FeedExceptions({ source }) {
  const { effectiveRole } = useAuthorization();
  const manager = ['ADMIN', 'SUPERVISOR'].includes(effectiveRole);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [teams, setTeams] = useState([]);
  const [team, setTeam] = useState('');
  const [note, setNote] = useState('');
  const [action, setAction] = useState('NOTE');
  const [resolution, setResolution] = useState('CONFIRMED_EXCEPTION');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    let timer;
    async function refresh() {
      try {
        const data = await apiClient.get('/feed-review/exceptions', { query: { source_id: source, page, page_size: 25 } });
        if (active) {
          setResult(data); setError('');
          if (selected && !data.items.some((item) => item.id === selected)) {
            setSelected(null); setDetail(null);
          }
        }
      } catch (err) {
        if (active) { setResult(null); setDetail(null); setError(err.message); }
      } finally { if (active) timer = setTimeout(refresh, 5000); }
    }
    refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [source, page, revision, selected]);

  useEffect(() => {
    let active = true;
    apiClient.get('/feed-review/exception-teams', { query: { source_id: source } })
      .then((data) => { if (active) setTeams(data.items); })
      .catch(() => { if (active) setTeams([]); });
    return () => { active = false; };
  }, [source]);

  useEffect(() => {
    setDetail(null);
    if (!selected) return undefined;
    let active = true;
    apiClient.get(`/feed-review/exceptions/${selected}`, { query: { source_id: source } })
      .then((data) => { if (active) { setDetail(data); setError(''); } })
      .catch((err) => { if (active) setError(err.message); });
    return () => { active = false; };
  }, [source, selected, revision]);

  async function submit(event) {
    event.preventDefault();
    if (!detail || busy) return;
    setBusy(true);
    try {
      await apiClient.post(`/feed-review/exceptions/${selected}/actions`, {
        source_id: source, action, expected_version: detail.review.version, note,
        team_id: action === 'ASSIGN' ? team : null,
        resolution: action === 'CLOSE' ? resolution : null,
      });
      setNote(''); setAction('NOTE'); setRevision((value) => value + 1);
    } catch (err) {
      setError(err.status === 409 ? 'This review changed. Reload the evidence before submitting again.' : err.message);
      setDetail(null);
    } finally { setBusy(false); }
  }

  async function download(format) {
    setBusy(true);
    try {
      const blob = await apiClient.getFile(`/feed-review/exceptions/${selected}/download`, { query: { source_id: source, format } });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = `Feed-Exception-${selected}.${format}`; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }

  return <section aria-label="Exception review">
    <h2>Exception review</h2>
    <p>Transactions with saved FAILED rule outcomes. Review decisions do not change rule outcomes or establish fraud.</p>
    {error && <p role="alert">{error}</p>}
    {!result && !error && <p role="status">Loading exceptions…</p>}
    {result && <>
      <div className="table-container"><table><thead><tr><th>Record</th><th>Vendor</th><th>Amount</th><th>Review</th><th>Failed rules</th><th>Evidence</th></tr></thead>
        <tbody>{result.items.map((row) => <tr key={row.id}><td>{row.record_id}</td><td>{row.vendor_name}</td>
          <td>{row.amount} {row.currency}</td><td>{row.review.status}</td>
          <td>{row.rules.filter((rule) => rule.status === 'FAILED').map((rule) => rule.rule_key).join(', ')}</td>
          <td><button type="button" onClick={() => { setSelected(row.id); setNote(''); setAction('NOTE'); }}>Open review</button></td></tr>)}</tbody></table></div>
      {!result.items.length && <p>No exceptions are visible in your assigned scope on this page.</p>}
      <button type="button" disabled={page === 1} onClick={() => { setSelected(null); setPage(page - 1); }}>Previous</button>
      <span> Page {page} · {result.total} exceptions </span>
      <button type="button" disabled={page * 25 >= result.total} onClick={() => { setSelected(null); setPage(page + 1); }}>Next</button>
    </>}
    {selected && <div>
      <h3>Saved evidence and review</h3>
      <button type="button" onClick={() => setSelected(null)}>Close</button>
      <button type="button" disabled={busy} onClick={() => setRevision((value) => value + 1)}>Reload evidence</button>
      {detail && <>
        <p>Status: {label(detail.review.status)} · Resolution: {detail.review.resolution ? label(detail.review.resolution) : 'Not decided'} · Version: {detail.review.version}</p>
        <p>Assigned team: {teams.find((item) => item.id === detail.review.team_id)?.name || detail.review.team_id || 'Unassigned'}</p>
        <p>Clock: {detail.time_basis} · Original day: {detail.source_date || 'Unavailable'} · Arrival: {new Date(detail.received_at).toLocaleString()}</p>
        <p>Verified approval limit: {detail.verified_approval_limit ?? 'Unavailable'} {detail.currency}</p>
        <ul>{detail.rules.map((rule) => <li key={rule.rule_key}>{label(rule.rule_key)}: <strong>{label(rule.status)}</strong> — {rule.detail}</li>)}</ul>
        {detail.evidence.map((item) => <section key={item.rule_key}><h4>{label(item.rule_key)} evidence</h4>
          <dl>{Object.entries(item.metrics).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd>{metric(value)}</dd></div>)}</dl>
        </section>)}
        <form onSubmit={submit}>
          <label>Action <select value={action} onChange={(event) => setAction(event.target.value)}>
            <option value="NOTE">Add note</option>
            {detail.review.status === 'OPEN' && <option value="START_REVIEW">Start review</option>}
            {manager && detail.review.status !== 'CLOSED' && <><option value="ASSIGN">Assign team</option><option value="CLOSE">Close with decision</option></>}
            {manager && detail.review.status === 'CLOSED' && <option value="REOPEN">Reopen</option>}
          </select></label>
          {action === 'ASSIGN' && <label>Team <select required value={team} onChange={(event) => setTeam(event.target.value)}>
            <option value="">Select an eligible team</option>{teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select></label>}
          {action === 'CLOSE' && <label>Decision <select value={resolution} onChange={(event) => setResolution(event.target.value)}>
            <option value="CONFIRMED_EXCEPTION">Confirmed exception (not confirmed fraud)</option><option value="DISMISSED">Dismissed</option>
          </select></label>}
          <label>Review note <textarea required maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} /></label>
          <button type="submit" disabled={busy || !note.trim()}>Save review</button>
        </form>
        <h3>Review history</h3><p>Showing {detail.events.length} of {detail.event_count} events (latest 100 maximum).</p>
        <ol>{detail.events.map((entry) => <li key={entry.version}>{new Date(entry.created_at).toLocaleString()} · {entry.actor_name} ({entry.actor_role}) · {entry.action}: {entry.note}</li>)}</ol>
        {manager && <div><p>Export this exception and current review snapshot:</p>{['html', 'xlsx', 'pdf'].map((format) => <button key={format} type="button" disabled={busy} onClick={() => download(format)}>{format.toUpperCase()}</button>)}</div>}
      </>}
    </div>}
  </section>;
}
