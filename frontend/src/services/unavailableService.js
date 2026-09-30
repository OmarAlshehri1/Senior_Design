import { INTEGRATION_ERROR_CODES, IntegrationError } from './integrationError.js';

export function unavailableOperation(domain) {
  return () => Promise.reject(new IntegrationError(
    `${domain} is not available.`,
    { code: INTEGRATION_ERROR_CODES.CONFIGURATION_UNAVAILABLE }
  ));
}
