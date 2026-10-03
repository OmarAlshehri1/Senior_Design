import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import { vendorsService } from '../services/vendorsService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';

const TABS = Object.freeze(['All Vendors', 'Watchlist', 'Blocked Vendors']);

export default function Vendors() {
  const { can } = useAuthorization();
  const [tab, setTab] = useState(TABS[0]);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => vendorsService.listVendors({ query: { page: 1, page_size: 100 } })
    .then(setResult).catch((reason) => setError(reason instanceof Error ? reason.message : 'Vendor list unavailable.'));
  useEffect(() => { refresh(); }, []);
  const visible = result.items.filter((vendor) => tab === 'All Vendors'
    || (tab === 'Watchlist' && vendor.monitoringStatus === 'WATCHLISTED')
    || (tab === 'Blocked Vendors' && vendor.monitoringStatus === 'BLOCKED'));
  const act = async (operation) => {
    const reason = window.prompt('Enter a reason for this monitored workflow:');
    if (!reason?.trim()) return;
    setBusy(true); setError(null);
    try { await operation(reason.trim()); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Vendor request failed.'); }
    finally { setBusy(false); }
  };
  const canRequestWatchlist = can(PERMISSIONS.REQUEST_VENDOR_WATCHLIST);
  const canReviewWatchlist = can(PERMISSIONS.REVIEW_VENDOR_WATCHLIST_REQUEST);
  const canRequestBlock = can(PERMISSIONS.REQUEST_VENDOR_BLOCK);
  const canManageBlock = can(PERMISSIONS.MANAGE_VENDOR_BLOCK);
  return <div className="operations-page vendors-page">
    <div className="page-header"><div><span className="page-eyebrow">Monitoring</span><h1>Vendor Monitoring</h1><p>Review vendor risk signals and governed monitoring status.</p></div></div>
    {error && <div className="request-state request-state-error" role="alert">{error}</div>}
    <section className="operations-summary" aria-label="Vendor monitoring summary">
      {[['Monitored Vendors', result.total], ['Watchlisted', result.items.filter((v) => v.monitoringStatus === 'WATCHLISTED').length], ['Blocked in Audit Monitoring', result.items.filter((v) => v.monitoringStatus === 'BLOCKED').length], ['Open Vendor Cases', result.items.reduce((n, v) => n + (v.openCases ?? 0), 0)]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value}</strong></article>)}
    </section>
    <section className="operations-card" aria-labelledby="vendor-list-heading">
      <div className="operations-card-header"><div><h2 id="vendor-list-heading">Vendors</h2><p>Blocking changes audit monitoring only; it does not prevent ERP payments.</p></div></div>
      <div className="operations-tabs" role="tablist" aria-label="Vendor views">{TABS.map((item) => <button key={item} role="tab" type="button" aria-selected={tab === item} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
      {visible.length === 0 ? <ManagementEmptyState title={tab === 'All Vendors' ? 'No vendors are available.' : `No ${tab.toLowerCase()} are available.`} description="Vendor data comes from the approved-vendor registry." /> : <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Vendor</th><th>Monitoring Status</th><th>Risk Level</th><th>Average Risk Score</th><th>Active Alerts</th><th>Open Cases</th><th>Actions</th></tr></thead><tbody>{visible.map((vendor) => <tr key={vendor.id}><td><Link to={`/vendors/${encodeURIComponent(vendor.id)}`}>{vendor.name ?? vendor.id}</Link></td><td>{vendor.monitoringStatus}</td><td>{vendor.riskLevel ?? '—'}</td><td>{vendor.averageRiskScore ?? '—'}</td><td>{vendor.activeAlerts ?? 0}</td><td>{vendor.openCases ?? 0}</td><td>
        {canRequestWatchlist && vendor.monitoringStatus === 'NORMAL' && <button type="button" disabled={busy} onClick={() => act((reason) => vendorsService.requestVendorWatchlist(vendor.id, reason))}>Request Watchlist</button>}
        {canReviewWatchlist && vendor.monitoringStatus === 'WATCHLISTED' && <button type="button" disabled={busy} onClick={() => act((note) => vendorsService.removeVendorWatchlist(vendor.id, note))}>Remove Watchlist</button>}
        {canRequestBlock && vendor.monitoringStatus !== 'BLOCKED' && <button type="button" disabled={busy} onClick={() => act((reason) => vendorsService.requestVendorBlock(vendor.id, reason))}>Request Block</button>}
        {canManageBlock && vendor.monitoringStatus === 'BLOCKED' && <button type="button" disabled={busy} onClick={() => act((note) => vendorsService.unblockVendor(vendor.id, note))}>Unblock</button>}
      </td></tr>)}</tbody></table></div>}
      <span className="sr-only">{visible.length} vendor records</span>
    </section>
  </div>;
}
