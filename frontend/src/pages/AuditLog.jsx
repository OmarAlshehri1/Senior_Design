import DateTime from '../components/DateTime.jsx';
import usePagedResource from '../hooks/usePagedResource.js';
import CollectionPagination from '../components/CollectionPagination.jsx';
import Reference from '../components/Reference.jsx';
import { eventLabel, resourceLabel } from '../utils/presentation.js';
import { useState } from 'react';
import { AUDIT_ACTIONS, AUDIT_OUTCOMES, AUDIT_RESOURCE_TYPES } from '../audit/auditEvents.js';
import { AUDIT_LOG_SORTS, getAuditLogScope } from '../audit/auditLog.js';
import { auditService } from '../audit/auditService.js';
import AuditEventDetails from '../components/AuditEventDetails.jsx';
import useAuthorization from '../auth/useAuthorization.js';

const EMPTY_FILTERS = { search: '', actor: '', action: '', resource_type: '', outcome: '', date: '', sort: 'NEWEST' };
const loadAuditPage = ({ query, signal }) => auditService.getAuditEvents(query, { signal });

const titleCase = (value) => value.toLowerCase().split('_').map((part) => (
  part.charAt(0).toUpperCase() + part.slice(1)
)).join(' ');

export default function AuditLog() {
  const { effectiveRole } = useAuthorization();
  const collection = usePagedResource(loadAuditPage, EMPTY_FILTERS);
  const { resource, query } = collection;
  const filters = { ...query, resourceType: query.resource_type };
  const sort = query.sort;
  const loading = collection.status === 'loading';
  const error = collection.error;
  const [selectedEvent, setSelectedEvent] = useState(null);
  const scope = getAuditLogScope(effectiveRole);
  const updateFilter = (key) => (event) => resource.setFilters({ [key === 'resourceType' ? 'resource_type' : key]: event.target.value });
  const filtersActive = Object.keys(EMPTY_FILTERS).some((key) => query[key] !== EMPTY_FILTERS[key]);

  return (
    <div className="audit-log-page">
      <div className="page-header audit-log-page-header">
        <div>
          <h1>Audit Log</h1>
          <p>Review recorded system and user activity.</p>
        </div>
        {scope && <span className="audit-scope-badge">{scope === 'TEAM' ? 'Your activity and available team events' : 'All activity'}</span>}
      </div>

      <section className="audit-log-controls" aria-label="Audit log filters">
        <label className="audit-filter audit-filter-search"><span>Search</span><input type="search" value={filters.search} onChange={updateFilter('search')} placeholder="Search activity" /></label>
        <label className="audit-filter"><span>User / Actor</span><input value={filters.actor} onChange={updateFilter('actor')} placeholder="Actor name" /></label>
        <label className="audit-filter"><span>Action</span><select value={filters.action} onChange={updateFilter('action')}><option value="">All actions</option>{Object.values(AUDIT_ACTIONS).map((action) => <option value={action} key={action}>{eventLabel(action)}</option>)}</select></label>
        <label className="audit-filter"><span>Resource</span><select value={filters.resourceType} onChange={updateFilter('resourceType')}><option value="">All resources</option>{Object.values(AUDIT_RESOURCE_TYPES).map((resource) => <option value={resource} key={resource}>{titleCase(resource)}</option>)}</select></label>
        <label className="audit-filter"><span>Outcome</span><select value={filters.outcome} onChange={updateFilter('outcome')}><option value="">All outcomes</option>{Object.values(AUDIT_OUTCOMES).map((outcome) => <option value={outcome} key={outcome}>{titleCase(outcome)}</option>)}</select></label>
        <label className="audit-filter"><span>Date (UTC)</span><input type="date" value={filters.date} onChange={updateFilter('date')} /></label>
        <label className="audit-filter audit-sort-control"><span>Order</span><select value={sort} onChange={(event) => resource.setFilters({ sort: event.target.value })}><option value={AUDIT_LOG_SORTS.NEWEST}>Newest</option><option value={AUDIT_LOG_SORTS.OLDEST}>Oldest</option></select></label>
        {filtersActive && <button type="button" className="btn btn-secondary" onClick={() => resource.setFilters(EMPTY_FILTERS)}>Clear Filters</button>}
      </section>

      <section className="audit-log-surface" aria-labelledby="audit-activity-heading" aria-busy={loading}>
        <header><div><h2 id="audit-activity-heading">Recorded Activity</h2><p>Recorded actions and outcomes.</p></div><span>{loading || error ? '—' : collection.total} events</span></header>
        {error && <p role="alert" className="integration-error">{error}</p>}
        {loading && <p className="request-state" role="status">{collection.refreshing ? 'Refreshing activity…' : 'Loading activity…'}</p>}
        {!loading && !error && <AuditLogTable events={collection.items} onSelect={setSelectedEvent} />}
        {!loading && !error && collection.items.length === 0 && <div className="audit-log-empty"><h3>No activity matches these filters.</h3></div>}
        {error && <button type="button" className="btn btn-secondary" onClick={() => resource.load()}>Retry</button>}
        <CollectionPagination collection={collection} itemLabel="events" />
      </section>
      <AuditEventDetails event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}

export function AuditLogTable({ events, onSelect }) {
  return <div className="audit-log-table-wrap"><table className="audit-log-table">
    <caption className="sr-only">Recorded audit activity</caption>
    <thead><tr><th>Actor</th><th>Action</th><th>Resource</th><th>Outcome</th><th>Time</th><th><span className="sr-only">Details</span></th></tr></thead>
    <tbody>{events.map((event) => <tr key={event.id}>
      <td data-label="Actor"><strong>{event.actorName ?? '—'}</strong><span className="secondary-metadata">{eventLabel(event.actorRole)}</span></td>
      <td data-label="Action">{eventLabel(event.action)}</td>
      <td data-label="Resource"><Reference value={event.resourceId} label={resourceLabel(event.resourceType, event.resourceId)} /></td>
      <td data-label="Outcome">{titleCase(event.outcome ?? 'Unavailable')}</td>
      <td data-label="Time"><DateTime value={event.timestamp} compact /></td>
      <td data-label="Details"><button type="button" className="audit-details-button" onClick={() => onSelect(event)}>Details</button></td>
    </tr>)}</tbody>
  </table></div>;
}
