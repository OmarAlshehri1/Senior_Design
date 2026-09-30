export default function ReviewHistory({ records = [] }) {
  if (!Array.isArray(records) || records.length === 0) {
    return (
      <div className="history-empty-state">
        <span aria-hidden="true">—</span>
        <p>No recorded review history is available yet.</p>
      </div>
    );
  }

  return (
    <ol className="review-history-list" aria-label="Review history">
      {records.map((record) => (
        <li key={record.id}>
          <div>
            <strong>{record.reviewerName}</strong>
            <span>{record.reviewerRole}</span>
          </div>
          <p>{record.action}</p>
          <time dateTime={record.timestamp}>{record.timestamp}</time>
          {record.note && <blockquote>{record.note}</blockquote>}
        </li>
      ))}
    </ol>
  );
}
