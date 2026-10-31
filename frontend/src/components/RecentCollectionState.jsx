import { EmptyState, ErrorState, LoadingState } from './RequestStateView.jsx';

const sentence = (value) => value.charAt(0).toUpperCase() + value.slice(1);

export default function RecentCollectionState({ loading, error, empty, label, onRetry, children }) {
  if (loading) return <LoadingState compact message={`Loading ${label}…`} />;
  if (error) return <ErrorState compact title={`${sentence(label)} are unavailable.`} message={error} onRetry={onRetry} />;
  if (empty) return <EmptyState compact title={`No ${label} are available.`} />;
  return children;
}
