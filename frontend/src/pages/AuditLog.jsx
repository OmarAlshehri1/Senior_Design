import DateTime from '../components/DateTime.jsx';
import usePagedResource from '../hooks/usePagedResource.js';
import CollectionPagination from '../components/CollectionPagination.jsx';
import Reference from '../components/Reference.jsx';
import { eventLabel, resourceLabel } from '../utils/presentation.js';
import { useEffect, useState } from 'react';
import { AUDIT_ACTIONS, AUDIT_OUTCOMES, AUDIT_RESOURCE_TYPES } from '../audit/auditEvents.js';
import { AUDIT_LOG_SORTS, getAuditLogScope } from '../audit/auditLog.js';
import { auditService } from '../audit/auditService.js';
import AuditEventDetails from '../components/AuditEventDetails.jsx';
import useAuthorization from '../auth/useAuthorization.js';
import { Badge, PageHeader } from '../components/ui/Layout.jsx';
import { Combobox, FilterBar, SearchField, SegmentedControl, SelectField } from '../components/ui/Filters.jsx';
import { EmptyState, ErrorState, LoadingState } from '../components/RequestStateView.jsx';

const OUTCOME_TONES = Object.freeze({ SUCCESS: 'low', FAILED: 'high', DENIED: 'medium' });

const EMPTY_FILTERS = { search: '', actor: '', action: '', resource_type: '', outcome: '', date: '', sort: 'NEWEST' };
const loadAuditPage = ({ query, signal }) => auditService.getAuditEvents(query, { signal });

const titleCase = (value) => value.toLowerCase().split('_').map((part) => (
  part.charAt(0).toUpperCase() + part.slice(1)
)).join(' ');

export default function AuditLog() {
  const { effectiveRole } = useAuthorization();
  const collection = usePagedResource(loadAuditPage, EMPTY_FILTERS);
  const { resource, query } = collection;
  const loading = collection.status === 'loading';
  const error = collection.error;
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [text, setText] = useState({ search: query.search, actor: query.actor });
  const scope = getAuditLogScope(effectiveRole);
  const setFilter = (key, value) => resource.setFilters({ [key]: value });
  const activeFilters = Object.keys(EMPTY_FILTERS).filter((key) => query[key] !== EMPTY_FILTERS[key]).length;
  useEffect(() => {
    if (text.search === query.search && text.actor === query.actor) return undefined;
    const timer = setTimeout(() => resource.setFilters({ search: text.search, actor: text.actor }), 300);
    return () => clearTimeout(timer);
  }, [text, query.search, query.actor, resource]);
  const clearFilters = () => { setText({ search: '', actor: '' }); resource.setFilters(EMPTY_FILTERS); };
  const summary = loading ? 'Loading activity…' : error ? 'Activity unavailable'
    : `${collection.total.toLocaleString('en-US')} ${collection.total === 1 ? 'event' : 'events'}${activeFilters ? ' match your filters' : ''}`;

  return (
    <div className="page audit-log-page">
      <PageHeader title="Audit Log" description="Every recorded action, who took it and what happened."
        actions={scope && <Badge tone="neutral">{scope === 'TEAM' ? 'Your activity and team events' : 'All activity'}</Badge>} />

      <FilterBar label="Audit log filters" summary={summary} activeCount={activeFilters} onClear={clearFilters}>
        <SearchField label="Search activity" value={text.search} onChange={(value) => setText((current) => ({ ...current, search: value }))} placeholder="Search activity" />
        <div className="text-filter"><label htmlFor="audit-actor-filter">Actor</label><input id="audit-actor-filter" value={text.actor} onChange={(event) => setText((current) => ({ ...current, actor: event.target.value }))} placeholder="Name" /></div>
        <Combobox label="Action" value={query.action} allLabel="All actions" placeholder="Type an action" options={Object.values(AUDIT_ACTIONS).map((action) => ({ value: action, label: eventLabel(action) }))} onChange={(value) => setFilter('action', value)} />
        <SelectField label="Resource" value={query.resource_type} onChange={(value) => setFilter('resource_type', value)} options={[{ value: '', label: 'All' }, ...Object.values(AUDIT_RESOURCE_TYPES).map((resourceType) => ({ value: resourceType, label: titleCase(resourceType) }))]} />
        <SegmentedControl label="Outcome" value={query.outcome} onChange={(value) => setFilter('outcome', value)} options={[{ value: '', label: 'All' }, ...Object.values(AUDIT_OUTCOMES).map((outcome) => ({ value: outcome, label: titleCase(outcome), tone: OUTCOME_TONES[outcome] }))]} />
        <div className={`text-filter${query.date ? ' is-active' : ''}`}><label htmlFor="audit-date-filter">Day (UTC)</label><input id="audit-date-filter" type="date" value={query.date} onChange={(event) => setFilter('date', event.target.value)} /></div>
        <SelectField label="Order" value={query.sort} onChange={(value) => setFilter('sort', value)} options={[{ value: AUDIT_LOG_SORTS.NEWEST, label: 'Newest' }, { value: AUDIT_LOG_SORTS.OLDEST, label: 'Oldest' }]} />
      </FilterBar>

      <section className="panel panel-table" aria-labelledby="audit-activity-heading" aria-busy={loading}>
        <h2 id="audit-activity-heading" className="sr-only">Recorded Activity</h2>
        {loading ? <LoadingState message={collection.refreshing ? 'Refreshing activity…' : 'Loading activity…'} />
          : error ? <ErrorState title="Activity could not be loaded." message={error} onRetry={() => resource.load()} />
            : collection.items.length === 0 ? (activeFilters
              ? <EmptyState filtered title="No activity matches these filters." message="Widen the filters or clear them." action={<button type="button" className="btn btn-secondary btn-sm" onClick={clearFilters}>Clear filters</button>} />
              : <EmptyState title="No activity recorded yet." />)
              : <AuditLogTable events={collection.items} onSelect={setSelectedEvent} />}
        <CollectionPagination collection={collection} itemLabel="events" />
      </section>
      <AuditEventDetails event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}

export function AuditLogTable({ events, onSelect }) {
  return <div className="table-wrap"><table className="data-table audit-log-table">
    <caption className="sr-only">Recorded audit activity</caption>
    <thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Resource</th><th>Outcome</th><th><span className="sr-only">Details</span></th></tr></thead>
    <tbody>{events.map((event) => <tr key={event.id}>
      <td data-label="Time"><DateTime value={event.timestamp} compact /></td>
      <td data-label="Actor"><span className="cell-primary">{event.actorName ?? '—'}</span><span className="secondary-metadata">{eventLabel(event.actorRole)}</span></td>
      <td data-label="Action"><span className="cell-primary">{eventLabel(event.action)}</span></td>
      <td data-label="Resource"><Reference value={event.resourceId} label={resourceLabel(event.resourceType, event.resourceId)} /></td>
      <td data-label="Outcome"><span className={`badge badge-${OUTCOME_TONES[event.outcome] ?? 'neutral'}`}>{titleCase(event.outcome ?? 'Unavailable')}</span></td>
      <td data-label="Details" className="cell-actions"><button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelect?.(event)}>Details</button></td>
    </tr>)}</tbody>
  </table></div>;
}
