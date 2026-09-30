import { useState } from 'react';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import { VENDORS } from '../vendors/vendorModel.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';

const TABS = Object.freeze(['All Vendors', 'Watchlist', 'Blocked Vendors']);

export default function Vendors() {
  const { can } = useAuthorization();
  const [tab, setTab] = useState(TABS[0]);
  const canRequestWatchlist = can(PERMISSIONS.REQUEST_VENDOR_WATCHLIST);
  const canReviewWatchlist = can(PERMISSIONS.REVIEW_VENDOR_WATCHLIST_REQUEST);
  const canRequestBlock = can(PERMISSIONS.REQUEST_VENDOR_BLOCK);
  const canManageBlock = can(PERMISSIONS.MANAGE_VENDOR_BLOCK);
  return (
    <div className="operations-page vendors-page">
      <div className="page-header"><div><span className="page-eyebrow">Monitoring</span><h1>Vendor Monitoring</h1><p>Review vendor risk signals and governed monitoring status.</p></div><div className="page-header-actions">{canReviewWatchlist && <button className="btn btn-secondary" type="button" disabled title="Watchlist review is not available until the service is connected.">Review Watchlist Requests</button>}{canRequestBlock && <button className="btn btn-secondary" type="button" disabled title="Vendor block requests are not available until the service is connected.">Request Vendor Block</button>}{canManageBlock && <button className="btn btn-secondary" type="button" disabled title="Vendor status management is not available until the service is connected.">Manage Vendor Status</button>}<button className="btn btn-primary" type="button" disabled title="Vendor requests are not available until the service is connected.">{canRequestWatchlist ? 'Request Watchlist' : 'Request Watchlist — Restricted'}</button></div></div>
      <section className="operations-summary" aria-label="Vendor monitoring summary">{['Monitored Vendors', 'Watchlisted', 'Blocked in Audit Monitoring', 'Open Vendor Cases'].map((label) => <article key={label}><span>{label}</span><strong aria-label="Unavailable">—</strong></article>)}</section>
      <section className="operations-card" aria-labelledby="vendor-list-heading">
        <div className="operations-card-header"><div><h2 id="vendor-list-heading">Vendors</h2><p>Monitoring labels reflect audit oversight, not ERP payment enforcement.</p></div></div>
        <div className="operations-tabs" role="tablist" aria-label="Vendor views">{TABS.map((item) => <button key={item} role="tab" aria-selected={tab === item} className={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item}</button>)}</div>
        <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Vendor</th><th>Monitoring Status</th><th>Risk Level</th><th>Average Risk Score</th><th>Active Alerts</th><th>Open Cases</th><th>Actions</th></tr></thead><tbody /></table><ManagementEmptyState title={tab === 'All Vendors' ? 'No vendors are available yet.' : `No ${tab.toLowerCase()} are available yet.`} description="Authoritative vendor monitoring data will appear here when the service is connected." /></div>
        <span className="sr-only">{VENDORS.length} vendor records</span>
      </section>
    </div>
  );
}
