import test from 'node:test';
import assert from 'node:assert/strict';

import { loadAdminWorkspaceData } from '../src/management/adminWorkspaceService.js';

test('Admin workspace loads user counts, UTC failed logins, and recent audit feeds', async () => {
  const userRequests = [];
  const eventRequests = [];
  const events = [{ id: 'event-1', action: 'LOGIN_FAILED', actorName: 'Ali' }];
  const data = await loadAdminWorkspaceData({
    now: new Date('2026-10-04T17:00:00Z'),
    usersService: {
      async listUsers({ query }) {
        userRequests.push(query);
        return query.page === 1
          ? { total: 101, items: [
            { accountStatus: 'ACTIVE' },
            { accountStatus: 'LOCKED' },
            ...Array.from({ length: 98 }, () => ({ accountStatus: 'DISABLED' })),
          ] }
          : { total: 101, items: [{ accountStatus: 'ACTIVE' }] };
      },
    },
    eventsService: {
      async getAuditEvents(query) {
        eventRequests.push(query);
        if (query.action === 'LOGIN_FAILED') return { total: 2, items: [] };
        return { total: events.length, items: events };
      },
    },
  });

  assert.equal(data.activeUsers, 2);
  assert.equal(data.lockedAccounts, 1);
  assert.equal(data.failedLoginsToday, 2);
  assert.deepEqual(data.systemActivity, events);
  assert.deepEqual(data.recentAuditLog, events);
  assert.deepEqual(userRequests, [
    { page: 1, page_size: 100 },
    { page: 2, page_size: 100 },
  ]);
  assert.ok(eventRequests.some((query) => query.action === 'LOGIN_FAILED' && query.date === '2026-10-04'));
  assert.ok(Object.values(data.errors).every((error) => error === null));
});

test('Admin workspace reports failed sources without fabricating zero values', async () => {
  const data = await loadAdminWorkspaceData({
    usersService: { async listUsers() { throw new Error('private backend detail'); } },
    eventsService: {
      async getAuditEvents(query) {
        if (query.action === 'LOGIN_FAILED') return { total: 0, items: [] };
        throw new Error('private audit detail');
      },
    },
  });

  assert.equal(data.activeUsers, null);
  assert.equal(data.lockedAccounts, null);
  assert.equal(data.failedLoginsToday, 0);
  assert.equal(data.systemActivity, null);
  assert.equal(data.recentAuditLog, null);
  assert.equal(data.errors.users, 'User metrics could not be loaded.');
  assert.equal(data.errors.systemActivity, 'Security activity could not be loaded.');
  assert.equal(data.errors.recentAuditLog, 'Audit log activity could not be loaded.');
});
