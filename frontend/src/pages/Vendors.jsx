import { useState } from 'react';
import { Link } from 'react-router-dom';
import usePagedResource from '../hooks/usePagedResource.js';
import CollectionPagination from '../components/CollectionPagination.jsx';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import { vendorsService } from '../services/vendorsService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';

const TABS = Object.freeze(['All Vendors', 'Watchlist', 'Blocked Vendors']);

export default function Vendors() {
  const { can } = useAuthorization();
  const collection = usePagedResource(vendorsService.listVendors, { status: null });
  const { items: visible, total, query, resource } = collection;
  const tab = query.status === 'WATCHLISTED' ? 'Watchlist' : query.status === 'BLOCKED' ? 'Blocked Vendors' : TABS[0];
  const [actionError, setActionError] = useState(null);
  const [busy, setBusy] = useState(false);
  const error = collection.error || actionError;
  const loaded = collection.status === 'success';
  const act = async (operation) => {
    const reason = window.prompt('Enter a reason for this monitored workflow:');
    if (!reason?.trim()) return;
    setBusy(true); setActionError(null);
    try { await operation(reason.trim()); await resource.load(); }
    catch (failure) { setActionError(failure instanceof Error ? failure.message : 'Vendor request failed.'); }
    finally { setBusy(false); }
  };
  const canRequestWatchlist = can(PERMISSIONS.REQUEST_VENDOR_WATCHLIST);
  const canReviewWatchlist = can(PERMISSIONS.REVIEW_VENDOR_WATCHLIST_REQUEST);
  const canRequestBlock = can(PERMISSIONS.REQUEST_VENDOR_BLOCK);
  const canManageBlock = can(PERMISSIONS.MANAGE_VENDOR_BLOCK);
  return <div className="operations-page vendors-page">
    <div className="page-header"><div><span className="page-eyebrow">Monitoring</span><h1>Vendor Monitoring</h1><p>Review vendor risk signals and governed monitoring status.</p></div></div>
    {error && <div className="request-state request-state-error" role="alert">{error} <button type="button" className="btn btn-secondary" onClick={() => { setActionError(null); resource.load(); }}>Retry</button></div>}
    <section className="operations-summary" aria-label="Vendor monitoring summary">
      {[['Vendors matching view', total], ['Watchlisted on page', loaded ? visible.filter((v) => v.monitoringStatus === 'WATCHLISTED').length : null], ['Blocked on page', loaded ? visible.filter((v) => v.monitoringStatus === 'BLOCKED').length : null], ['Open cases on page', loaded ? visible.reduce((n, v) => n + (v.openCases ?? 0), 0) : null]].map(([label, value]) => <article key={label}><span>{label}</span><strong>{value ?? '—'}</strong></article>)}
    </section>
    <section className="operations-card" aria-labelledby="vendor-list-heading" aria-busy={collection.status === 'loading'}>
      <div className="operations-card-header"><div><h2 id="vendor-list-heading">Vendors</h2><p>Blocking changes audit monitoring only; it does not prevent ERP payments.</p></div></div>
      <div className="operations-tabs" role="tablist" aria-label="Vendor views">{TABS.map((item) => <button key={item} role="tab" type="button" aria-selected={tab === item} className={tab === item ? 'is-active' : ''} disabled={busy} onClick={() => { setActionError(null); resource.setFilters({ status: item === 'Watchlist' ? 'WATCHLISTED' : item === 'Blocked Vendors' ? 'BLOCKED' : null }); }}>{item}</button>)}</div>
      {collection.status === 'loading' ? <p role="status">{collection.refreshing ? 'Refreshing vendors…' : 'Loading vendors…'}</p> : collection.status === 'error' ? null : visible.length === 0 ? <ManagementEmptyState title={total > 0 ? 'No vendors on this page. Retry or browse another page.' : tab === 'All Vendors' ? 'No vendors are available.' : 'No vendors match this monitoring status.'} description="Vendor data comes from the approved-vendor registry." /> : <VendorsTable vendors={visible} busy={busy} act={act} canRequestWatchlist={canRequestWatchlist} canReviewWatchlist={canReviewWatchlist} canRequestBlock={canRequestBlock} canManageBlock={canManageBlock} />}
      <CollectionPagination collection={collection} itemLabel="vendors matching view" disabled={busy} />
    </section>
  </div>;
}

export function VendorsTable({ vendors, busy, act, canRequestWatchlist, canReviewWatchlist, canRequestBlock, canManageBlock }) {
  return <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Vendor</th><th>Monitoring Status</th><th>Risk Level</th><th>Average Risk Score</th><th>Active Alerts</th><th>Open Cases</th><th>Actions</th></tr></thead><tbody>{vendors.map((vendor) => <tr key={vendor.id}><td data-label="Vendor"><Link to={`/vendors/${encodeURIComponent(vendor.id)}`}>{vendor.name ?? vendor.id}</Link></td><td data-label="Monitoring Status">{vendor.monitoringStatus}</td><td data-label="Risk Level">{vendor.riskLevel ?? '—'}</td><td data-label="Average Risk Score">{vendor.averageRiskScore ?? '—'}</td><td data-label="Active Alerts">{vendor.activeAlerts ?? 0}</td><td data-label="Open Cases">{vendor.openCases ?? 0}</td><td data-label="Actions">
        {canRequestWatchlist && vendor.monitoringStatus === 'NORMAL' && <button type="button" disabled={busy} onClick={() => act((reason) => vendorsService.requestVendorWatchlist(vendor.id, reason))}>Request Watchlist</button>}
        {canReviewWatchlist && vendor.monitoringStatus === 'WATCHLISTED' && <button type="button" disabled={busy} onClick={() => act((note) => vendorsService.removeVendorWatchlist(vendor.id, note))}>Remove Watchlist</button>}
        {canRequestBlock && vendor.monitoringStatus !== 'BLOCKED' && <button type="button" disabled={busy} onClick={() => act((reason) => vendorsService.requestVendorBlock(vendor.id, reason))}>Request Block</button>}
        {canManageBlock && vendor.monitoringStatus === 'BLOCKED' && <button type="button" disabled={busy} onClick={() => act((note) => vendorsService.unblockVendor(vendor.id, note))}>Unblock</button>}
      </td></tr>)}</tbody></table></div>;
}
