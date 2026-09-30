import { normalizeCaseActivity } from '../cases/caseModel.js';
import ManagementEmptyState from './ManagementEmptyState.jsx';

export default function CaseActivityTimeline({ events = [] }) {
  const activity = normalizeCaseActivity(events);
  if (activity.length === 0) return <ManagementEmptyState title="No case activity is available yet." description="Authoritative case events will appear here in chronological order." />;
  return <ol className="case-timeline" aria-label="Case activity">{activity.map((event) => <li key={event.id}><strong>{event.type.replaceAll('_', ' ')}</strong><span>{event.actorName ?? '—'}</span><time dateTime={event.timestamp ?? undefined}>{event.timestamp ?? '—'}</time>{event.details && <p>{event.details}</p>}</li>)}</ol>;
}
