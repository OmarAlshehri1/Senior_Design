import { useEffect, useRef, useState } from 'react';
import AuditCoverage, { CoverageCount } from './AuditCoverage.jsx';

const INDICATORS = {
  INDICATED: ['Potential splitting', 'indicated'],
  NOT_INDICATED: ['Not indicated', 'clear'],
  NOT_APPLICABLE: ['At / above threshold', 'neutral'],
  NOT_EVALUATED: ['Needs more data', 'pending'],
};
const STATES = { READY: 'Ready to start', RUNNING: 'Receiving records', PAUSED: 'Paused',
  DRAINING: 'Finishing checks', COMPLETED: 'Pilot complete', INITIALIZING: 'Preparing local session', ERROR: 'Session needs attention' };
function clock(value) {
  return value ? new Date(value).toLocaleTimeString('en-GB', { hour12: false }) : '—';
}
function usd(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(number) : '—';
}

function FeedFrame({ embedded, children }) {
  if (embedded) return <section className="local-feed-shell local-feed-embedded" id="live-feed">{children}</section>;
  return <div className="app-shell local-feed-shell">
    <aside className="local-feed-sidebar">
      <div className="local-feed-brand">Audit System</div>
      <p className="local-feed-nav-label">LOCAL WORKSPACE</p>
      <a className="local-feed-nav active" href="#live-feed">Live simulation</a>
      <a className="local-feed-nav" href="#scenario">Scenario settings</a>
      <a className="local-feed-nav" href="/local-app.html#/transactions">Open Transactions</a>
      <div className="local-feed-sidebar-footer">Historical payments replay<br />Local session</div>
    </aside>
    <div className="main-area"><header className="local-feed-topbar"><strong>Continuous Auditing</strong><span className="local-feed-environment">LOCAL ONLY</span></header>
      <main className="page-content local-feed-content" id="live-feed">{children}</main>
    </div>
  </div>;
}

export default function LocalFeed({ embedded = false }) {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState('ALL');
  const [selected, setSelected] = useState(null);
  const [page, setPage] = useState(0);
  const [detailValue, setDetailValue] = useState(null);
  const [supportPage, setSupportPage] = useState(0);
  const [detailError, setDetailError] = useState('');
  const session = useRef(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    let timer;
    async function refresh() {
      try {
        const query = new URLSearchParams({ page: String(page), filter });
        const response = await fetch(`/__local_feed__/view?${query}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Local feed is unavailable. Keep the local launcher running.');
        const value = await response.json();
        if (!active) return;
        if (session.current !== value.session_id) { setSelected(null); setFilter('ALL'); setPage(0); session.current = value.session_id; }
        setSnapshot(value);
        setError(value.error ? 'The local session could not finish. Pause and resume, or start a new pilot.' : '');
      } catch (failure) {
        if (active && failure.name !== 'AbortError') setError(failure.message);
      } finally {
        if (active) timer = setTimeout(refresh, 1000);
      }
    }
    refresh();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [page, filter]);

  useEffect(() => {
    if (!selected) { setDetailValue(null); setDetailError(''); return; }
    let active = true;
    let timer;
    const controller = new AbortController();
    async function refreshDetail() {
      try {
        const query = new URLSearchParams({ record_id: selected, page: String(supportPage) });
        const response = await fetch(`/__local_feed__/detail?${query}`, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Payment details are temporarily unavailable.');
        const value = await response.json();
        if (!active || value.session_id !== session.current) return;
        setDetailValue(value.detail);
        setDetailError('');
        if (value.detail && (!value.detail.checked_at ||
          (value.detail.supporting_payments?.reconciled === false && ['RUNNING', 'DRAINING'].includes(value.status)))) {
          timer = setTimeout(refreshDetail, 1000);
        }
      } catch (failure) {
        if (active && failure.name !== 'AbortError') setDetailError(failure.message);
      }
    }
    refreshDetail();
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [selected, supportPage]);

  async function action(name) {
    setBusy(true);
    try {
      const response = await fetch(`/__local_feed__/${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      if (!response.ok) throw new Error('This action is unavailable while the local session is changing.');
      setError('');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  const state = snapshot?.status || 'INITIALIZING';
  const targetCount = snapshot?.target_count || 100;
  const latency = snapshot?.latency;
  const counts = snapshot?.counts || { received: 0, processed: 0, indicated: 0, pending: 0 };
  const pagination = snapshot?.pagination || { page: 0, page_size: 100, page_count: 1, matching: 0 };
  const pageCount = pagination.page_count;
  const currentPage = pagination.page;
  const rows = snapshot?.pagination?.filter === filter ? snapshot.rows : [];
  const detail = detailValue?.record_id === selected ? detailValue : null;
  const allRulesScenario = snapshot?.scenario === 'SIMULATED_ALL_RULES_WORKBOOK';
  const ghostScenario = allRulesScenario || snapshot?.scenario === 'SIMULATED_GHOST_WORKBOOK';
  const canStart = ['READY', 'PAUSED'].includes(state) && !busy && !error;

  return (
    <FeedFrame embedded={embedded}>
          <div className="local-feed-heading"><div><h1>{embedded ? "Transactions" : "Live payment feed"}</h1><p>{embedded ? "Incoming local payments and their processing status." : "Watch records arrive and receive their simulation results."}</p></div>
            <div className={`local-feed-connection ${error ? 'offline' : ''}`} role="status"><i />{error ? 'Connection needs attention' : snapshot ? 'Connected locally' : 'Connecting…'}</div></div>
          {ghostScenario ? <section className="local-feed-notice" id="scenario"><strong>{allRulesScenario ? 'SIMULATED five-rule workbook test' : 'SIMULATED Ghost Vendor test'}</strong>
            <span>{allRulesScenario ? `${targetCount} workbook payments · simulated actors, approval limits and vendor registry` : '11 workbook payments · 10 deliberately omitted vendor IDs · 1 registered active control'}</span>
            <p>{allRulesScenario ? 'All five rules use the workbook simulation values. History covers this delivered session only; 24-hour checks use arrival time. Open Details for saved results.' : 'Invented vendor IDs and registry omissions are test inputs. Open Details to see saved audit results. Other rules remain unevaluated.'}</p></section> :
          <section className="local-feed-notice" id="scenario"><strong>Experimental scenario</strong><span>Exact source vendor name · 10,000 USD threshold · 24 hours from arrival</span>
            <p>Dates remain historical. Indications require review; they do not establish a real policy violation or verified supplier identity.</p></section>}
          {error && <div className="local-feed-error" role="alert">{error}</div>}
          <div className="local-feed-stats">
            {[['Records received', counts.received, `of ${targetCount.toLocaleString('en-US')} pilot records`], ['Checks finished', counts.processed, ghostScenario ? 'Saved audit results ready' : 'Simulation indicator ready'],
              ghostScenario ? ['Ghost Vendor failures', counts.ghost_failed ?? 0, 'Deliberately omitted simulated vendors'] : ['Potential splitting', counts.indicated, 'Record evaluations; groups may repeat'], ['Awaiting checks', counts.pending, 'Received and still processing']].map(([label, value, hint]) => (
              <section className="local-feed-stat" key={label}><span>{label}</span><strong data-metric={label}>{value}</strong><small>{hint}</small></section>
            ))}
          </div>
          <section className="local-feed-panel local-feed-controls">
            <div><strong data-run-status={state}>{STATES[state] || state}</strong><p>{snapshot?.feed_rate || 1} records per second configured. Pause and resume keeps the same records and progress.</p>
              <progress aria-label="Pilot records received" max={targetCount} value={counts.received} />
              <small>Updated {clock(snapshot?.updated_at)} · {counts.received}/{targetCount} received</small>
              {latency?.samples > 0 && <p>Arrival to saved check: average {latency.mean_seconds.toFixed(2)} s · maximum {latency.max_seconds.toFixed(2)} s · {latency.samples} completed records</p>}</div>
            <div className="local-feed-buttons">
              <button className="local-feed-primary" disabled={!canStart} onClick={() => action('start')}>{state === 'PAUSED' ? 'Resume simulation' : `Start ${targetCount.toLocaleString('en-US')}-record pilot`}</button>
              <button disabled={busy || state !== 'RUNNING'} onClick={() => action('pause')}>Pause</button>
              <button disabled={busy || !['PAUSED', 'COMPLETED', 'ERROR'].includes(state)} onClick={() => action('reset')}>New pilot</button>
            </div>
          </section>
          <section className="local-feed-panel">
            <div className="local-feed-table-heading"><div><h2>Incoming payments</h2><p>Original transaction day and arrival time are shown separately.</p></div>
              <label>Show <select disabled={ghostScenario} value={filter} onChange={event => { setFilter(event.target.value); setPage(0); }} aria-label="Filter simulation results"><option value="ALL">All records</option>
                {Object.entries(INDICATORS).map(([key, [label]]) => <option key={key} value={key}>{label}</option>)}</select></label></div>
            <div className="local-feed-table-scroll"><table className="local-feed-table"><thead><tr><th>Record</th><th>Arrival</th><th>Original day</th><th>Vendor</th><th>Amount</th><th>Processing</th><th>Audit coverage</th><th>Simulation result</th><th><span className="local-feed-sr-only">Details</span></th></tr></thead>
              <tbody>{rows.map(row => {
                const [label, tone] = ghostScenario ? ['See saved audit details', 'neutral'] : INDICATORS[row.indicator?.status] || ['Awaiting checks', 'pending'];
                return <tr key={row.record_id} data-record-id={row.record_id}><td>#{String(row.sequence).padStart(3, '0')}</td><td>{clock(row.received_at)}</td>
                  <td>{row.source_date}</td><td className="local-feed-vendor">{row.vendor_name || 'Not provided'}</td><td className="local-feed-money">{usd(row.amount)}</td>
                  <td>{row.processing_status === 'COMPLETED' ? 'Checked' : row.processing_status === 'AUDITING' ? 'Checking…' : row.processing_status === 'VALIDATING' ? 'Validating…' : row.processing_status}</td>
                  <td><CoverageCount coverage={row.audit_coverage} /></td><td><span className={`local-feed-badge ${tone}`}>{label}</span></td><td><button className="local-feed-detail-button" onClick={() => { setSelected(row.record_id); setSupportPage(0); }} aria-label={`View details for record ${row.sequence}`}>Details</button></td></tr>;
              })}</tbody></table>
              {!rows.length && <div className="local-feed-empty"><strong>{counts.received ? 'No records match this filter' : 'Ready for the first payment'}</strong><p>{counts.received ? 'Choose another result to see more records.' : 'Start the pilot to watch the feed arrive here.'}</p></div>}
            </div>
            {pageCount > 1 && <div className="local-feed-table-heading"><span>{pagination.matching.toLocaleString('en-US')} matching records · Page {currentPage + 1} of {pageCount} · up to {pagination.page_size} rows per page</span>
              <div className="local-feed-buttons"><button disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous page</button><button disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>Next page</button></div></div>}
          </section>
          {selected && detailError && <div className="local-feed-error" role="alert">{detailError}</div>}
          {detail && <section className="local-feed-panel local-feed-details" aria-label="Payment simulation details"><div className="local-feed-table-heading"><h2>Record #{detail.sequence}</h2><button onClick={() => setSelected(null)}>Close details</button></div>
            <AuditCoverage coverage={detail.audit_coverage} rules={detail.rule_results} completed={detail.processing_status === 'COMPLETED'} />
            <p><strong>{detail.vendor_name}</strong> · {usd(detail.amount)}</p>
            {detail.indicator ? <><dl><div><dt>Total of payments individually below threshold</dt><dd>{usd(detail.indicator.candidate_total_amount)}</dd></div><div><dt>Matching records in window</dt><dd>{detail.indicator.candidate_transactions}</dd></div>
              <div><dt>Clock</dt><dd>Simulation arrival time</dd></div><div><dt>Threshold</dt><dd>10,000 USD — assumed for this scenario</dd></div></dl>
              <p>{detail.indicator.status === 'INDICATED' ? 'Several below-threshold records with the exact same source name exceed the assumed limit. Review supporting records.' : detail.indicator.status === 'NOT_APPLICABLE' ? 'The current payment is at or above the threshold and is excluded from this below-threshold pattern.' : detail.indicator.status === 'NOT_EVALUATED' ? 'Required grouping information or complete history was not available.' : 'The observed group does not exceed the assumed threshold.'}</p>
              <p className="local-feed-muted">Exact name matching does not verify legal identity. This result does not change real audit coverage or assign a combined risk score.</p>
              <div className="local-feed-table-heading"><div><h2>Payments included in this check</h2><p>Only payments available at this record's arrival are included. Original dates remain historical.</p></div></div>
              {detail.supporting_payments?.reconciled ? <div className="local-feed-table-scroll"><table className="local-feed-table" aria-label="Supporting payments"><thead><tr><th>Record</th><th>Voucher number</th><th>Amount (USD)</th><th>Original day</th><th>Arrival</th></tr></thead>
                <tbody>{detail.supporting_payments.rows.map(payment => <tr key={payment.record_id}><td>#{payment.sequence}{payment.record_id === detail.record_id ? ' (selected)' : ''}</td><td>{payment.voucher_number || 'Not provided'}</td><td>{usd(payment.amount)}</td><td>{payment.source_date}</td><td>{new Date(payment.received_at).toLocaleString('en-GB', { hour12: false })}</td></tr>)}</tbody>
                <tfoot><tr><th colSpan="2">{detail.supporting_payments.pagination.matching} payments in full window</th><td>{usd(detail.supporting_payments.total_amount)}</td><td colSpan="2">Matches the saved check</td></tr></tfoot></table>
                {detail.supporting_payments.pagination.page_count > 1 && <div className="local-feed-table-heading"><span>Supporting payments: page {detail.supporting_payments.pagination.page + 1} of {detail.supporting_payments.pagination.page_count}</span><div className="local-feed-buttons">
                  <button disabled={detail.supporting_payments.pagination.page === 0} onClick={() => setSupportPage(detail.supporting_payments.pagination.page - 1)}>Previous supporting page</button>
                  <button disabled={detail.supporting_payments.pagination.page + 1 >= detail.supporting_payments.pagination.page_count} onClick={() => setSupportPage(detail.supporting_payments.pagination.page + 1)}>Next supporting page</button></div></div>}</div>
                : <p role="status">Supporting payments are unavailable until the local service provides a list matching the saved count and total.</p>}
              </> : <p>{allRulesScenario ? 'All five saved audit outcomes appear above. SIMULATED identities, approval limits and registry omissions do not establish real supplier findings.' : ghostScenario ? 'This scenario tests Ghost Vendors. The saved rule outcomes appear above.' : 'Waiting for the simulation check to finish.'}</p>}
          </section>}
    </FeedFrame>
  );
}
