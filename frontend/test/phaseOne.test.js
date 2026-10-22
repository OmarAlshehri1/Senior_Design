import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAmount } from '../src/components/statusUtils.js';
import { createPagedResource, pageContext } from '../src/utils/pagedResource.js';
import { createDashboardRecentService } from '../src/services/dashboardRecentService.js';
import { createUserManagementService } from '../src/management/userManagementService.js';
import { createCasesService } from '../src/services/casesService.js';
import { createVendorsService } from '../src/services/vendorsService.js';
import { createReportsService } from '../src/services/reportsService.js';

test('amount presentation preserves recorded currency, signs and decimals without filling missing values', () => {
  assert.equal(formatAmount(1234.56, 'SAR'), '1,234.56 SAR');
  assert.equal(formatAmount(-1234.56789, 'EUR'), '-1,234.56789 EUR');
  assert.equal(formatAmount(0, 'USD'), '0 USD');
  assert.equal(formatAmount(1234.56, null), '1,234.56');
  assert.equal(formatAmount(1234.56, ''), '1,234.56');
  assert.equal(formatAmount(null, 'SAR'), 'Not available');
  assert.equal(formatAmount(undefined, 'EUR'), 'Not available');
});

for (const [name, path, factory, method] of [
  ['users', '/users', createUserManagementService, 'listUsers'],
  ['access requests', '/access-requests', createUserManagementService, 'listAccessRequests'],
  ['unlock requests', '/account-unlock-requests', createUserManagementService, 'listUnlockRequests'],
  ['cases', '/cases', createCasesService, 'listCases'],
  ['vendors', '/vendors', createVendorsService, 'listVendors'],
  ['legacy reports', '/reports', createReportsService, 'list'],
]) {
  test(`${name} requests later server pages and displays server totals, without accumulating records`, async () => {
    const calls = [];
    const service = factory({ get: async (route, { query }) => {
      calls.push({ route, query });
      return { items: [{ id: `record-on-${query.page}`, status: 'OPEN', priority: 'MEDIUM', monitoringStatus: 'NORMAL' }], total: 217, page: query.page, page_size: query.page_size };
    } });
    const resource = createPagedResource(service[method]);
    await resource.load();
    await resource.setPage(12);
    assert.deepEqual(calls, [
      { route: path, query: { page: 1, page_size: 10 } },
      { route: path, query: { page: 12, page_size: 10 } },
    ]);
    assert.deepEqual(resource.getSnapshot().items.map((item) => item.id), ['record-on-12']);
    assert.deepEqual(pageContext(resource.getSnapshot()), {
      currentPage: 12, pageSize: 10, totalPages: 22, totalItems: 217, firstItem: 111, lastItem: 111,
    });
    await resource.setPageSize(50);
    assert.deepEqual(calls.at(-1), { route: path, query: { page: 1, page_size: 50 } });
  });
}

test('server filters reset the page, remain on later pages and do not discard matching records locally', async () => {
  const calls = [];
  const resource = createPagedResource(async ({ query }) => {
    calls.push(query);
    return { items: [{ id: 'scoped-match' }], total: 80 };
  });
  await resource.setPage(5);
  await resource.setFilters({ status: 'WATCHLISTED' });
  await resource.setPage(2);
  assert.deepEqual(calls.slice(1), [
    { page: 1, page_size: 10, status: 'WATCHLISTED' },
    { page: 2, page_size: 10, status: 'WATCHLISTED' },
  ]);
  await resource.setFilters({ search: 'invoice', priority: 'HIGH' });
  assert.deepEqual(calls.at(-1), { page: 1, page_size: 10, status: 'WATCHLISTED', search: 'invoice', priority: 'HIGH' });
});

test('a shrinking server total clamps to the last page before showing an empty collection', async () => {
  const calls = [];
  const resource = createPagedResource(async ({ query }) => {
    calls.push(query.page);
    return { items: query.page === 3 ? [{ id: 'last' }] : [], total: 21 };
  });
  await resource.setPage(8);
  assert.deepEqual(calls, [8, 3]);
  assert.equal(resource.getSnapshot().query.page, 3);
  assert.equal(resource.getSnapshot().items[0].id, 'last');
});

test('empty, failed and pending pages do not share a fabricated zero total; retry can recover', async () => {
  let reject;
  const resource = createPagedResource(() => new Promise((_, failure) => { reject = failure; }));
  assert.equal(resource.getSnapshot().status, 'loading');
  assert.equal(resource.getSnapshot().total, null);
  const pending = resource.load();
  reject(new Error('Service unavailable'));
  await pending;
  assert.equal(resource.getSnapshot().status, 'error');
  assert.equal(resource.getSnapshot().total, null);
  let fail = true;
  const retryable = createPagedResource(async () => {
    if (fail) throw new Error('offline');
    return { items: [], total: 0 };
  });
  await retryable.load();
  fail = false;
  await retryable.load();
  assert.equal(retryable.getSnapshot().status, 'success');
  assert.deepEqual(pageContext(retryable.getSnapshot()), {
    currentPage: 1, pageSize: 10, totalPages: 1, totalItems: 0, firstItem: 0, lastItem: 0,
  });
});

test('cancelled/out-of-order responses never overwrite a newer scope', async () => {
  const pending = [];
  const resource = createPagedResource(({ signal }) => new Promise((resolve) => pending.push({ resolve, signal })));
  const first = resource.load();
  const second = resource.setFilters({ status: 'BLOCKED' });
  assert.equal(pending[0].signal.aborted, true);
  pending[1].resolve({ items: [{ id: 'blocked' }], total: 1 });
  await second;
  pending[0].resolve({ items: [{ id: 'old' }], total: 999 });
  await first;
  assert.equal(resource.getSnapshot().items[0].id, 'blocked');
  const last = resource.load();
  resource.cancel();
  pending[2].resolve({ items: [{ id: 'after-unmount' }], total: 1 });
  await last;
  assert.equal(resource.getSnapshot().status, 'loading');
});

test('Dashboard recent request ignores transaction browsing search/page/sort/filter state', async () => {
  const calls = [];
  const service = createDashboardRecentService({ list: async (options) => {
    calls.push(options.query);
    return { items: [{ id: 'newest' }], total: 20000 };
  } });
  const resource = createPagedResource(service.list, { page_size: 6 });
  await resource.load();
  await service.list({ query: { page: 48, search: 'old-vendor', sort_by: 'oldest', risk: 'high' } });
  assert.deepEqual(calls, [
    { page: 1, page_size: 6, sort_by: 'newest' },
    { page: 1, page_size: 6, sort_by: 'newest' },
  ]);
  assert.equal(resource.getSnapshot().items[0].id, 'newest');
});
