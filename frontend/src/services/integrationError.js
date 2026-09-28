export const INTEGRATION_ERROR_CODES = Object.freeze({
  CONFIGURATION_UNAVAILABLE: 'CONFIGURATION_UNAVAILABLE',
  NETWORK_UNAVAILABLE: 'NETWORK_UNAVAILABLE',
  REQUEST_FAILED: 'REQUEST_FAILED',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  REQUEST_ABORTED: 'REQUEST_ABORTED',
});

export class IntegrationError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'IntegrationError';
    this.status = options.status ?? null;
    this.code = options.code ?? INTEGRATION_ERROR_CODES.REQUEST_FAILED;
    if (options.cause) this.cause = options.cause;
  }
}

export function normalizeIntegrationError(error) {
  if (error instanceof IntegrationError) return error;

  if (error?.name === 'AbortError') {
    return new IntegrationError('The request was cancelled.', {
      code: INTEGRATION_ERROR_CODES.REQUEST_ABORTED,
      cause: error,
    });
  }

  return new IntegrationError('The service could not be reached.', {
    code: INTEGRATION_ERROR_CODES.NETWORK_UNAVAILABLE,
    cause: error,
  });
}
