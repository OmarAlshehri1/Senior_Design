import { invokeRetry, REQUEST_VIEW_STATES } from '../utils/requestState.js';

export { REQUEST_VIEW_STATES };

export function LoadingState({ message = 'Loading data...' }) {
  return <div className="request-state request-state-loading" role="status" aria-live="polite"><span className="request-spinner" aria-hidden="true" /><p>{message}</p></div>;
}

export function ErrorState({ title = 'Unable to load data', message = 'Check your connection and try again.', onRetry = null }) {
  return <div className="request-state request-state-error" role="alert"><h3>{title}</h3><p>{message}</p>{onRetry && <button type="button" className="btn btn-secondary" onClick={() => invokeRetry(onRetry)}>Retry</button>}</div>;
}

export function EmptyState({ title, message = null }) {
  return <div className="request-state request-state-empty" role="status"><h3>{title}</h3>{message && <p>{message}</p>}</div>;
}

export function UnavailableState({ title, message = null }) {
  return <div className="request-state request-state-unavailable" role="status"><h3>{title}</h3>{message && <p>{message}</p>}</div>;
}
