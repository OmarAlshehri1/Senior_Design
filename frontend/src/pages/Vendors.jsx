import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import Pagination from '../components/Pagination.jsx';
import { SearchIcon } from '../components/icons';
import { vendorsService } from '../services/vendorsService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';
import { getPageSizeChange, getTotalPages } from '../utils/pagination.js';

const STATUS_FILTERS = Object.freeze([
  ['All', null], ['Normal', 'NORMAL'], ['Watchlist', 'WATCHLISTED'], ['Blocked', 'BLOCKED'],
]);
const RISK_FILTERS = Object.freeze(['All', 'Low', 'Medium', 'High']);

export default function Vendors() {
  const { can } = useAuthorization();
  const [search, setSearch] = useState('');
  const [querySearch, setQuerySearch] = useState('');
  const [statusFilter, setStatusFilter] = useState(null);
  const [riskFilter, setRiskFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [result, setResult] = useState({ items: [], total: 0 });
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [loadVersion, setLoadVersion] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuerySearch(search.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const refresh = useCallback(async (signal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await vendorsService.listVendors({
        signal,
        query: {
          page,
          page_size: pageSize,
          search: querySearch || undefined,
          status: statusFilter || undefined,
          risk: riskFilter === 'All' ? undefined : riskFilter.toUpperCase(),
        },
      });
      setResult(response);
    } catch (reason) {
      if (signal.aborted) return;
      setResult({ items: [], total: 0 });
      setError(reason instanceof Error ? reason.message : 'Vendor list unavailable.');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [page, pageSize, querySearch, statusFilter, riskFilter, loadVersion]);

  useEffect(() => {
    const controller = new AbortController();
    refresh(controller.signal);
    return () => controller.abort();
  }, [refresh]);

  const act = async (operation) => {
    const reason = window.prompt('Enter a reason for this monitored workflow:');
    if (!reason?.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await operation(reason.trim());
      setLoadVersion((value) => value + 1);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Vendor request failed.');
    } finally {
      setBusy(false);
    }
  };

  const totalPages = getTotalPages(result.total, pageSize);
  const firstVendor = result.total === 0 ? 0 : ((page - 1) * pageSize) + 1;
  const lastVendor = Math.min(page * pageSize, result.total);
  const filtersActive = Boolean(search.trim()) || statusFilter !== null || riskFilter !== 'All';
  const resultLabel = filtersActive
    ? `${result.total.toLocaleString('en-US')} Filtered Vendors`
    : `${result.total.toLocaleString('en-US')} Vendors`;

  const canRequestWatchlist = can(PERMISSIONS.REQUEST_VENDOR_WATCHLIST);
  const canReviewWatchlist = can(PERMISSIONS.REVIEW_VENDOR_WATCHLIST_REQUEST);
  const canRequestBlock = can(PERMISSIONS.REQUEST_VENDOR_BLOCK);
  const canManageBlock = can(PERMISSIONS.MANAGE_VENDOR_BLOCK);

  return <div className="operations-page vendors-page">
    <div className="page-header">
      <div><span className="page-eyebrow">Monitoring</span><h1>Vendor Monitoring</h1><p>Review vendor risk signals and governed monitoring status.</p></div>
      <span className="vendors-result-count" aria-live="polite">{resultLabel}</span>
    </div>
    {error && <div className="request-state request-state-error" role="alert">{error}</div>}

    <div className="vendors-toolbar" aria-label="Vendor search and filters">
      <label className="vendors-search">
        <span className="control-label">Search</span>
        <span className="search-input"><SearchIcon width={16} height={16} color="#7b8493" aria-hidden="true" /><input placeholder="Search by vendor name or ID" value={search} onChange={(event) => setSearch(event.target.value)} /></span>
      </label>
      <label className="vendors-select-control"><span className="control-label">Monitoring Status</span><select className="select-input" value={statusFilter ?? ''} onChange={(event) => { setStatusFilter(event.target.value || null); setPage(1); }}>{STATUS_FILTERS.map(([label, value]) => <option value={value ?? ''} key={label}>{label}</option>)}</select></label>
      <label className="vendors-select-control"><span className="control-label">Risk Level</span><select className="select-input" value={riskFilter} onChange={(event) => { setRiskFilter(event.target.value); setPage(1); }}>{RISK_FILTERS.map((risk) => <option value={risk} key={risk}>{risk}</option>)}</select></label>
      {filtersActive && <button type="button" className="btn btn-secondary" onClick={() => { setSearch(''); setQuerySearch(''); setStatusFilter(null); setRiskFilter('All'); setPage(1); }}>Clear Filters</button>}
    </div>

    <section className="operations-card" aria-labelledby="vendor-list-heading">
      <div className="operations-card-header"><div><h2 id="vendor-list-heading">{resultLabel}</h2><p>Blocking changes audit monitoring only; it does not prevent ERP payments.</p></div></div>
      {loading ? (
        <ManagementEmptyState title="Loading vendors…" description="Retrieving authoritative vendor records." />
      ) : result.items.length === 0 ? (
        <ManagementEmptyState title={filtersActive ? 'No vendors match the selected filters.' : 'No vendors are available.'} description={filtersActive ? 'Try adjusting or clearing the search and filters.' : 'Vendor data comes from the approved-vendor registry.'} />
      ) : (
        <div className="operations-table-wrap"><table className="operations-table vendors-table"><thead><tr><th>Vendor</th><th>Vendor ID</th><th>Monitoring Status</th><th>Risk Level</th><th>Average Risk Score</th><th>Active Alerts</th><th>Open Cases</th><th>Actions</th></tr></thead><tbody>{result.items.map((vendor) => <tr key={vendor.id}>
          <td data-label="Vendor"><Link to={`/vendors/${encodeURIComponent(vendor.id)}`}>{vendor.name ?? vendor.id}</Link></td><td data-label="Vendor ID">{vendor.id}</td><td data-label="Monitoring Status">{vendor.monitoringStatus}</td><td data-label="Risk Level">{vendor.riskLevel ?? '—'}</td><td data-label="Average Risk Score">{vendor.averageRiskScore ?? '—'}</td><td data-label="Active Alerts">{vendor.activeAlerts ?? 0}</td><td data-label="Open Cases">{vendor.openCases ?? 0}</td><td data-label="Actions">
            {canRequestWatchlist && vendor.monitoringStatus === 'NORMAL' && <button type="button" disabled={busy} onClick={() => act((reason) => vendorsService.requestVendorWatchlist(vendor.id, reason))}>Request Watchlist</button>}
            {canReviewWatchlist && vendor.monitoringStatus === 'WATCHLISTED' && <button type="button" disabled={busy} onClick={() => act((note) => vendorsService.removeVendorWatchlist(vendor.id, note))}>Remove Watchlist</button>}
            {canRequestBlock && vendor.monitoringStatus !== 'BLOCKED' && <button type="button" disabled={busy} onClick={() => act((reason) => vendorsService.requestVendorBlock(vendor.id, reason))}>Request Block</button>}
            {canManageBlock && vendor.monitoringStatus === 'BLOCKED' && <button type="button" disabled={busy} onClick={() => act((note) => vendorsService.unblockVendor(vendor.id, note))}>Unblock</button>}
          </td></tr>)}</tbody></table></div>
      )}
      {!loading && !error && <Pagination currentPage={page} totalPages={totalPages} pageSize={pageSize} firstItem={firstVendor} lastItem={lastVendor} totalItems={result.total} itemLabel="vendors" onPageChange={setPage} onPageSizeChange={(value) => { const next = getPageSizeChange(value); setPageSize(next.pageSize); setPage(next.page); }} />}
    </section>
  </div>;
}
