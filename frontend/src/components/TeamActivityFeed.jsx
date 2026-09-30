import ManagementEmptyState from './ManagementEmptyState.jsx';

export default function TeamActivityFeed({ events = [] }) {
  if (!Array.isArray(events) || events.length === 0) {
    return <ManagementEmptyState title="No team activity is available yet." description="Recorded team actions will appear with actor, resource, and timestamp." />;
  }

  return (
    <ol className="team-activity-feed" aria-label="Recent team activity">
      {events.map((event) => (
        <li key={event.id}>
          <div><strong>{event.actorName ?? 'Not available'}</strong><span>{event.actorRole ?? 'Not available'}</span></div>
          <p>{event.action ?? 'Not available'}</p>
          <span>{event.resourceId ?? 'Not available'}</span>
          <time dateTime={event.timestamp}>{event.timestamp ?? 'Not available'}</time>
        </li>
      ))}
    </ol>
  );
}

