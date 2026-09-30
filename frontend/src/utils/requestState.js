export const REQUEST_STATUS = Object.freeze({
  IDLE: 'idle',
  LOADING: 'loading',
  SUCCESS: 'success',
  ERROR: 'error',
});

export const REQUEST_VIEW_STATES = Object.freeze({
  LOADING: 'LOADING',
  ERROR: 'ERROR',
  EMPTY: 'EMPTY',
  UNAVAILABLE: 'UNAVAILABLE',
});

export function invokeRetry(onRetry) {
  if (typeof onRetry !== 'function') return false;
  onRetry();
  return true;
}

export function createRequestState(overrides = {}) {
  return {
    status: REQUEST_STATUS.IDLE,
    data: null,
    error: null,
    ...overrides,
  };
}

export function requestStarted(previous = createRequestState()) {
  return { ...previous, status: REQUEST_STATUS.LOADING, error: null };
}

export function requestSucceeded(data) {
  return { status: REQUEST_STATUS.SUCCESS, data, error: null };
}

export function requestFailed(error) {
  return { status: REQUEST_STATUS.ERROR, data: null, error };
}
