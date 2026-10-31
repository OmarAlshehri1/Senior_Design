import DateTime from './DateTime.jsx';
import { EmptyState } from './RequestStateView.jsx';
import { eventLabel } from '../utils/presentation.js';

export default function ReviewHistory({ records = [] }) {
  if (!Array.isArray(records) || records.length === 0) {
    return <EmptyState compact title="No review history yet." message="Reviews, reopenings and notes appear here with who and when." />;
  }

  return (
    <ol className="timeline review-history-list" aria-label="Review history">
      {records.map((record) => (
        <li key={record.id}>
          <strong>{eventLabel(record.action)}</strong>
          <span className="timeline-meta">{record.reviewerName}{record.reviewerRole ? ` · ${record.reviewerRole}` : ''} · <DateTime value={record.timestamp} /></span>
          {record.note && <p>{record.note}</p>}
        </li>
      ))}
    </ol>
  );
}
