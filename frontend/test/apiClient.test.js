import test from 'node:test';
import assert from 'node:assert/strict';

import { createApiClient } from '../src/services/apiClient.js';
import { INTEGRATION_ERROR_CODES } from '../src/services/integrationError.js';

function jsonResponse(body, options = {}) {
  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json: async () => body,
  };
}

test('API client constructs GET requests with normalized paths and query values', async () => {
  const calls = [];
  const client = createApiClient({
    baseUrl: 'http://localhost:8000/api/v1/',
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse({ items: [] });
    },
  });

  await client.get('transactions', { query: { page: 2, search: 'vendor', empty: null } });
  assert.equal(calls[0][0], 'http://localhost:8000/api/v1/transactions?page=2&search=vendor');
  assert.equal(calls[0][1].method, 'GET');
  assert.equal(calls[0][1].headers.Accept, 'application/json');
});

test('API client sends POST and PATCH bodies as JSON', async () => {
  const calls = [];
  const client = createApiClient({
    baseUrl: 'http://localhost:8000/api/v1',
    fetchImpl: async (...args) => {
      calls.push(args);
      return jsonResponse({ ok: true });
    },
  });

  await client.post('/reports', { type: 'DAILY' });
  await client.patch('/alerts/AL-1/review', { status: 'REVIEWED' });
  assert.deepEqual(calls.map(([, options]) => [
    options.method,
    options.headers['Content-Type'],
    options.body,
  ]), [
    ['POST', 'application/json', '{"type":"DAILY"}'],
    ['PATCH', 'application/json', '{"status":"REVIEWED"}'],
  ]);
});

test('API client normalizes non-success responses', async () => {
  const client = createApiClient({
    baseUrl: 'http://localhost:8000/api/v1',
    fetchImpl: async () => jsonResponse(
      { message: 'Transaction not found.', code: 'NOT_FOUND' },
      { ok: false, status: 404 }
    ),
  });

  await assert.rejects(client.get('/transactions/missing'), (error) => {
    assert.equal(error.message, 'Transaction not found.');
    assert.equal(error.status, 404);
    assert.equal(error.code, 'NOT_FOUND');
    return true;
  });
});

test('API client normalizes network failures without exposing implementation details', async () => {
  const client = createApiClient({
    baseUrl: 'http://localhost:8000/api/v1',
    fetchImpl: async () => { throw new TypeError('socket internals'); },
  });

  await assert.rejects(client.get('/alerts'), (error) => {
    assert.equal(error.message, 'The service could not be reached.');
    assert.equal(error.status, null);
    assert.equal(error.code, INTEGRATION_ERROR_CODES.NETWORK_UNAVAILABLE);
    assert.doesNotMatch(error.message, /socket internals/);
    return true;
  });
});

test('API client rejects invalid JSON responses consistently', async () => {
  const client = createApiClient({
    baseUrl: 'http://localhost:8000/api/v1',
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => { throw new SyntaxError('invalid JSON'); },
    }),
  });

  await assert.rejects(client.get('/transactions'), (error) => {
    assert.equal(error.code, INTEGRATION_ERROR_CODES.INVALID_RESPONSE);
    assert.equal(error.status, 200);
    return true;
  });
});

test('API client forwards AbortSignal and normalizes cancellation', async () => {
  const controller = new AbortController();
  let forwardedSignal;
  const client = createApiClient({
    baseUrl: 'http://localhost:8000/api/v1',
    fetchImpl: async (_url, options) => {
      forwardedSignal = options.signal;
      const abortError = new Error('aborted');
      abortError.name = 'AbortError';
      throw abortError;
    },
  });

  await assert.rejects(client.get('/alerts', { signal: controller.signal }), (error) => {
    assert.equal(error.code, INTEGRATION_ERROR_CODES.REQUEST_ABORTED);
    return true;
  });
  assert.equal(forwardedSignal, controller.signal);
});
