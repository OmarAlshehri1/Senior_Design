import { useMemo, useState } from 'react';
import { AUDIT_ACTIONS, AUDIT_OUTCOMES, AUDIT_RESOURCE_TYPES } from '../audit/auditEvents.js';
import {
  AUDIT_LOG_SORTS,
  DEFAULT_AUDIT_FILTERS,
  DEFAULT_AUDIT_PAGINATION,
  deriveAuditLogView,
  getAuditLogScope,
} from '../audit/auditLog.js';
import AuditEventDetails from '../components/AuditEventDetails.jsx';
import useAuthorization from '../auth/useAuthorization.js';

const AUDIT_EVENTS = Object.freeze([]);
const titleCase = (value) => value.toLowerCase().split('_').map((part) => (
  part.charAt(0).toUpperCase() + part.slice(1)
)).join(' ');

export default function AuditLog() {
  const { effectiveRole } = useAuthorization();
  const [filters, setFilters] = useState(DEFAULT_AUDIT_FILTERS);
  const [sort, setSort] = useState(AUDIT_LOG_SORTS.NEWEST);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const events = useMemo(() => deriveAuditLogView(AUDIT_EVENTS, filters, sort), [filters, sort]);
  const scope = getAuditLogScope(effectiveRole);

  const updateFilter = (key) => (event) => {
    setFilters((current) => ({ ...current, [key]: event.target.value }));
  };

  return (
    <div className="audit-log-page">
      <div className="page-header audit-log-page-header">
        <div>
          <h1>Audit Log</h1>
          <p>Review recorded system and user activity.</p>
        </div>
        {scope && <span className="audit-scope-badge">Planned scope: {scope === 'TEAM' ? 'Team activity' : 'All activity'}</span>}
      </div>

      <section className="audit-log-controls" aria-label="Audit log filters">
        <label className="audit-filter audit-filter-search">
          <span>Search</span>
          <input type="search" value={filters.search} onChange={updateFilter('search')} placeholder="Search activity" />
        </label>
        <label className="audit-filter">
          <span>User / Actor</span>
          <input value={filters.actor} onChange={updateFilter('actor')} placeholder="Actor name" />
        </label>
        <label className="audit-filter">
          <span>Action</span>
          <select value={filters.action} onChange={updateFilter('action')}>
            <option value="">All actions</option>
            {Object.values(AUDIT_ACTIONS).map((action) => <option value={action} key={action}>{titleCase(action)}</option>)}
          </select>
        </label>
        <label className="audit-filter">
          <span>Resource</span>
          <select value={filters.resourceType} onChange={updateFilter('resourceType')}>
            <option value="">All resources</option>
            {Object.values(AUDIT_RESOURCE_TYPES).map((resource) => <option value={resource} key={resource}>{titleCase(resource)}</option>)}
          </select>
        </label>
        <label className="audit-filter">
          <span>Outcome</span>
          <select value={filters.outcome} onChange={updateFilter('outcome')}>
            <option value="">All outcomes</option>
            {Object.values(AUDIT_OUTCOMES).map((outcome) => <option value={outcome} key={outcome}>{titleCase(outcome)}</option>)}
          </select>
        </label>
        <label className="audit-filter">
          <span>Date</span>
          <input type="date" value={filters.date} onChange={updateFilter('date')} />
        </label>
        <label className="audit-filter audit-sort-control">
          <span>Order</span>
          <select value={sort} onChange={(event) => setSort(event.target.value)}>
            <option value={AUDIT_LOG_SORTS.NEWEST}>Newest</option>
            <option value={AUDIT_LOG_SORTS.OLDEST}>Oldest</option>
          </select>
        </label>
      </section>

      <section className="audit-log-surface" aria-labelledby="audit-activity-heading">
        <header>
          <div>
            <h2 id="audit-activity-heading">Recorded Activity</h2>
            <p>Historical activity will appear here when records are available.</p>
          </div>
          <span>{events.length} records</span>
        </header>
        <div className="audit-log-table-wrap">
          <table className="audit-log-table">
            <caption className="sr-only">Recorded audit activity</caption>
            <thead><tr><th>Time</th><th>User</th><th>Role</th><th>Action</th><th>Resource</th><th>Outcome</th><th><span className="sr-only">Details</span></th></tr></thead>
            <tbody>
              {events.map((event) => (
                <tr key={event.id}>
                  <td data-label="Time">{event.timestamp}</td><td data-label="User">{event.actorName}</td>
                  <td data-label="Role">{event.actorRole}</td><td data-label="Action">{titleCase(event.action)}</td>
                  <td data-label="Resource">{event.resourceId}</td><td data-label="Outcome">{titleCase(event.outcome)}</td>
                  <td data-label="Details"><button type="button" className="audit-details-button" onClick={() => setSelectedEvent(event)}>Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {events.length === 0 && (
          <div className="audit-log-empty">
            <span aria-hidden="true">—</span>
            <h3>No audit activity is available yet.</h3>
            <p>Recorded actions will appear here with their actor, resource, time, and outcome.</p>
          </div>
        )}
        <footer className="audit-pagination-context">
          <span>Page {DEFAULT_AUDIT_PAGINATION.page}</span>
          <span>Page size {DEFAULT_AUDIT_PAGINATION.pageSize}</span>
          <span>Total {events.length}</span>
        </footer>
      </section>

      <AuditEventDetails event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}
