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
import { auditService, AuditServiceUnavailableError } from '../src/audit/auditService.js';
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
    'REVIEW_NOTE_ADDED', 'ALERT_REVIEWED', 'ALERT_ASSIGNED', 'ALERT_REASSIGNED',
    'ACCESS_REQUEST_APPROVED', 'ACCESS_REQUEST_REJECTED', 'USER_ROLE_CHANGED',
  ]);
});

test('audit outcomes are exactly success, failed, and denied', () => {
  assert.deepEqual(Object.values(AUDIT_OUTCOMES), ['SUCCESS', 'FAILED', 'DENIED']);
});

test('audit resource types cover the approved accountable resources', () => {
  assert.deepEqual(Object.values(AUDIT_RESOURCE_TYPES), ['ACCOUNT', 'TRANSACTION', 'ALERT', 'ACCESS_REQUEST', 'USER']);
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

test('Review History accepts empty history', () => {
  assert.deepEqual(normalizeReviewHistory(), []);
  assert.deepEqual(normalizeReviewHistory(null), []);
});

test('session review state never generates fake review attribution', () => {
  const accountability = createReviewAccountability();
  assert.deepEqual(accountability, { reviewedBy: null, reviewedAt: null, note: null, history: [] });
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

test('dormant audit services reject without fabricating records', async () => {
  await assert.rejects(auditService.getAuditEvents(), AuditServiceUnavailableError);
  await assert.rejects(auditService.getReviewHistory('TX-1'), AuditServiceUnavailableError);
  await assert.rejects(auditService.addReviewNote('TX-1', 'not persisted'), AuditServiceUnavailableError);
});
