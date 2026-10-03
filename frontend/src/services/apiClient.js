import { environment } from '../config/env.js';
import { clearAuthSession, getAccessToken, readAuthSession, saveAuthSession } from '../auth/authSession.js';
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
      typeof body?.message === 'string' ? body.message
        : typeof body?.detail === 'string' ? body.detail
          : 'The request could not be completed.',
      {
        status: response.status,
        code: typeof body?.code === 'string' ? body.code
          : typeof body?.detail === 'string' ? body.detail
            : INTEGRATION_ERROR_CODES.REQUEST_FAILED,
      }
    );
  }

  return body;
}

export function createApiClient({ baseUrl, fetchImpl = globalThis.fetch, getToken = getAccessToken,
  getSession = readAuthSession, saveSession = saveAuthSession, clearSession = clearAuthSession } = {}) {
  const normalizedBaseUrl = typeof baseUrl === 'string' ? baseUrl.replace(/\/+$/, '') : null;
  let refreshPromise = null;

  async function refreshSession() {
    const session = getSession?.();
    if (!session?.access_token || !session?.refresh_token) return null;
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const response = await fetchImpl(buildRequestUrl(normalizedBaseUrl, '/auth/refresh'), {
          method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: session.access_token, refresh_token: session.refresh_token }),
        });
        const renewed = await parseResponse(response);
        saveSession?.(renewed);
        return renewed;
      })().finally(() => { refreshPromise = null; });
    }
    return refreshPromise;
  }

  async function send(method, path, options, file = false) {
    const headers = { Accept: file ? 'text/csv' : 'application/json', ...options.headers };
    const accessToken = getToken?.();
    if (accessToken && !headers.Authorization) headers.Authorization = `Bearer ${accessToken}`;
    const requestOptions = { method, headers, signal: options.signal };
    if (options.body !== undefined) {
      if (options.rawBody) {
        requestOptions.body = options.body;
      } else {
        headers['Content-Type'] = 'application/json';
        requestOptions.body = JSON.stringify(options.body);
      }
    }
    const url = buildRequestUrl(normalizedBaseUrl, path, options.query);
    let response = await fetchImpl(url, requestOptions);
    const authRoute = /\/auth\/(login|refresh|exchange|password-reset|unlock-request)$/.test(path);
    if (response.status === 401 && !authRoute && getSession?.()?.refresh_token) {
      try {
        const renewed = await refreshSession();
        if (renewed?.access_token) {
          const retryHeaders = { ...headers, Authorization: `Bearer ${renewed.access_token}` };
          response = await fetchImpl(url, { ...requestOptions, headers: retryHeaders });
        }
      } catch {
        clearSession?.();
      }
    }
    if (response.status === 401 && !authRoute) clearSession?.();
    return { response, file };
  }

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

    try {
      const { response } = await send(method, path, options);
      return await parseResponse(response);
    } catch (error) {
      throw normalizeIntegrationError(error);
    }
  }

  async function requestFile(path, options = {}) {
    if (!normalizedBaseUrl || typeof fetchImpl !== 'function') {
      throw new IntegrationError('The service configuration is unavailable.', {
        code: INTEGRATION_ERROR_CODES.CONFIGURATION_UNAVAILABLE,
      });
    }
    try {
      const { response } = await send('GET', path, options, true);
      if (!response.ok) {
        let body = null;
        try { body = await response.json(); } catch { /* Keep the transport error generic. */ }
        throw new IntegrationError(
          typeof body?.detail === 'string' ? body.detail : 'The request could not be completed.',
          { status: response.status, code: typeof body?.detail === 'string' ? body.detail : INTEGRATION_ERROR_CODES.REQUEST_FAILED }
        );
      }
      return await response.blob();
    } catch (error) {
      throw normalizeIntegrationError(error);
    }
  }

  return Object.freeze({
    get: (path, options) => request('GET', path, options),
    post: (path, body, options = {}) => request('POST', path, { ...options, body }),
    postRaw: (path, body, options = {}) => request('POST', path, { ...options, body, rawBody: true }),
    patch: (path, body, options = {}) => request('PATCH', path, { ...options, body }),
    delete: (path, options = {}) => request('DELETE', path, options),
    getFile: requestFile,
  });
}

export const apiClient = createApiClient({ baseUrl: environment.apiBaseUrl });
