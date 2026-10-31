import { caseReference } from '../utils/presentation.js';
import Reference from '../components/Reference.jsx';
import DateTime from '../components/DateTime.jsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import usePagedResource from '../hooks/usePagedResource.js';
import CollectionPagination from '../components/CollectionPagination.jsx';
import { PageHeader } from '../components/ui/Layout.jsx';
import { FilterBar, SearchField, SegmentedControl, SelectField } from '../components/ui/Filters.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/RequestStateView.jsx';
import { PRIORITY_TONES, SLA_TONES, titleCase, WORKFLOW_TONES } from '../components/statusUtils.js';
import { CASE_PRIORITIES, CASE_STATUS_META, CASE_STATUSES } from '../cases/caseModel.js';
import { getSlaPresentation } from '../cases/caseWorkflow.js';
import { casesService } from '../services/casesService.js';
import useAuthorization from '../auth/useAuthorization.js';
import { PERMISSIONS } from '../auth/roles.js';

const STATUS_LABELS = Object.freeze(Object.fromEntries(Object.entries(CASE_STATUS_META).map(([key, meta]) => [key, meta.label])));
const PRIORITY_OPTIONS = [{ value: '', label: 'All' }, ...Object.values(CASE_PRIORITIES).map((value) => ({ value, label: titleCase(value), tone: value === 'HIGH' || value === 'CRITICAL' ? 'high' : value === 'MEDIUM' ? 'medium' : undefined }))];

export default function Cases() {
  const { can } = useAuthorization();
  const [search, setSearch] = useState('');
  const collection = usePagedResource(casesService.listCases, { status: null, priority: null, search: null });
  const { items, total, query, resource } = collection;
  const status = query.status ?? '';
  const priority = query.priority ?? '';
  const pendingSearch = (query.search ?? '') !== search.trim();
  const loading = collection.status === 'loading' || pendingSearch;
  const error = collection.error;
  useEffect(() => {
    if ((query.search ?? '') === search.trim()) return undefined;
    const timer = setTimeout(() => resource.setFilters({ search: search.trim() || null }), 250);
    return () => clearTimeout(timer);
  }, [search, query.search, resource]);
  const activeFilters = [search.trim(), query.status, query.priority].filter(Boolean).length;
  const clearFilters = () => { setSearch(''); resource.setFilters({ status: null, priority: null, search: null }); };
  const summary = loading ? 'Loading cases…' : error ? 'Cases unavailable'
    : `${(total ?? 0).toLocaleString('en-US')} ${total === 1 ? 'case' : 'cases'}${activeFilters ? ' match your filters' : ' in your scope'}`;

  return (
    <div className="page cases-page">
      <PageHeader title="Cases" description="Investigations in progress, with owner and SLA at a glance."
        actions={can(PERMISSIONS.CREATE_CASE) && <Link className="btn btn-primary" to="/alerts">Create case from an alert</Link>} />
      <FilterBar label="Case filters" summary={summary} activeCount={activeFilters} onClear={clearFilters}>
        <SearchField label="Search cases" value={search} onChange={setSearch} placeholder="Search by case number, title, alert or transaction" />
        <SelectField label="Status" value={status} onChange={(value) => resource.setFilters({ status: value || null })}
          options={[{ value: '', label: 'All' }, ...Object.values(CASE_STATUSES).map((value) => ({ value, label: STATUS_LABELS[value] ?? titleCase(value) }))]} />
        <SegmentedControl label="Priority" value={priority} options={PRIORITY_OPTIONS} onChange={(value) => resource.setFilters({ priority: value || null })} />
      </FilterBar>
      <section className="panel panel-table" aria-labelledby="case-queue-heading" aria-busy={loading}>
        <h2 id="case-queue-heading" className="sr-only">Case Queue</h2>
        {loading ? <LoadingState message={collection.refreshing ? 'Refreshing cases…' : 'Loading cases…'} />
          : error ? <ErrorState title="Cases could not be loaded." message={error} onRetry={() => resource.load()} />
            : items.length === 0 ? (activeFilters
              ? <EmptyState filtered title="No cases match these filters." message="Try another status or priority, or clear the filters." action={<button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>} />
              : <EmptyState title="No cases yet." message="Cases are opened from an alert or a transaction review." />)
              : <CasesTable items={items} />}
        {!pendingSearch && <CollectionPagination collection={collection} itemLabel="cases" />}
      </section>
    </div>
  );
}

export function CasesTable({ items }) {
  return <div className="table-wrap"><table className="data-table cases-table"><thead><tr><th>Case</th><th>Source</th><th>Priority</th><th>Status</th><th>Assignee</th><th>SLA</th><th>Updated</th><th>Actions</th></tr></thead><tbody>
                {items.map((item) => {
                  const caseStatus = CASE_STATUS_META[item.status];
                  const sla = getSlaPresentation({ slaStatus: item.slaStatus, slaDueAt: item.slaDueAt, completedAt: item.completedAt });
                  return <tr key={item.id}>
                    <td data-label="Case" className="case-cell"><Link className="case-reference" title={item.reference ?? item.id} to={`/cases/${encodeURIComponent(item.id)}`}>{caseReference(item.reference ?? item.id)}</Link><span className="case-title">{item.title}</span></td>
                    <td data-label="Source"><span className="source-kind">{item.alertId ? 'Alert' : item.transactionId ? 'Transaction' : '—'}</span><Reference value={item.alertId ?? item.transactionId} /></td>
                    <td data-label="Priority"><span className={`badge badge-${PRIORITY_TONES[item.priority] ?? 'neutral'}`}>{titleCase(item.priority)}</span></td>
                    <td data-label="Status"><span className={`badge badge-${WORKFLOW_TONES[caseStatus?.tone] ?? 'neutral'}`}>{caseStatus?.label ?? item.status}</span></td>
                    <td data-label="Assignee">{item.assignedToName ?? <span className="muted">Unassigned</span>}</td>
                    <td data-label="SLA"><span className={`sla-text tone-${SLA_TONES[sla.tone] ?? 'neutral'}`}>{sla.label}</span></td>
                    <td data-label="Updated"><DateTime value={item.updatedAt} compact showZone={false} /></td>
                    <td data-label="Actions" className="cell-actions"><Link className="btn btn-secondary btn-sm" to={`/cases/${encodeURIComponent(item.id)}`}>Open</Link></td>
                  </tr>;
                })}
              </tbody></table></div>;
}
