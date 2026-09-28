import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createRequestState, requestFailed, requestStarted, requestSucceeded } from '../src/utils/requestState.js';
import { settingsService } from '../src/services/settingsService.js';
import { INTEGRATION_ERROR_CODES } from '../src/services/integrationError.js';

test('request-state helpers cover idle, loading, success, and error without mutation', () => {
  const idle = createRequestState();
  const loading = requestStarted(idle);
  const success = requestSucceeded({ id: 'TX-1' });
  const error = requestFailed({ message: 'Request failed', status: 500, code: 'REQUEST_FAILED' });

  assert.deepEqual(idle, { status: 'idle', data: null, error: null });
  assert.deepEqual(loading, { status: 'loading', data: null, error: null });
  assert.deepEqual(success, { status: 'success', data: { id: 'TX-1' }, error: null });
  assert.equal(error.status, 'error');
  assert.equal(error.error.status, 500);
});

test('settings service fails predictably until a contract endpoint exists', async () => {
  await assert.rejects(settingsService.get(), (error) => {
    assert.equal(error.code, INTEGRATION_ERROR_CODES.CONFIGURATION_UNAVAILABLE);
    assert.equal(error.message, 'Settings persistence is not available.');
    return true;
  });
});

test('main user-facing source contains no prohibited early-stage terminology', async () => {
  const files = [
    '../src/components/Topbar.jsx',
    '../src/pages/Dashboard.jsx',
    '../src/pages/TransactionDetail.jsx',
    '../src/pages/NotFound.jsx',
    '../src/pages/Reports.jsx',
    '../src/pages/Settings.jsx',
    '../src/context/AppContext.jsx',
  ];
  const source = (await Promise.all(
    files.map((file) => readFile(new URL(file, import.meta.url), 'utf8'))
  )).join('\n');

  assert.doesNotMatch(
    source,
    /Demo Mode|Demo Only|Frontend Demo|Demo transaction|demo session|Routine Demo Score/i
  );
});
