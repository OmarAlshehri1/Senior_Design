import DateTime from './DateTime.jsx';
import { normalizeCaseActivity } from '../cases/caseModel.js';
import ManagementEmptyState from './ManagementEmptyState.jsx';
import { eventLabel } from '../utils/presentation.js';

export default function CaseActivityTimeline({ events = [] }) {
  const activity = normalizeCaseActivity(events);
  if (activity.length === 0) return <ManagementEmptyState title="No case activity is available yet." description="Authoritative case events will appear here in chronological order." />;
  return <ol className="timeline case-timeline" aria-label="Case activity">{activity.map((event) => <li key={event.id}><strong>{eventLabel(event.type)}</strong><span className="timeline-meta">{event.actorName ?? '—'} · <DateTime value={event.timestamp} /></span>{event.details && <p><span>Recorded details (raw): </span>{event.details}</p>}</li>)}</ol>;
}
