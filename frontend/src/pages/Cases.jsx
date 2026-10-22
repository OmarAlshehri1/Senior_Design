import DateTime from '../components/DateTime.jsx';
import { DISPLAY_TIME_ZONE_LABEL } from '../utils/dateTime.js';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import usePagedResource from '../hooks/usePagedResource.js';
import CollectionPagination from '../components/CollectionPagination.jsx';
import ManagementEmptyState from '../components/ManagementEmptyState.jsx';
import { CASE_PRIORITIES, CASE_STATUS_META, CASE_STATUSES } from '../cases/caseModel.js';
import { getSlaPresentation } from '../cases/caseWorkflow.js';
import { casesService } from '../services/casesService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';

export default function Cases() {
  const { can } = useAuthorization();
  const [search, setSearch] = useState('');
  const collection = usePagedResource(casesService.listCases, { status: null, priority: null, search: null });
  const { items, total, query, resource } = collection;
  const status = query.status ?? 'ALL';
  const priority = query.priority ?? 'ALL';
  const pendingSearch = (query.search ?? '') !== search.trim();
  const loading = collection.status === 'loading' || pendingSearch;
  const error = collection.error;
  useEffect(() => {
    if ((query.search ?? '') === search.trim()) return undefined;
    const timer = setTimeout(() => resource.setFilters({ search: search.trim() || null }), 250);
    return () => clearTimeout(timer);
  }, [search, query.search, resource]);

  return (
    <div className="operations-page cases-page">
      <div className="page-header">
        <div><span className="page-eyebrow">Investigations</span><h1>Case Management</h1><p>Coordinate evidence, accountability, resolution, and controlled closure.</p></div>
        {can(PERMISSIONS.CREATE_CASE) && <Link className="btn btn-primary" to="/alerts">Create Case from Alert</Link>}
      </div>
      <section className="operations-card" aria-labelledby="case-queue-heading" aria-busy={loading}>
        <div className="operations-card-header"><div><h2 id="case-queue-heading">Case Queue</h2><p>Cases visible within your authorized assignment scope.</p></div><span className="result-count">{loading || error ? '—' : total} matching cases</span></div>
        <div className="operations-toolbar">
          <label><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search reference, title, alert, or transaction" /></label>
          <label><span>Status</span><select value={status} onChange={(event) => resource.setFilters({ status: event.target.value === 'ALL' ? null : event.target.value })}><option value="ALL">All statuses</option>{Object.values(CASE_STATUSES).map((value) => <option key={value} value={value}>{value.replaceAll('_', ' ')}</option>)}</select></label>
          <label><span>Priority</span><select value={priority} onChange={(event) => resource.setFilters({ priority: event.target.value === 'ALL' ? null : event.target.value })}><option value="ALL">All priorities</option>{Object.values(CASE_PRIORITIES).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        {loading ? <div className="request-state" role="status">{collection.refreshing ? 'Refreshing cases…' : 'Loading cases…'}</div>
          : error ? <div className="request-state request-state-error" role="alert"><h3>Cases could not be loaded.</h3><p>{error}</p><button type="button" className="btn btn-secondary" onClick={() => resource.load()}>Retry</button></div>
            : items.length === 0 ? <ManagementEmptyState title={total > 0 ? 'No cases on this page. Retry or browse another page.' : search.trim() || status !== 'ALL' || priority !== 'ALL' ? 'No cases match these filters.' : 'No cases are available.'} description="Cases are created only from an explicit Alert or Transaction review action." />
              : <CasesTable items={items} />}
        {!pendingSearch && <CollectionPagination collection={collection} itemLabel="cases" />}
      </section>
    </div>
  );
}

export function CasesTable({ items }) {
  return <div className="operations-table-wrap"><table className="operations-table"><thead><tr><th>Case ID</th><th>Title</th><th>Source</th><th>Priority</th><th>Status</th><th>Assigned To</th><th>SLA</th><th>Updated ({DISPLAY_TIME_ZONE_LABEL})</th><th>Actions</th></tr></thead><tbody>
                {items.map((item) => {
                  const caseStatus = CASE_STATUS_META[item.status];
                  const sla = getSlaPresentation({ slaStatus: item.slaStatus, slaDueAt: item.slaDueAt, completedAt: item.completedAt });
                  return <tr key={item.id}>
                    <td data-label="Case ID">{item.reference ?? item.id}</td><td data-label="Title">{item.title}</td>
                    <td data-label="Source">{item.alertId ?? item.transactionId ?? '—'}</td><td data-label="Priority">{item.priority}</td>
                    <td data-label="Status"><span className={`workflow-status tone-${caseStatus?.tone ?? 'neutral'}`}>{caseStatus?.label ?? item.status}</span></td>
                    <td data-label="Assigned To">{item.assignedToName ?? '—'}</td><td data-label="SLA"><span className={`sla-status sla-${sla.tone}`}>{sla.label}</span></td>
                    <td data-label={`Updated (${DISPLAY_TIME_ZONE_LABEL})`}><DateTime value={item.updatedAt} compact showZone={false} /></td>
                    <td data-label="Actions"><Link className="btn btn-secondary" to={`/cases/${encodeURIComponent(item.id)}`}>Open</Link></td>
                  </tr>;
                })}
              </tbody></table></div>;
}
