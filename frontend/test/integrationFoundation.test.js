import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createTransactionsService } from '../src/services/transactionsService.js';

import { createRequestState, requestFailed, requestStarted, requestSucceeded } from '../src/utils/requestState.js';
import { createSettingsService } from '../src/services/settingsService.js';

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

test('settings service uses the contracted settings endpoints and adapts the response', async () => {
  const calls = [];
  const service = createSettingsService({
    get: async (path) => { calls.push(['GET', path]); return { organization_name: 'Northwind', updated_at: 'now' }; },
    patch: async (path, body) => { calls.push(['PATCH', path, body]); return { organization_name: body.organization_name, updated_at: 'later' }; },
  });
  assert.deepEqual(await service.get(), { organizationName: 'Northwind', updatedAt: 'now' });
  assert.deepEqual(await service.update({ organizationName: 'Contoso' }), { organizationName: 'Contoso', updatedAt: 'later' });
  assert.deepEqual(calls, [
    ['GET', '/settings'],
    ['PATCH', '/settings/organization', { organization_name: 'Contoso' }],
  ]);
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

test('transactions service loads and adapts a paginated backend collection', async () => {
  const requests = [];
  const client = {
    get: async (path, options) => {
      requests.push({ path, options });

      return {
        items: [{
          id: 'EXP-2026-000001',
          timestamp: '2026-10-02T10:30:00Z',
          vendor_id: 'VND-101',
          vendor_name: 'Almarai Dairy Co.',
          category: 'Inventory',
          amount: 500,
          currency: 'SAR',
          rule_status: 'PASSED',
          data_quality_status: 'PARTIAL',
          rule_results: [],
        }],
        total: 10000,
        page: 1,
        page_size: 100,
      };
    },
  };
  const service = createTransactionsService(client);
  const options = {
    query: {
      page: 1,
      page_size: 100,
    },
  };

  const result = await service.list(options);

  assert.deepEqual(requests, [{
    path: '/transactions',
    options,
  }]);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].id, 'EXP-2026-000001');
  assert.equal(result.items[0].vendor, 'Almarai Dairy Co.');
  assert.equal(result.items[0].time, '10:30');
  assert.equal(result.total, 10000);
  assert.equal(result.pageSize, 100);
});
