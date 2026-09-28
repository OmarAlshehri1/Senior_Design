const LOCAL_DEFAULTS = Object.freeze({
  apiBaseUrl: 'http://localhost:8000/api/v1',
  websocketUrl: 'ws://localhost:8000/ws/alerts',
});

export function normalizeUrl(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/\/+$/, '');
  return normalized || null;
}

export function getEnvironmentConfig(source = {}, options = {}) {
  const { useLocalDefaults = true } = options;
  const apiBaseUrl = normalizeUrl(source.VITE_API_BASE_URL)
    ?? (useLocalDefaults ? LOCAL_DEFAULTS.apiBaseUrl : null);
  const websocketUrl = normalizeUrl(source.VITE_WS_URL)
    ?? (useLocalDefaults ? LOCAL_DEFAULTS.websocketUrl : null);
  const missing = [];

  if (!apiBaseUrl) missing.push('VITE_API_BASE_URL');
  if (!websocketUrl) missing.push('VITE_WS_URL');

  return Object.freeze({
    apiBaseUrl,
    websocketUrl,
    isConfigured: missing.length === 0,
    missing: Object.freeze(missing),
  });
}

export const environment = getEnvironmentConfig(import.meta.env);
