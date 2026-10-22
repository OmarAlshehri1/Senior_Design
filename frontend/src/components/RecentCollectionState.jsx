export default function RecentCollectionState({ loading, error, empty, label, onRetry, children }) {
  if (loading) return <p role="status">Loading {label}…</p>;
  if (error) return <div role="alert"><p>{label} are unavailable. {error}</p>{onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Retry</button>}</div>;
  if (empty) return <p role="status">No {label} are available.</p>;
  return children;
}
