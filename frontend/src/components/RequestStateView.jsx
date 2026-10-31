import { invokeRetry, REQUEST_VIEW_STATES } from '../utils/requestState.js';
import { AlertIcon, InboxIcon, SearchIcon } from './icons.jsx';

export { REQUEST_VIEW_STATES };

// Shared state language: loading, error, empty data and empty filter results
// are visually distinct and always centered in the area they replace.
export function LoadingState({ message = 'Loading…', compact = false }) {
  return <div className={`state state-loading${compact ? ' state-compact' : ''}`} role="status" aria-live="polite">
    <span className="spinner" aria-hidden="true" />
    <p className="state-title">{message}</p>
  </div>;
}

export function SkeletonRows({ rows = 5, label = 'Loading…' }) {
  return <div className="skeleton-rows" role="status" aria-live="polite">
    <span className="sr-only">{label}</span>
    {Array.from({ length: rows }, (_, index) => <span className="skeleton skeleton-row" key={index} aria-hidden="true" />)}
  </div>;
}

export function ErrorState({ title = 'Unable to load data', message = 'Check your connection and try again.', onRetry = null, retryLabel = 'Retry', compact = false }) {
  return <div className={`state state-error${compact ? ' state-compact' : ''}`} role="alert">
    <span className="state-icon" aria-hidden="true"><AlertIcon width={18} height={18} /></span>
    <p className="state-title">{title}</p>
    {message && <p className="state-message">{message}</p>}
    {onRetry && <button type="button" className="btn btn-secondary btn-sm" onClick={() => invokeRetry(onRetry)}>{retryLabel}</button>}
  </div>;
}

export function EmptyState({ title, message = null, action = null, filtered = false, compact = false }) {
  const Icon = filtered ? SearchIcon : InboxIcon;
  return <div className={`state state-empty${compact ? ' state-compact' : ''}`} role="status">
    <span className="state-icon" aria-hidden="true"><Icon width={18} height={18} /></span>
    <p className="state-title">{title}</p>
    {message && <p className="state-message">{message}</p>}
    {action}
  </div>;
}

export function UnavailableState({ title, message = null }) {
  return <div className="state state-empty" role="status"><p className="state-title">{title}</p>{message && <p className="state-message">{message}</p>}</div>;
}
