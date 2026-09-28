import { environment } from '../config/env.js';
import {
  INTEGRATION_ERROR_CODES,
  IntegrationError,
  normalizeIntegrationError,
} from './integrationError.js';

function buildRequestUrl(baseUrl, path, query) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const url = new URL(`${baseUrl}${normalizedPath}`);

  Object.entries(query ?? {}).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });

  return url.toString();
}

async function parseResponse(response) {
  if (response.status === 204) return null;

  let body;
  try {
    body = await response.json();
  } catch (error) {
    throw new IntegrationError('The service returned an invalid response.', {
      status: response.status,
      code: INTEGRATION_ERROR_CODES.INVALID_RESPONSE,
      cause: error,
    });
  }

  if (!response.ok) {
    throw new IntegrationError(
      typeof body?.message === 'string' ? body.message : 'The request could not be completed.',
      {
        status: response.status,
        code: typeof body?.code === 'string' ? body.code : INTEGRATION_ERROR_CODES.REQUEST_FAILED,
      }
    );
  }

  return body;
}

export function createApiClient({ baseUrl, fetchImpl = globalThis.fetch } = {}) {
  const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : null;

  async function request(method, path, options = {}) {
    if (!normalizedBaseUrl) {
      throw new IntegrationError('The service configuration is unavailable.', {
        code: INTEGRATION_ERROR_CODES.CONFIGURATION_UNAVAILABLE,
      });
    }
    if (typeof fetchImpl !== 'function') {
      throw new IntegrationError('The network client is unavailable.', {
        code: INTEGRATION_ERROR_CODES.CONFIGURATION_UNAVAILABLE,
      });
    }

    const headers = { Accept: 'application/json', ...options.headers };
    const requestOptions = { method, headers, signal: options.signal };

    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      requestOptions.body = JSON.stringify(options.body);
    }

    try {
      const response = await fetchImpl(
        buildRequestUrl(normalizedBaseUrl, path, options.query),
        requestOptions
      );
      return await parseResponse(response);
    } catch (error) {
      throw normalizeIntegrationError(error);
    }
  }

  return Object.freeze({
    get: (path, options) => request('GET', path, options),
    post: (path, body, options = {}) => request('POST', path, { ...options, body }),
    patch: (path, body, options = {}) => request('PATCH', path, { ...options, body }),
  });
}

export const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });
