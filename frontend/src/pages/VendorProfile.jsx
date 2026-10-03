import { useEffect, useState } from 'react';
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
  const refresh = () => vendorsService.getVendor(vendorId).then(setBundle)
    .catch((reason) => setError(reason instanceof Error ? reason.message : 'Vendor profile unavailable.'));
  useEffect(() => { setBundle(null); setError(null); refresh(); }, [vendorId]);
  const act = async (operation) => {
    setBusy(true); setError(null);
    try { await operation(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Vendor action failed.'); }
    finally { setBusy(false); }
  };
  if (error && !bundle) return <div className="card operational-not-found"><span className="page-eyebrow">Vendor lookup</span><h1>Vendor profile unavailable.</h1><p>{error}</p><Link className="btn btn-primary" to="/vendors"><ArrowLeftIcon width={15} height={15} />Back to Vendor Monitoring</Link></div>;
  if (!bundle) return <div className="request-state" role="status">Loading vendor profile…</div>;
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
    {error && <div className="request-state request-state-error" role="alert">{error}</div>}
    <header className="operational-detail-header"><div><span className="page-eyebrow">Vendor Risk Profile</span><h1>{vendor.name}</h1><p>Vendor ID {vendor.vendorId ?? vendor.id}</p></div><span className="workflow-status">{vendor.monitoringStatus}</span></header>
    <section className="operations-summary">{[['Transactions', transactions.length], ['Active Alerts', alerts.filter((a) => a.status === 'ACTIVE').length], ['Open Cases', cases.filter((c) => !['CLOSED', 'RESOLVED'].includes(c.status)).length], ['Requests', requests.length]].map(([label, count]) => <article key={label}><span>{label}</span><strong>{count}</strong></article>)}</section>
    <section className="operations-card"><div className="operations-tabs" aria-label="Vendor profile sections">{VENDOR_PROFILE_SECTIONS.map((label) => <span className="workflow-status" key={label}>{label}</span>)}</div>
      <h2>Monitoring requests</h2>{requests.length === 0 ? <p>No monitoring requests.</p> : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Type</th><th>Status</th><th>Reason</th><th>Requested</th><th>Decision</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}><td>{request.request_type}</td><td>{request.status}</td><td>{request.reason}</td><td>{request.requested_at ? new Date(request.requested_at).toLocaleString() : '—'}</td><td>{request.status === 'PENDING' && ((request.request_type === 'WATCHLIST' && openWatchlist) || (request.request_type === 'BLOCK' && openBlock)) ? <><button type="button" disabled={busy} onClick={() => act(() => vendorsService.reviewVendorWatchlistRequest(request.id, true))}>Approve</button> <button type="button" disabled={busy} onClick={() => act(() => vendorsService.reviewVendorWatchlistRequest(request.id, false))}>Reject</button></> : '—'}</td></tr>)}</tbody></table></div>}
      <h2>Related audit records</h2>{transactions.length === 0 ? <p>No transactions are associated with this vendor.</p> : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Transaction</th><th>Date</th><th>Amount</th><th>Risk</th><th>Alerts</th><th>Cases</th></tr></thead><tbody>{transactions.map((tx) => <tr key={tx.id}><td>{tx.id}</td><td>{tx.timestamp ? new Date(tx.timestamp).toLocaleString() : '—'}</td><td>{tx.amount ?? '—'} {tx.currency ?? ''}</td><td>{tx.risk_level ?? '—'} {tx.risk_score ?? ''}</td><td>{(tx.alerts ?? []).length}</td><td>{(tx.cases ?? []).length}</td></tr>)}</tbody></table></div>}
      <h2>Risk history</h2>{riskHistory.length === 0 ? <p>No persisted risk-score history.</p> : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Transaction</th><th>Risk level</th><th>Score</th><th>Scoring version</th><th>Calculated</th></tr></thead><tbody>{riskHistory.map((item) => <tr key={`${item.transaction_id}-${item.calculated_at}`}><td>{item.transaction_id}</td><td>{item.risk_level}</td><td>{item.risk_score}</td><td>{item.scoring_version}</td><td>{new Date(item.calculated_at).toLocaleString()}</td></tr>)}</tbody></table></div>}
      <h2>Monitoring history</h2>{history.length === 0 ? <p>No status changes recorded.</p> : <ol>{history.map((item) => <li key={item.id}>{item.action}: {item.previous_status} → {item.new_status} — {item.actor_name} ({item.actor_role}), {new Date(item.created_at).toLocaleString()}{item.note ? ` — ${item.note}` : ''}</li>)}</ol>}
    </section>
  </div>;
}
