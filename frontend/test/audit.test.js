import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AUDIT_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_RESOURCE_TYPES,
  normalizeAuditEvent,
} from '../src/audit/auditEvents.js';
import {
  AUDIT_LOG_SCOPES,
  AUDIT_LOG_SORTS,
  deriveAuditLogView,
  filterAuditEvents,
  getAuditLogScope,
  sortAuditEvents,
} from '../src/audit/auditLog.js';
import { createSecurityActivity, normalizeLoginHistoryRecord } from '../src/audit/loginHistory.js';
import {
  REVIEW_ACTIONS,
  createReviewAccountability,
  normalizeReviewHistory,
  normalizeReviewRecord,
} from '../src/audit/reviewRecords.js';
import { createAuditService } from '../src/audit/auditService.js';
import { deriveWorkspaceData } from '../src/auth/workspace.js';
import { APPLICATION_ROUTES, ROUTE_ACCESS_RESULTS, getRoutePermission, resolvePreviewRouteAccess } from '../src/auth/routeAccess.js';
import { PERMISSIONS, ROLE_KEYS } from '../src/auth/roles.js';

const events = Object.freeze([
  Object.freeze({ id: 'event-1', actorName: 'Reviewer A', action: AUDIT_ACTIONS.LOGIN_FAILED, resourceType: AUDIT_RESOURCE_TYPES.ACCOUNT, resourceId: 'account-1', timestamp: '2026-01-01T08:00:00Z', outcome: AUDIT_OUTCOMES.FAILED, details: null }),
  Object.freeze({ id: 'event-2', actorName: 'Reviewer B', action: AUDIT_ACTIONS.TRANSACTION_REVIEWED, resourceType: AUDIT_RESOURCE_TYPES.TRANSACTION, resourceId: 'TX-1', timestamp: '2026-01-02T08:00:00Z', outcome: AUDIT_OUTCOMES.SUCCESS, details: null }),
]);

test('audit action definitions contain the stable accountability actions', () => {
  assert.deepEqual(Object.values(AUDIT_ACTIONS), [
    'LOGIN_SUCCESS', 'LOGIN_FAILED', 'LOGOUT', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED',
    'ACCOUNT_DISABLED', 'ACCOUNT_ENABLED', 'TRANSACTION_REVIEWED', 'TRANSACTION_REOPENED',
    'REVIEW_NOTE_ADDED', 'ALERT_REVIEWED', 'ALERT_REOPENED', 'ACCOUNT_UNLOCK_REJECTED', 'ALERT_ASSIGNED', 'ALERT_REASSIGNED',
    'ACCESS_REQUEST_APPROVED', 'ACCESS_REQUEST_REJECTED', 'USER_ROLE_CHANGED',
    'CASE_CREATED', 'CASE_ASSIGNED', 'CASE_REASSIGNED', 'CASE_STATUS_CHANGED',
    'CASE_ESCALATED', 'CASE_CLOSURE_REQUESTED', 'CASE_CLOSURE_APPROVED',
    'CASE_CLOSURE_REJECTED', 'CASE_CLOSED', 'EVIDENCE_ADDED', 'EVIDENCE_REJECTED',
    'CASE_COMMENT_ADDED', 'SLA_OVERDUE', 'WATCHLIST_REQUESTED',
    'WATCHLIST_APPROVED', 'WATCHLIST_REJECTED', 'WATCHLIST_REMOVED',
    'BLOCK_REQUESTED', 'BLOCK_APPROVED', 'BLOCK_REJECTED', 'UNBLOCKED',
  ]);
});

test('audit outcomes are exactly success, failed, and denied', () => {
  assert.deepEqual(Object.values(AUDIT_OUTCOMES), ['SUCCESS', 'FAILED', 'DENIED']);
});

test('audit resource types cover the approved accountable resources', () => {
  assert.deepEqual(Object.values(AUDIT_RESOURCE_TYPES), ['ACCOUNT', 'TRANSACTION', 'ALERT', 'ACCESS_REQUEST', 'USER', 'CASE', 'VENDOR', 'EVIDENCE']);
});

test('ReviewRecord normalization preserves immutable supported history fields', () => {
  const record = normalizeReviewRecord({ id: 'review-1', transactionId: 'TX-1', action: REVIEW_ACTIONS.REVIEWED, note: null });
  assert.equal(record.action, REVIEW_ACTIONS.REVIEWED);
  assert.equal(record.reviewerName, null);
  assert.ok(Object.isFrozen(record));
  assert.equal(normalizeReviewRecord({ action: 'UNKNOWN' }), null);
});

test('LoginHistory contract accepts safe outcomes without inventing context', () => {
  const record = normalizeLoginHistoryRecord({ id: 'login-1', outcome: AUDIT_OUTCOMES.SUCCESS });
  assert.equal(record.outcome, AUDIT_OUTCOMES.SUCCESS);
  assert.equal(record.context, null);
  assert.equal(normalizeLoginHistoryRecord({ outcome: AUDIT_OUTCOMES.DENIED }), null);
});

test('Audit Log permission denies Auditor and allows Supervisor and Admin', () => {
  assert.equal(resolvePreviewRouteAccess('/audit-log', ROLE_KEYS.AUDITOR), ROUTE_ACCESS_RESULTS.FORBIDDEN);
  assert.equal(resolvePreviewRouteAccess('/audit-log', ROLE_KEYS.SUPERVISOR), ROUTE_ACCESS_RESULTS.ALLOWED);
  assert.equal(resolvePreviewRouteAccess('/audit-log', ROLE_KEYS.ADMIN), ROUTE_ACCESS_RESULTS.ALLOWED);
  assert.equal(getAuditLogScope(ROLE_KEYS.SUPERVISOR), AUDIT_LOG_SCOPES.TEAM);
  assert.equal(getAuditLogScope(ROLE_KEYS.ADMIN), AUDIT_LOG_SCOPES.ALL);
});

test('Audit Log route uses centralized VIEW_AUDIT_LOG permission', () => {
  assert.equal(APPLICATION_ROUTES.AUDIT_LOG, '/audit-log');
  assert.equal(getRoutePermission('/audit-log'), PERMISSIONS.VIEW_AUDIT_LOG);
});

test('Audit Log empty dataset is safe', () => {
  assert.deepEqual(deriveAuditLogView(), []);
  assert.deepEqual(deriveAuditLogView(null), []);
});

test('Audit Log defaults to newest-first ordering', () => {
  assert.deepEqual(deriveAuditLogView(events).map((event) => event.id), ['event-2', 'event-1']);
  assert.deepEqual(sortAuditEvents(events, AUDIT_LOG_SORTS.OLDEST).map((event) => event.id), ['event-1', 'event-2']);
});

test('Audit Log filtering handles empty data safely', () => {
  assert.deepEqual(filterAuditEvents([], { action: AUDIT_ACTIONS.LOGIN_FAILED }), []);
  assert.deepEqual(filterAuditEvents(null, { outcome: AUDIT_OUTCOMES.FAILED }), []);
});

test('Audit Log filters by action', () => {
  assert.deepEqual(filterAuditEvents(events, { action: AUDIT_ACTIONS.LOGIN_FAILED }).map((event) => event.id), ['event-1']);
});

test('Audit Log filters by outcome', () => {
  assert.deepEqual(filterAuditEvents(events, { outcome: AUDIT_OUTCOMES.SUCCESS }).map((event) => event.id), ['event-2']);
});

test('unknown audit action is rejected safely', () => {
  assert.equal(normalizeAuditEvent({ action: 'UNKNOWN', outcome: AUDIT_OUTCOMES.SUCCESS, resourceType: AUDIT_RESOURCE_TYPES.ACCOUNT }), null);
  assert.deepEqual(filterAuditEvents(events, { action: 'UNKNOWN' }), []);
});

test('case status audit event remains visible after normalization', () => {
  const event = normalizeAuditEvent({
    id: 42,
    actor_name: 'Ali',
    actor_role: 'AUDITOR',
    action: 'CASE_STATUS_CHANGED',
    resource_type: 'CASE',
    resource_id: 'case-1',
    outcome: 'SUCCESS',
    created_at: '2026-10-11T17:28:48Z',
    details: { status: 'INVESTIGATING' },
  });
  assert.equal(event.action, 'CASE_STATUS_CHANGED');
  assert.equal(event.resourceId, 'case-1');
});

test('AuditService preserves the five vendor workflow events returned by a filtered API page', async () => {
  const rows = [
    { id: 86, action: 'UNBLOCKED', actor_name: 'Admin', actor_role: 'ADMIN', details: { previous_status: 'BLOCKED', new_status: 'NORMAL' } },
    { id: 85, action: 'BLOCK_APPROVED', actor_name: 'Admin', actor_role: 'ADMIN', details: { approved: true, previous_status: 'WATCHLISTED', new_status: 'BLOCKED' } },
    { id: 83, action: 'BLOCK_REQUESTED', actor_name: 'Supervisor', actor_role: 'SUPERVISOR', details: { request_type: 'BLOCK', monitoring_status: 'WATCHLISTED' } },
    { id: 82, action: 'WATCHLIST_APPROVED', actor_name: 'Supervisor', actor_role: 'SUPERVISOR', details: { approved: true, previous_status: 'NORMAL', new_status: 'WATCHLISTED' } },
    { id: 81, action: 'WATCHLIST_REQUESTED', actor_name: 'Auditor', actor_role: 'AUDITOR', details: { request_type: 'WATCHLIST', monitoring_status: 'NORMAL' } },
  ].map((row) => ({
    ...row, actor_id: `actor-${row.actor_role}`, resource_id: 'VND-106',
    resource_type: 'VENDOR', outcome: 'SUCCESS', created_at: '2026-10-19T09:55:38Z',
  }));
  const response = { page: 1, items: rows, total: 5, page_size: 25 };
  const snapshot = structuredClone(response);
  const service = createAuditService({
    get: async (path, options) => {
      assert.equal(path, '/audit-events');
      assert.deepEqual(options.query, { search: 'VND-106', page: 1 });
      return response;
    },
  });

  const page = await service.getAuditEvents({ search: 'VND-106', page: 1 });

  assert.equal(page.items.length, 5);
  assert.equal(page.total, 5);
  assert.equal(page.page, 1);
  assert.equal(page.page_size, 25);
  assert.deepEqual(page.items.map((event) => event.action), rows.map((row) => row.action));
  for (const [index, event] of page.items.entries()) {
    assert.equal(event.id, rows[index].id);
    assert.equal(event.resourceId, 'VND-106');
    assert.equal(event.resourceType, 'VENDOR');
    assert.equal(event.actorName, rows[index].actor_name);
    assert.equal(event.actorRole, rows[index].actor_role);
    assert.equal(event.timestamp, rows[index].created_at);
    assert.deepEqual(event.details, rows[index].details);
  }
  assert.deepEqual(response, snapshot);
});

test('vendor rejection and watchlist removal audit events remain visible', () => {
  for (const action of ['WATCHLIST_REJECTED', 'BLOCK_REJECTED', 'WATCHLIST_REMOVED']) {
    const event = normalizeAuditEvent({
      action, resource_type: 'VENDOR', resource_id: 'VND-106', outcome: 'SUCCESS',
    });
    assert.equal(event?.action, action);
  }
});

test('Review History accepts empty history', () => {
  assert.deepEqual(normalizeReviewHistory(), []);
  assert.deepEqual(normalizeReviewHistory(null), []);
});

test('session review state never generates fake review attribution', () => {
  const accountability = createReviewAccountability();
  assert.deepEqual(accountability, { reviewedBy: null, reviewedAt: null, note: null, history: [] });
});

test('review accountability derives latest status and note from immutable records', () => {
  const accountability = createReviewAccountability([
    { id: 3, action: 'REOPENED', reviewerName: 'Reviewer', timestamp: '2026-01-03' },
    { id: 2, action: 'NOTE_ADDED', note: 'Recheck requested', timestamp: '2026-01-02' },
    { id: 1, action: 'REVIEWED', reviewerName: 'Reviewer', timestamp: '2026-01-01' },
  ]);
  assert.equal(accountability.reviewedAt, null);
  assert.equal(accountability.note, 'Recheck requested');
  assert.equal(accountability.history.length, 3);
});

test('Profile security activity accepts unavailable values', () => {
  assert.deepEqual(createSecurityActivity(), {
    lastLoginAt: null,
    failedSignInAttempts: null,
    accountStatus: null,
    recentSignIns: [],
  });
});

test('workspace activity accepts empty immutable history', () => {
  for (const role of Object.values(ROLE_KEYS)) {
    const workspace = deriveWorkspaceData(role);
    assert.ok(workspace.sections.every((section) => section.items.length === 0));
  }
});

test('audit filtering and sorting do not mutate input', () => {
  const snapshot = structuredClone(events);
  deriveAuditLogView(events, { search: 'transaction' });
  assert.deepEqual(events, snapshot);
});

test('AuditService uses authenticated routes for filtered activity and review actions', async () => {
  const calls = [];
  const service = createAuditService({
    get: async (...args) => (calls.push(['GET', ...args]), { items: [], total: 0 }),
    post: async (...args) => (calls.push(['POST', ...args]), { id: 'saved' }),
  });
  await service.getAuditEvents({ page: 2, action: 'LOGIN_SUCCESS' });
  await service.getReviewHistory('TRANSACTION', 'TX-1', { page: 1 });
  await service.addReviewNote('TRANSACTION', 'TX-1', 'Verified receipt');
  await service.recordReview('ALERT', 'AL-1', 'REOPENED');
  assert.deepEqual(calls.map(([method, path]) => [method, path]), [
    ['GET', '/audit-events'], ['GET', '/reviews/TRANSACTION/TX-1'],
    ['POST', '/reviews/TRANSACTION/TX-1'], ['POST', '/reviews/ALERT/AL-1'],
  ]);
});

test('audit adapters translate API snake_case rows into existing UI contracts', async () => {
  const service = createAuditService({
    get: async (path) => path === '/audit-events'
      ? { items: [{ id: 4, actor_id: 'u4', actor_name: 'Reviewer', actor_role: 'AUDITOR', action: 'ALERT_REOPENED', resource_type: 'ALERT', resource_id: 'AL-4', created_at: '2026-10-03T00:00:00Z', outcome: 'SUCCESS', details: {} }], total: 1 }
      : { items: [{ id: 3, transaction_id: 'TX-3', actor_id: 'u3', actor_name: 'A', actor_role: 'AUDITOR', action: 'REVIEWED', created_at: '2026-10-02T00:00:00Z' }], total: 1 },
    post: async () => ({ record: { id: 5, transaction_id: 'TX-3', actor_id: 'u3', actor_name: 'A', actor_role: 'AUDITOR', action: 'NOTE_ADDED', created_at: '2026-10-03T00:00:00Z' } }),
  });
  const audit = await service.getAuditEvents();
  const reviews = await service.getReviewHistory('TRANSACTION', 'TX-3');
  const note = await service.addReviewNote('TRANSACTION', 'TX-3', 'Evidence attached');
  assert.equal(audit.items[0].actorName, 'Reviewer');
  assert.equal(reviews.items[0].reviewerName, 'A');
  assert.equal(note.record.action, 'NOTE_ADDED');
});
