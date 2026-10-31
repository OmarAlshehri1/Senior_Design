import DateTime from '../components/DateTime.jsx';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeftIcon } from '../components/icons.jsx';
import { vendorsService } from '../services/vendorsService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';
import { MetricStrip, Panel } from '../components/ui/Layout.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/RequestStateView.jsx';
import { formatAmount, MONITORING_TONES, riskStatusPillClass, titleCase } from '../components/statusUtils.js';
import { vendorActionKeys, vendorActionLabel, VendorReasonDialog } from '../components/VendorActions.jsx';
import { eventLabel } from '../utils/presentation.js';

export const VENDOR_PROFILE_SECTIONS = Object.freeze(['Overview', 'Transactions', 'Alerts', 'Cases', 'Risk History', 'Monitoring History']);
const riskLabel = (level) => (level ? `${titleCase(level)} Risk` : 'Not available');

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
  if (error && loadedId === vendorId && !bundle) return <div className="page detail-state-page"><section className="panel"><ErrorState title="Vendor profile unavailable." message={error} onRetry={refresh} retryLabel="Retry vendor profile" />
    <div className="detail-state-actions"><Link className="btn btn-ghost btn-sm" to="/vendors"><ArrowLeftIcon width={15} height={15} />Back to Vendors</Link></div></section></div>;
  if (!bundle || loadedId !== vendorId) return <div className="page detail-state-page"><section className="panel"><LoadingState message="Loading vendor profile…" /></section></div>;
  return <VendorProfileContent bundle={bundle} error={error} busy={busy || refreshing} refreshing={refreshing} can={can} act={act} onRefresh={refresh} />;
}

export function VendorProfileContent({ bundle, error, busy, refreshing, can, act, onRefresh }) {
  const [actionRequest, setActionRequest] = useState(null);
  const vendor = bundle.vendor;
  const transactions = bundle.transactions ?? [];
  const history = bundle.history ?? [];
  const riskHistory = bundle.risk_history ?? [];
  const requests = bundle.requests ?? [];
  const openWatchlist = can(PERMISSIONS.REVIEW_VENDOR_WATCHLIST_REQUEST);
  const openBlock = can(PERMISSIONS.MANAGE_VENDOR_BLOCK);
  const alerts = transactions.flatMap((tx) => tx.alerts ?? []);
  const cases = transactions.flatMap((tx) => tx.cases ?? []);
  const pending = requests.filter((request) => request.status === 'PENDING').length;
  const actions = vendorActionKeys(vendor, can);
  return <div className="page vendor-profile-page">
    <header className="detail-header">
      <Link className="back-link" to="/vendors"><ArrowLeftIcon width={15} height={15} aria-hidden="true" />Vendors</Link>
      <div className="detail-header-main">
        <div className="detail-header-copy">
          <p className="page-eyebrow">Vendor profile</p>
          <div className="detail-title-row"><h1>{vendor.name}</h1><span className={`badge badge-${MONITORING_TONES[vendor.monitoringStatus] ?? 'neutral'}`}>{titleCase(vendor.monitoringStatus)}</span></div>
          <p className="detail-subtitle">Vendor ID <span className="reference-text">{vendor.vendorId ?? vendor.id}</span></p>
        </div>
        {actions.length > 0 && act && <div className="page-header-actions">{actions.map((key) => <button key={key} type="button" className={`btn ${key === 'REQUEST_BLOCK' ? 'btn-danger' : 'btn-secondary'}`} disabled={busy} onClick={() => setActionRequest({ key, vendor })}>{vendorActionLabel(key)}</button>)}</div>}
      </div>
    </header>
    {error && <div className="inline-alert" role="alert">{error} Displayed values are from the last successful load.{onRefresh && <button type="button" className="btn btn-secondary btn-sm" onClick={onRefresh} disabled={busy}>Refresh vendor profile</button>}</div>}
    {refreshing && <p className="inline-status" role="status">Refreshing vendor profile… Previous values are shown until the request completes.</p>}
    <MetricStrip label="Vendor activity" items={[
      { label: 'Transactions', value: transactions.length, hint: 'Linked payments', tone: 'primary' },
      { label: 'Active alerts', value: alerts.filter((a) => a.status === 'ACTIVE').length, hint: 'Awaiting review', tone: 'medium' },
      { label: 'Open cases', value: cases.filter((c) => !['CLOSED', 'RESOLVED'].includes(c.status)).length, hint: 'Under investigation' },
      { label: 'Pending requests', value: pending, hint: 'Monitoring decisions' },
    ]} />

    {requests.length > 0 && <Panel id="vendor-requests-heading" title="Monitoring requests" description="Watchlist and block requests need an independent decision." flush>
      <div className="table-wrap"><table className="data-table"><thead><tr><th>Type</th><th>Status</th><th>Reason</th><th>Requested</th><th>Decision</th></tr></thead><tbody>{requests.map((request) => <tr key={request.id}>
        <td data-label="Type">{titleCase(request.request_type)}</td>
        <td data-label="Status"><span className={`badge badge-${request.status === 'PENDING' ? 'info' : request.status === 'APPROVED' ? 'low' : 'neutral'}`}>{titleCase(request.status)}</span></td>
        <td data-label="Reason">{request.reason}</td>
        <td data-label="Requested"><DateTime value={request.requested_at} compact showZone={false} /></td>
        <td data-label="Decision">{request.status === 'PENDING' && act && ((request.request_type === 'WATCHLIST' && openWatchlist) || (request.request_type === 'BLOCK' && openBlock)) ? <div className="row-actions"><button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => act(() => vendorsService.reviewVendorWatchlistRequest(request.id, true))}>Approve</button><button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => act(() => vendorsService.reviewVendorWatchlistRequest(request.id, false))}>Reject</button></div> : '—'}</td>
      </tr>)}</tbody></table></div>
    </Panel>}

    <Panel id="vendor-records-heading" title="Related audit records" description="Payments to this vendor with their latest risk result." flush>
      {transactions.length === 0 ? <EmptyState compact title="No transactions for this vendor." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Transaction</th><th>Date</th><th>Amount</th><th>Risk</th><th>Alerts</th><th>Cases</th></tr></thead><tbody>{transactions.map((tx) => <tr key={tx.id}>
        <td data-label="Transaction"><Link className="reference-text truncate" title={tx.id} to={`/transactions/${encodeURIComponent(tx.id)}`}>{tx.id}</Link></td>
        <td data-label="Date"><DateTime value={tx.timestamp} compact showZone={false} /></td>
        <td data-label="Amount" className="numeric">{formatAmount(tx.amount, tx.currency)}</td>
        <td data-label="Risk"><span className={riskStatusPillClass(riskLabel(tx.risk_level))}>{riskLabel(tx.risk_level)}</span>{tx.risk_score != null && <span className="secondary-metadata">Score {tx.risk_score}</span>}</td>
        <td data-label="Alerts">{(tx.alerts ?? []).length}</td>
        <td data-label="Cases">{(tx.cases ?? []).length}</td>
      </tr>)}</tbody></table></div>}
    </Panel>

    <div className="vendor-profile-grid">
      <details className="disclosure">
        <summary><span className="disclosure-summary-copy">Risk history<small>{riskHistory.length} recorded scores</small></span></summary>
        <div className="disclosure-body disclosure-body-flush">{riskHistory.length === 0 ? <EmptyState compact title="No risk-score history yet." /> : <div className="table-wrap"><table className="data-table"><thead><tr><th>Transaction</th><th>Risk level</th><th>Score</th><th>Scoring version</th><th>Calculated</th></tr></thead><tbody>{riskHistory.map((item) => <tr key={`${item.transaction_id}-${item.calculated_at}`}>
          <td data-label="Transaction"><span className="reference-text truncate" title={item.transaction_id}>{item.transaction_id}</span></td>
          <td data-label="Risk level"><span className={riskStatusPillClass(riskLabel(item.risk_level))}>{riskLabel(item.risk_level)}</span></td>
          <td data-label="Score" className="numeric">{item.risk_score}</td>
          <td data-label="Scoring version">{item.scoring_version}</td>
          <td data-label="Calculated"><DateTime value={item.calculated_at} compact showZone={false} /></td>
        </tr>)}</tbody></table></div>}</div>
      </details>
      <Panel id="vendor-history-heading" title="Monitoring history">
        {history.length === 0 ? <EmptyState compact title="No status changes recorded." /> : <ol className="timeline">{history.map((item) => <li key={item.id}>
          <strong>{eventLabel(item.action)}: {titleCase(item.previous_status)} → {titleCase(item.new_status)}</strong>
          <span className="timeline-meta">{item.actor_name} ({titleCase(item.actor_role)}) · <DateTime value={item.created_at} /></span>
          {item.note && <p>{item.note}</p>}
        </li>)}</ol>}
      </Panel>
    </div>
    <VendorReasonDialog request={actionRequest} onClose={() => setActionRequest(null)} onDone={onRefresh} />
  </div>;
}
