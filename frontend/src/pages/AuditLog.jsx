import { useEffect, useState } from 'react';
import { AUDIT_ACTIONS, AUDIT_OUTCOMES, AUDIT_RESOURCE_TYPES } from '../audit/auditEvents.js';
import { AUDIT_LOG_SORTS, DEFAULT_AUDIT_FILTERS, DEFAULT_AUDIT_PAGINATION, getAuditLogScope } from '../audit/auditLog.js';
import { auditService } from '../audit/auditService.js';
import AuditEventDetails from '../components/AuditEventDetails.jsx';
import useAuthorization from '../auth/useAuthorization.js';

const titleCase = (value) => value.toLowerCase().split('_').map((part) => (
  part.charAt(0).toUpperCase() + part.slice(1)
)).join(' ');

export default function AuditLog() {
  const { effectiveRole } = useAuthorization();
  const [filters, setFilters] = useState(DEFAULT_AUDIT_FILTERS);
  const [sort, setSort] = useState(AUDIT_LOG_SORTS.NEWEST);
  const [page, setPage] = useState(DEFAULT_AUDIT_PAGINATION.page);
  const [result, setResult] = useState({ items: [], total: 0, page: 1, page_size: 25 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedEvent, setSelectedEvent] = useState(null);
  const scope = getAuditLogScope(effectiveRole);
  const pageSize = DEFAULT_AUDIT_PAGINATION.pageSize;

  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      setError('');
      auditService.getAuditEvents({
        page, page_size: pageSize, search: filters.search, actor: filters.actor,
        action: filters.action, resource_type: filters.resourceType,
        outcome: filters.outcome, date: filters.date, sort,
      }).then((response) => {
        if (active) setResult(response);
      }).catch((requestError) => {
        if (active) setError(requestError?.message || 'Audit activity could not be retrieved.');
      }).finally(() => { if (active) setLoading(false); });
    }, 180);
    return () => { active = false; clearTimeout(timer); };
  }, [filters, page, pageSize, sort]);

  const updateFilter = (key) => (event) => {
    setPage(1);
    setFilters((current) => ({ ...current, [key]: event.target.value }));
  };
  const pageCount = Math.max(1, Math.ceil((result.total || 0) / pageSize));

  return (
    <div className="audit-log-page">
      <div className="page-header audit-log-page-header">
        <div>
          <h1>Audit Log</h1>
          <p>Review recorded system and user activity.</p>
        </div>
        {scope && <span className="audit-scope-badge">{scope === 'TEAM' ? 'Your activity until team scope is available' : 'All activity'}</span>}
      </div>

      <section className="audit-log-controls" aria-label="Audit log filters">
        <label className="audit-filter audit-filter-search"><span>Search</span><input type="search" value={filters.search} onChange={updateFilter('search')} placeholder="Search activity" /></label>
        <label className="audit-filter"><span>User / Actor</span><input value={filters.actor} onChange={updateFilter('actor')} placeholder="Actor name" /></label>
        <label className="audit-filter"><span>Action</span><select value={filters.action} onChange={updateFilter('action')}><option value="">All actions</option>{Object.values(AUDIT_ACTIONS).map((action) => <option value={action} key={action}>{titleCase(action)}</option>)}</select></label>
        <label className="audit-filter"><span>Resource</span><select value={filters.resourceType} onChange={updateFilter('resourceType')}><option value="">All resources</option>{Object.values(AUDIT_RESOURCE_TYPES).map((resource) => <option value={resource} key={resource}>{titleCase(resource)}</option>)}</select></label>
        <label className="audit-filter"><span>Outcome</span><select value={filters.outcome} onChange={updateFilter('outcome')}><option value="">All outcomes</option>{Object.values(AUDIT_OUTCOMES).map((outcome) => <option value={outcome} key={outcome}>{titleCase(outcome)}</option>)}</select></label>
        <label className="audit-filter"><span>Date</span><input type="date" value={filters.date} onChange={updateFilter('date')} /></label>
        <label className="audit-filter audit-sort-control"><span>Order</span><select value={sort} onChange={(event) => setSort(event.target.value)}><option value={AUDIT_LOG_SORTS.NEWEST}>Newest</option><option value={AUDIT_LOG_SORTS.OLDEST}>Oldest</option></select></label>
      </section>

      <section className="audit-log-surface" aria-labelledby="audit-activity-heading" aria-busy={loading}>
        <header><div><h2 id="audit-activity-heading">Recorded Activity</h2><p>Immutable accountability events from reviews and account activity.</p></div><span>{result.total} records</span></header>
        {error && <p role="alert" className="integration-error">{error}</p>}
        <div className="audit-log-table-wrap">
          <table className="audit-log-table"><caption className="sr-only">Recorded audit activity</caption>
            <thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Resource</th><th>Outcome</th><th><span className="sr-only">Details</span></th></tr></thead>
            <tbody>{result.items.map((event) => <tr key={event.id}>
              <td data-label="Time">{event.timestamp}</td><td data-label="User">{event.actorName}</td><td data-label="Role">{event.actorRole}</td>
              <td data-label="Action">{titleCase(event.action)}</td><td data-label="Resource">{event.resourceId}</td><td data-label="Outcome">{titleCase(event.outcome)}</td>
              <td data-label="Details"><button type="button" className="audit-details-button" onClick={() => setSelectedEvent(event)}>Details</button></td>
            </tr>)}</tbody>
          </table>
        </div>
        {!loading && !error && result.items.length === 0 && <div className="audit-log-empty"><span aria-hidden="true">—</span><h3>No audit activity matches these filters.</h3><p>New recorded actions will appear here.</p></div>}
        <footer className="audit-pagination-context"><span>Page {page} of {pageCount}</span><span>Page size {pageSize}</span><span>Total {result.total}</span>
          <button type="button" className="management-row-action" disabled={loading || page <= 1} onClick={() => setPage((current) => current - 1)}>Previous</button>
          <button type="button" className="management-row-action" disabled={loading || page >= pageCount} onClick={() => setPage((current) => current + 1)}>Next</button>
        </footer>
      </section>
      <AuditEventDetails event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}
