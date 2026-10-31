import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import usePagedResource from '../hooks/usePagedResource.js';
import CollectionPagination from '../components/CollectionPagination.jsx';
import { vendorsService } from '../services/vendorsService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PageHeader } from '../components/ui/Layout.jsx';
import { FilterBar, SearchField, SegmentedControl } from '../components/ui/Filters.jsx';
import { ActionMenu } from '../components/ui/Overlays.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/RequestStateView.jsx';
import { MONITORING_TONES, riskStatusPillClass, titleCase } from '../components/statusUtils.js';
import { vendorActionKeys, vendorActionLabel, VendorReasonDialog } from '../components/VendorActions.jsx';

const STATUS_OPTIONS = [{ value: '', label: 'All' }, { value: 'NORMAL', label: 'Normal' }, { value: 'WATCHLISTED', label: 'Watchlisted', tone: 'medium' }, { value: 'BLOCKED', label: 'Blocked', tone: 'high' }];

export default function Vendors() {
  const { can } = useAuthorization();
  const collection = usePagedResource(vendorsService.listVendors, { status: null });
  const { items: visible, total, query, resource } = collection;
  const [searchSupported, setSearchSupported] = useState(false);
  const [search, setSearch] = useState('');
  const [actionRequest, setActionRequest] = useState(null);
  const pendingSearch = (query.search ?? '') !== search.trim();
  const loading = collection.status === 'loading' || pendingSearch;

  useEffect(() => {
    const controller = new AbortController();
    vendorsService.getFilterOptions({ signal: controller.signal })
      .then((options) => { if (!controller.signal.aborted) setSearchSupported(options?.search === true); })
      .catch(() => { if (!controller.signal.aborted) setSearchSupported(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if ((query.search ?? '') === search.trim()) return undefined;
    const timer = setTimeout(() => resource.setFilters({ search: search.trim() || undefined }), 300);
    return () => clearTimeout(timer);
  }, [search, query.search, resource]);

  const activeFilters = [query.status, query.search].filter(Boolean).length;
  const clearFilters = () => { setSearch(''); resource.setFilters({ status: null, search: undefined }); };
  const summary = loading ? 'Loading vendors…' : collection.error ? 'Vendors unavailable'
    : `${(total ?? 0).toLocaleString('en-US')} ${total === 1 ? 'vendor' : 'vendors'}${activeFilters ? ' match your filters' : ''}`;

  return <div className="page vendors-page">
    <PageHeader title="Vendors" description="Find a vendor and review its risk signals and monitoring status." />
    <FilterBar label="Vendor search and filters" summary={summary} activeCount={activeFilters} onClear={clearFilters}>
      {searchSupported && <SearchField label="Search vendors" value={search} onChange={setSearch} placeholder="Search by vendor name or ID" />}
      <SegmentedControl label="Monitoring" value={query.status ?? ''} options={STATUS_OPTIONS} onChange={(value) => resource.setFilters({ status: value || null })} />
    </FilterBar>
    <section className="panel panel-table" aria-label="Vendor results" aria-busy={loading}>
      {loading ? <LoadingState message={collection.refreshing ? 'Refreshing vendors…' : 'Loading vendors…'} />
        : collection.status === 'error' ? <ErrorState title="Vendors could not be loaded." message={collection.error} onRetry={() => resource.load()} />
          : visible.length === 0 ? (activeFilters
            ? <EmptyState filtered title="No vendors match these filters." message="Try another name, or clear the filters." action={<button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>} />
            : <EmptyState title="No vendors yet." message="Vendors come from the approved-vendor registry." />)
            : <VendorsTable vendors={visible} can={can} onAction={(key, vendor) => setActionRequest({ key, vendor })} />}
      {!pendingSearch && <CollectionPagination collection={collection} itemLabel="vendors" />}
    </section>
    <VendorReasonDialog request={actionRequest} onClose={() => setActionRequest(null)} onDone={() => resource.load()} />
  </div>;
}

export function VendorsTable({ vendors, can = () => false, onAction }) {
  return <div className="table-wrap"><table className="data-table vendors-table"><thead><tr><th>Vendor</th><th>Monitoring</th><th>Risk</th><th>Activity</th><th>Actions</th></tr></thead><tbody>{vendors.map((vendor) => {
    const riskLabel = vendor.riskLevel ? `${titleCase(vendor.riskLevel)} Risk` : 'Not available';
    const actions = vendorActionKeys(vendor, can);
    return <tr key={vendor.id}>
      <td data-label="Vendor"><Link className="cell-primary" to={`/vendors/${encodeURIComponent(vendor.id)}`}>{vendor.name ?? vendor.id}</Link><span className="secondary-metadata reference-text">{vendor.id}</span></td>
      <td data-label="Monitoring"><span className={`badge badge-${MONITORING_TONES[vendor.monitoringStatus] ?? 'neutral'}`}>{titleCase(vendor.monitoringStatus)}</span></td>
      <td data-label="Risk"><span className={riskStatusPillClass(riskLabel)}>{riskLabel}</span>{vendor.averageRiskScore != null && <span className="secondary-metadata">Avg score {vendor.averageRiskScore}</span>}</td>
      <td data-label="Activity"><span className="activity-counts"><span><strong>{vendor.activeAlerts ?? 0}</strong> active alerts</span><span><strong>{vendor.openCases ?? 0}</strong> open cases</span></span></td>
      <td data-label="Actions" className="cell-actions"><div className="row-actions">
        <Link className="btn btn-secondary btn-sm" to={`/vendors/${encodeURIComponent(vendor.id)}`}>Open</Link>
        <ActionMenu label={`More actions for ${vendor.name ?? vendor.id}`} items={actions.map((key) => ({ label: vendorActionLabel(key), onSelect: () => onAction?.(key, vendor) }))} />
      </div></td>
    </tr>;
  })}</tbody></table></div>;
}
