import { useEffect, useState } from 'react';
import { apiClient } from '../services/apiClient.js';

const label = (value) => value.replaceAll('_', ' ').toLowerCase();
export default function FeedSummary({ source }) {
  const [teams, setTeams] = useState([]);
  const [team, setTeam] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [report, setReport] = useState(null);
  const [filters, setFilters] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    apiClient.get('/feed-review/exception-teams', { query: { source_id: source } })
      .then((data) => { if (active) setTeams(data.items); })
      .catch(() => { if (active) setTeams([]); });
    return () => { active = false; };
  }, [source]);
  async function generate(event) {
    event.preventDefault();
    if (!!start !== !!end || (start && start >= end)) { setError('Supply both dates in increasing order, or leave both empty.'); return; }
    const query = { source_id: source, team_id: team || undefined,
      period_start: start ? `${start}T00:00:00Z` : undefined, period_end: end ? `${end}T00:00:00Z` : undefined };
    setBusy(true); setError(''); setReport(null);
    try { setReport(await apiClient.get('/feed-review/summary', { query })); setFilters(query); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  async function download(format) {
    setBusy(true); setError('');
    try {
      const blob = await apiClient.getFile('/feed-review/summary/download', { query: { ...filters, format } });
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `Feed-Summary.${format}`; anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) { setReport(null); setError(err.message); }
    finally { setBusy(false); }
  }
  return <section aria-label="Feed summary report"><h2>Feed summary report</h2>
    <p>Admin source reports cover canonical transactions. Team reports cover assigned exceptions; the Supervisor review queue covers their team's exceptions and unassigned exceptions. Receipt dates determine the period.</p>
    <form onSubmit={generate}>
      <label>Team <select value={team} onChange={(event) => setTeam(event.target.value)}><option value="">My default report scope</option>
        {teams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Arrival start date (UTC, inclusive) <input type="date" value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>Arrival end date (UTC, exclusive) <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} /></label>
      <button type="submit" disabled={busy}>Generate report</button>
    </form>
    {error && <p role="alert">{error}</p>}{busy && <p role="status">Preparing report…</p>}
    {report && <>
      <p>Scope: {report.scope} · As of: {new Date(report.as_of).toLocaleString()}</p>
      <p>Period: {report.period_start || 'All arrivals'} to {report.period_end || 'present'} · Team: {report.team_id || 'Default scope'}</p>
      <dl>{Object.entries(report.counts).map(([key, value]) => <div key={key}><dt>{label(key)}</dt><dd data-summary-count={key}>{value}</dd></div>)}</dl>
      <h3>Recorded payment amounts by currency</h3><p>Recorded amounts are not losses. No currency conversion or combined currency total.</p>
      <table aria-label="Summary currencies"><thead><tr><th>Currency</th><th>Transactions</th><th>Amounts recorded</th><th>Total recorded amount</th><th>Failed transaction amount</th></tr></thead>
        <tbody>{report.currencies.map((item) => <tr key={item.currency || 'unspecified'}><td>{item.currency || 'Unspecified'}</td><td>{item.transactions}</td><td>{item.amounts_recorded}</td><td>{item.recorded_amount ?? 'Unavailable'}</td><td>{item.failed_recorded_amount ?? 'No recorded amount'}</td></tr>)}</tbody></table>
      <h3>Department / category breakdown</h3>
      <p>Departments come from the imported classification. Missing values are Uncategorized. Amounts remain separate for each currency.</p>
      {Array.isArray(report.departments) ? <>
        <p>Showing {report.departments.length} of {report.departments_group_count} department/currency groups{report.departments_truncated ? ` (largest ${report.departments_limit} groups)` : ''}.</p>
        <div className="table-container"><table aria-label="Summary departments"><thead><tr><th>Department / category</th><th>Currency</th><th>Transactions</th><th>Processed</th><th>Flagged by rules</th><th>Recorded amount</th></tr></thead>
          <tbody>{report.departments.map((item) => <tr key={JSON.stringify([item.category, item.currency])}>
            <td>{item.category}</td><td>{item.currency || 'Unspecified'}</td><td>{item.transactions}</td><td>{item.completed}</td><td>{item.failed_transactions}</td><td>{item.recorded_amount ?? 'Unavailable'}</td>
          </tr>)}</tbody></table></div>
        {!report.departments.length && <p>No department groups in this report scope.</p>}
      </> : <p>Department breakdown is unavailable for this report.</p>}
      <h3>Saved rule outcomes</h3><table aria-label="Summary rules"><thead><tr><th>Rule</th><th>Passed</th><th>Failed</th><th>Not evaluated</th><th>Missing or unknown outcome</th></tr></thead>
        <tbody>{report.rules.map((rule) => <tr key={rule.rule_key}><td>{label(rule.rule_key)}</td><td>{rule.passed}</td><td>{rule.failed}</td><td>{rule.not_evaluated}</td><td>{rule.missing_or_unknown}</td></tr>)}</tbody></table>
      <p>Schedule: latest {report.schedule.length} of {report.counts.transactions} transactions (maximum {report.schedule_limit}). Aggregate totals cover the full authorized report population.</p>
      <p>Each download generates a fresh snapshot using these report filters and rechecks access. New arrivals or review changes may change the exported totals.</p>
      {['html', 'xlsx', 'pdf'].map((format) => <button type="button" key={format} disabled={busy} onClick={() => download(format)}>Summary {format.toUpperCase()}</button>)}
    </>}
  </section>;
}
