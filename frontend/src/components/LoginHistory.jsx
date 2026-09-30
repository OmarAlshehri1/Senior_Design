import { AUDIT_OUTCOMES } from '../audit/auditEvents.js';

export default function LoginHistory({ records = [] }) {
  if (!Array.isArray(records) || records.length === 0) {
    return <p className="login-history-empty">No sign-in history is available yet.</p>;
  }

  return (
    <ol className="login-history-list" aria-label="Recent sign-in activity">
      {records.map((record) => (
        <li key={record.id}>
          <span>{record.outcome === AUDIT_OUTCOMES.SUCCESS ? 'Successful sign-in' : 'Failed sign-in'}</span>
          <time dateTime={record.timestamp}>{record.timestamp}</time>
        </li>
      ))}
    </ol>
  );
}
