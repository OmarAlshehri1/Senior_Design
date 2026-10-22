import DateTime from '../components/DateTime.jsx';
import { DISPLAY_TIME_ZONE_LABEL } from '../utils/dateTime.js';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '../components/icons.jsx';
import { vendorsService } from '../services/vendorsService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';

export const VENDOR_PROFILE_SECTIONS = Object.freeze(['Overview', 'Transactions', 'Alerts', 'Cases', 'Risk History', 'Monitoring History']);

export default function VendorProfile() {
  const { vendorId } = useParams();
  const { can } = useAuthorization();
  const [bundle, setBundle] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadedId, setLoadedId] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const request = useRef({ sequence: 0, controller: null });
  const refresh = async () => {
    const sequence = ++request.current.sequence;
    request.current.controller?.abort();
    request.current.controller = new AbortController();
    setRefreshing(true);
    setError(null);
    try {
      const result = await vendorsService.getVendor(vendorId, { signal: request.current.controller.signal });
      if (sequence !== request.current.sequence) return;
      setBundle(result); setLoadedId(vendorId);
    } catch (reason) {
      if (sequence !== request.current.sequence) return;
      setBundle(null); setLoadedId(vendorId);
      setError(reason instanceof Error ? reason.message : 'Vendor profile unavailable.');
    } finally { if (sequence === request.current.sequence) setRefreshing(false); }
  };
  useEffect(() => {
    setBundle(null); setError(null); refresh();
    return () => { request.current.sequence += 1; request.current.controller?.abort(); };
  }, [vendorId]);
  const act = async (operation) => {
    const sequence = request.current.sequence;
    setBusy(true); setError(null);
    try { await operation(); if (sequence === request.current.sequence) await refresh(); }
    catch (reason) { if (sequence === request.current.sequence) setError(reason instanceof Error ? reason.message : 'Vendor action failed.'); }
    finally { setBusy(false); }
  };
  if (error && loadedId === vendorId && !bundle) return <div className="card operational-not-found" role="alert"><span className="page-eyebrow">Vendor lookup</span><h1>Vendor profile unavailable.</h1><p>{error}</p><button type="button" className="btn btn-secondary" onClick={refresh} disabled={refreshing}>Retry vendor profile</button><Link className="btn btn-primary" to="/vendors"><ArrowLeftIcon width={15} height={15} />Back to Vendor Monitoring</Link></div>;
  if (!bundle || loadedId !== vendorId) return <div className="request-state" role="status">Loading vendor profile…</div>;
  return <VendorProfileContent bundle={bundle} error={error} busy={busy || refreshing} refreshing={refreshing} can={can} act={act} onRefresh={refresh} />;
}

export function VendorProfileContent({ bundle, error, busy, refreshing, can, act, onRefresh }) {
  const vendor = bundle.vendor;
  const transactions = bundle.transactions ?? [];
  const history = bundle.history ?? [];
  const riskHistory = bundle.risk_history ?? [];
  const requests = bundle.requests ?? [];
  const openWatchlist = can(PERMISSIONS.REVIEW_VENDOR_WATCHLIST_REQUEST);
  const openBlock = can(PERMISSIONS.MANAGE_VENDOR_BLOCK);
  const alerts = transactions.flatMap((tx) => tx.alerts ?? []);
  const cases = transactions.flatMap((tx) => tx.cases ?? []);
  return <div className="operations-page vendor-profile-page"><Link className="detail-back-link" to="/vendors"><ArrowLeftIcon width={15} height={15} />Back to Vendor Monitoring</Link>
    {error && <div className="request-state request-state-error" role="alert">{error}<p>Displayed values are from the last successful load.</p>{onRefresh && <button type="button" className="btn btn-secondary" onClick={onRefresh} disabled={busy}>Refresh vendor profile</button>}</div>}
    {refreshing && <p role="status">Refreshing vendor profile… Previous values are shown until the request completes.</p>}
    <header className="operational-detail-header"><div><span className="page-eyebrow">Vendor Risk Profile</span><h1>{vendor.name}</h1><p>Vendor ID {vendor.vendorId ?? vendor.id}</p></div><span className="workflow-status">{vendor.monitoringStatus}</span></header>
    <section className="operations-summary">{[['Transactions', transactions.length], ['Active Alerts', alerts.filter((a) => a.status === 'ACTIVE').length], ['Open Cases', cases.filter((c) => !['CLOSED', 'RESOLVED'].includes(c.status)).length], ['Requests', requests.length]].map(([label, count]) => <article key={label}><span>{label}</span><strong>{count}</strong></article>)}</section>
    <section className="operations-card"><div className="operations-tabs" aria-label="Vendor profile sections">{VENDOR_PROFILE_SECTIONS.map((label) => <span className="workflow-status" key={label}>{label}</span>)}</div>
      <h2>Monitoring requests</h2>{requests.length === 0 ? <p>No monitoring requests.</p> : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Type</th><th>Status</th><th>Reason</th><th>Requested ({DISPLAY_TIME_ZONE_LABEL})</th><th>Decision</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td data-label="Type">{request.request_type}</td><td data-label="Status">{request.status}</td><td data-label="Reason">{request.reason}</td><td data-label={`Requested (${DISPLAY_TIME_ZONE_LABEL})`}><DateTime value={request.requested_at} compact showZone={false} /></td><td data-label="Decision">{request.status === 'PENDING' && ((request.request_type === 'WATCHLIST' && openWatchlist) || (request.request_type === 'BLOCK' && openBlock)) ? <><button type="button" disabled={busy} onClick={() => act(() => vendorsService.reviewVendorWatchlistRequest(request.id, true))}>Approve</button> <button type="button" disabled={busy} onClick={() => act(() => vendorsService.reviewVendorWatchlistRequest(request.id, false))}>Reject</button></> : '—'}</td></tr>)}</tbody></table></div>}
      <h2>Related audit records</h2>{transactions.length === 0 ? <p>No transactions are associated with this vendor.</p> : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Transaction</th><th>Date ({DISPLAY_TIME_ZONE_LABEL})</th><th>Amount</th><th>Risk</th><th>Alerts</th><th>Cases</th></tr></thead><tbody>{transactions.map((tx) => <tr key={tx.id}><td data-label="Transaction">{tx.id}</td><td data-label={`Date (${DISPLAY_TIME_ZONE_LABEL})`}><DateTime value={tx.timestamp} compact showZone={false} /></td><td data-label="Amount">{tx.amount ?? '—'} {tx.currency ?? ''}</td><td data-label="Risk">{tx.risk_level ?? '—'} {tx.risk_score ?? ''}</td><td data-label="Alerts">{(tx.alerts ?? []).length}</td><td data-label="Cases">{(tx.cases ?? []).length}</td></tr>)}</tbody></table></div>}
      <h2>Risk history</h2>{riskHistory.length === 0 ? <p>No persisted risk-score history.</p> : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Transaction</th><th>Risk level</th><th>Score</th><th>Scoring version</th><th>Calculated ({DISPLAY_TIME_ZONE_LABEL})</th></tr></thead><tbody>{riskHistory.map((item) => <tr key={`${item.transaction_id}-${item.calculated_at}`}><td data-label="Transaction">{item.transaction_id}</td><td data-label="Risk level">{item.risk_level}</td><td data-label="Score">{item.risk_score}</td><td data-label="Scoring version">{item.scoring_version}</td><td data-label={`Calculated (${DISPLAY_TIME_ZONE_LABEL})`}><DateTime value={item.calculated_at} compact showZone={false} /></td></tr>)}</tbody></table></div>}
      <h2>Monitoring history</h2>{history.length === 0 ? <p>No status changes recorded.</p> : <ol>{history.map((item) => <li key={item.id}>{item.action}: {item.previous_status} → {item.new_status} — {item.actor_name} ({item.actor_role}), <DateTime value={item.created_at} />{item.note ? ` — ${item.note}` : ''}</li>)}</ol>}
    </section>
  </div>;
}
