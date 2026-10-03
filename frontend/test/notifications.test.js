import test from 'node:test';
import assert from 'node:assert/strict';

import { createAlertsService } from '../src/services/alertsService.js';
import { createNotificationService } from '../src/notifications/notificationService.js';

test('alert catch-up paginates every page and deduplicates persisted IDs', async () => {
  const calls = [];
  const pages = [
    { items: [{ id: 'A' }, { id: 'B', status: 'Active' }], total: 5 },
    { items: [{ id: 'B', status: 'REVIEWED' }, { id: 'C' }], total: 5 },
    { items: [{ id: 'D' }, { id: 'E' }], total: 5 },
  ];
  const service = createAlertsService({
    get: async (_path, options) => {
      calls.push(options.query);
      return pages[options.query.page - 1];
    },
  });

  const result = await service.listAll({ pageSize: 2, signal: 'abort-signal' });

  assert.deepEqual(calls, [
    { page: 1, page_size: 2 },
    { page: 2, page_size: 2 },
    { page: 3, page_size: 2 },
  ]);
  assert.deepEqual(result.items.map(({ id }) => id), ['A', 'B', 'C', 'D', 'E']);
  assert.equal(result.items[1].status, 'Reviewed');
  assert.equal(result.total, 5);
});

test('notification service uses authenticated API contracts and normalizes recipients', async () => {
  const calls = [];
  const client = {
    get: async (...args) => { calls.push(['GET', ...args]); return { items: [{
      id: 'n-1', type: 'ACCOUNT_LOCKED', title: 'Locked', message: 'Account locked',
      timestamp: '2026-10-03T00:00:00Z', readAt: null, resourceType: 'ACCOUNT', resourceId: 'u-1', priority: 'HIGH',
    }], unread_count: 1 }; },
    patch: async (...args) => { calls.push(['PATCH', ...args]); return { readAt: '2026-10-03T01:00:00Z' }; },
    post: async (...args) => { calls.push(['POST', ...args]); return { updated: 1 }; },
  };
  const service = createNotificationService(client);

  const listed = await service.listNotifications({ query: { page: 1 } });
  await service.markNotificationRead('n-1');
  await service.markAllNotificationsRead();

  assert.equal(listed.unreadCount, 1);
  assert.equal(listed.items[0].readAt, null);
  assert.deepEqual(calls.map(([method, path]) => [method, path]), [
    ['GET', '/notifications'],
    ['PATCH', '/notifications/n-1/read'],
    ['POST', '/notifications/read-all'],
  ]);
});
