import test from 'node:test';
import assert from 'node:assert/strict';

import { getEnvironmentConfig, normalizeUrl } from '../src/config/env.js';

test('environment configuration normalizes API and WebSocket URLs', () => {
  assert.equal(normalizeUrl(' https://api.example.test/api/v1/// '), 'https://api.example.test/api/v1');
  assert.deepEqual(
    getEnvironmentConfig({
      VITE_API_BASE_URL: 'https://api.example.test/api/v1/',
      VITE_WS_URL: 'wss://api.example.test/ws/alerts///',
    }),
    {
      apiBaseUrl: 'https://api.example.test/api/v1',
      websocketUrl: 'wss://api.example.test/ws/alerts',
      isConfigured: true,
      missing: [],
    }
  );
});

test('environment configuration uses documented local defaults', () => {
  const config = getEnvironmentConfig({});
  assert.equal(config.apiBaseUrl, 'http://localhost:8000/api/v1');
  assert.equal(config.websocketUrl, 'ws://localhost:8000/ws/alerts');
  assert.equal(config.isConfigured, true);
});

test('missing required configuration produces a controlled state when defaults are disabled', () => {
  assert.deepEqual(getEnvironmentConfig({}, { useLocalDefaults: false }), {
    apiBaseUrl: null,
    websocketUrl: null,
    isConfigured: false,
    missing: ['VITE_API_BASE_URL', 'VITE_WS_URL'],
  });
});
