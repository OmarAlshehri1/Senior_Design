import { INTEGRATION_ERROR_CODES, IntegrationError } from './integrationError.js';

function unsupportedSettingsOperation() {
  return Promise.reject(new IntegrationError(
    'Settings persistence is not available.',
    { code: INTEGRATION_ERROR_CODES.CONFIGURATION_UNAVAILABLE }
  ));
}

// Settings endpoints are not part of the current API contract. This boundary keeps
// pages independent of that future transport without inventing an endpoint today.
export const settingsService = Object.freeze({
  get: unsupportedSettingsOperation,
  update: unsupportedSettingsOperation,
});
