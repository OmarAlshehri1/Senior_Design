import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createAlertsService } from '../src/services/alertsService.js';
import { createVendorsService } from '../src/services/vendorsService.js';

test('alerts list service preserves authoritative pagination and filter queries', async () => {
  const calls = [];
  const service = createAlertsService({
    get: async (path, options) => {
      calls.push([path, options]);
      return { items: [], total: 2, page: 1, page_size: 10 };
    },
  });
  const query = { page: 1, page_size: 10, search: 'vendor', status: 'ACTIVE', risk: 'HIGH', alert_type: 'Ghost Vendor', sort: 'highest-risk' };
  const result = await service.list({ query });
  assert.equal(result.total, 2);
  assert.deepEqual(calls, [['/alerts', { query }]]);
});

test('vendor list service preserves authoritative discovery queries', async () => {
  const calls = [];
  const service = createVendorsService({
    get: async (path, options) => {
      calls.push([path, options]);
      return { items: [], total: 1, page: 1, page_size: 10 };
    },
  });
  const query = { page: 1, page_size: 10, search: 'VEN-1', status: 'WATCHLISTED', risk: 'MEDIUM' };
  const result = await service.listVendors({ query });
  assert.equal(result.total, 1);
  assert.deepEqual(calls, [['/vendors', { query }]]);
});

test('alert and vendor pages use server totals, pagination, and page resets', async () => {
  const [alerts, vendors] = await Promise.all([
    readFile(new URL('../src/pages/Alerts.jsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/pages/Vendors.jsx', import.meta.url), 'utf8'),
  ]);

  assert.match(alerts, /alertsService\.list/);
  assert.doesNotMatch(alerts, /listAll|filterAndSortAlerts/);
  assert.match(alerts, /result\.total/);
  assert.match(alerts, /<Pagination/);
  assert.match(alerts, /setPage\(1\)/);
  assert.match(vendors, /search: querySearch/);
  assert.match(vendors, /status: statusFilter/);
  assert.match(vendors, /risk: riskFilter/);
  assert.match(vendors, /result\.total/);
  assert.match(vendors, /<Pagination/);
  assert.match(vendors, /setPage\(1\)/);
});
