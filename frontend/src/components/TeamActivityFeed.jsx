import DateTime from './DateTime.jsx';
import ManagementEmptyState from './ManagementEmptyState.jsx';
import { useState } from 'react';
import { eventLabel, resourceLabel } from '../utils/presentation.js';
import Reference from './Reference.jsx';

export const TEAM_ACTIVITY_PAGE_SIZE = 5;

export default function TeamActivityFeed({ events = [] }) {
  const [requestedPage, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(events.length / TEAM_ACTIVITY_PAGE_SIZE));
  const page = Math.min(requestedPage, pageCount);
  const start = (page - 1) * TEAM_ACTIVITY_PAGE_SIZE;
  if (!Array.isArray(events) || events.length === 0) {
    return <ManagementEmptyState title="No team activity is available yet." description="Recorded team actions will appear with actor, resource, and timestamp." />;
  }

  return (
    <>
    <ol className="activity-feed" aria-label="Recent team activity">
      {events.slice(start, start + TEAM_ACTIVITY_PAGE_SIZE).map((event) => (
        <li key={event.id}>
          <span className="activity-avatar" aria-hidden="true">{(event.actorName ?? '?').slice(0, 1)}</span>
          <div className="activity-copy">
            <p><strong>{eventLabel(event.action)}</strong></p>
            <span className="activity-meta">{event.actorName ?? 'Not available'} ({eventLabel(event.actorRole)}) · <Reference value={event.resourceId} label={resourceLabel(event.resourceType, event.resourceId)} /></span>
          </div>
          <DateTime value={event.timestamp} />
        </li>
      ))}
    </ol>
    <div className="feed-pagination"><span>{start + 1}–{Math.min(start + TEAM_ACTIVITY_PAGE_SIZE, events.length)} of {events.length} recent events</span>
      {pageCount > 1 && <nav aria-label="Recent activity pages"><button type="button" className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button><button type="button" className="btn btn-ghost btn-sm" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>Next</button></nav>}
    </div>
    </>
  );
}
