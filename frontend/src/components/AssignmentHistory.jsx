export default function AssignmentHistory({ records = [] }) {
  if (!Array.isArray(records) || records.length === 0) {
    return <p className="assignment-history-empty">No assignment history is available yet.</p>;
  }

  return (
    <ol className="assignment-history-list" aria-label="Assignment history">
      {records.map((record) => (
        <li key={record.id}>
          <strong>{record.assigneeName ?? 'Not available'}</strong>
          <span>{record.status}</span>
          <span>Assigned by {record.assignedByName ?? 'Not available'}</span>
          <time dateTime={record.assignedAt}>{record.assignedAt}</time>
        </li>
      ))}
    </ol>
  );
}

