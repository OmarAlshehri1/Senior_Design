import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { AUTH_ROUTES, STANDALONE_AUTH_PATHS } from '../src/auth/authRoutes.js';
import { createProfileModel } from '../src/auth/profileModel.js';
import { createRolePreviewConfiguration } from '../src/auth/rolePreview.js';
import { APPLICATION_ROUTE_ACCESS, APPLICATION_ROUTES, ROUTE_ACCESS_RESULTS, resolvePreviewRouteAccess } from '../src/auth/routeAccess.js';
import { getPermissionsForRole, hasPermission, PERMISSIONS, ROLE_KEYS } from '../src/auth/roles.js';
import { notificationService } from '../src/notifications/notificationService.js';
import { getUnreadNotificationCount, isNotificationUnread, normalizeNotification, normalizeNotifications, NOTIFICATION_PRIORITIES, NOTIFICATION_TYPES } from '../src/notifications/notifications.js';
import { ACCESS_STATE_PRESENTATION, ACCESS_STATE_TYPES } from '../src/security/accessStates.js';
import { getSensitiveActionConfirmation, SENSITIVE_ACTIONS, SENSITIVE_ACTION_CONFIRMATIONS } from '../src/security/sensitiveActions.js';
import { invokeRetry, REQUEST_VIEW_STATES } from '../src/utils/requestState.js';

test('notification types contain exactly the approved future events', () => {
  assert.deepEqual(Object.keys(NOTIFICATION_TYPES), ['HIGH_RISK_ALERT', 'ALERT_ASSIGNED', 'ALERT_REASSIGNED', 'REVIEW_REQUIRED', 'ACCESS_REQUEST_APPROVED', 'ACCESS_REQUEST_REJECTED', 'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'SECURITY_ALERT', 'SYSTEM_NOTICE']);
});

test('notification priorities remain minimal', () => {
  assert.deepEqual(Object.keys(NOTIFICATION_PRIORITIES), ['LOW', 'NORMAL', 'HIGH']);
});

test('notification read state derives only from readAt', () => {
  assert.equal(isNotificationUnread({ readAt: null }), true);
  assert.equal(isNotificationUnread({ readAt: '2026-01-01T00:00:00Z' }), false);
  assert.equal(getUnreadNotificationCount([{ readAt: null }, { readAt: 'time' }]), 1);
});

test('empty notification collections are safe', () => {
  assert.deepEqual(normalizeNotifications(), []);
  assert.equal(getUnreadNotificationCount(), 0);
});

test('notification service methods do not fabricate success', async () => {
  const results = await Promise.allSettled(Object.values(notificationService).map((method) => method()));
  assert.ok(results.every((result) => result.status === 'rejected'));
});

test('session-expired route exists', () => {
  assert.equal(AUTH_ROUTES.SESSION_EXPIRED, '/session-expired');
  assert.ok(STANDALONE_AUTH_PATHS.includes('/session-expired'));
});

test('session-expired remains outside the application shell', () => {
  assert.equal(resolvePreviewRouteAccess('/session-expired', 'UNKNOWN'), ROUTE_ACCESS_RESULTS.STANDALONE_AUTH);
  assert.equal(APPLICATION_ROUTE_ACCESS.some((route) => route.path === '/session-expired'), false);
});

test('authentication-required concept remains distinct from permission denial', () => {
  assert.equal(ACCESS_STATE_PRESENTATION[ACCESS_STATE_TYPES.AUTHENTICATION_REQUIRED].statusCode, 401);
  assert.equal(ACCESS_STATE_PRESENTATION[ACCESS_STATE_TYPES.PERMISSION_DENIED].statusCode, 403);
  assert.notEqual(ACCESS_STATE_PRESENTATION[ACCESS_STATE_TYPES.AUTHENTICATION_REQUIRED].title, ACCESS_STATE_PRESENTATION[ACCESS_STATE_TYPES.PERMISSION_DENIED].title);
});

test('loading, error, empty, and unavailable request states remain distinct', () => {
  assert.equal(new Set(Object.values(REQUEST_VIEW_STATES)).size, 4);
});

test('retry callback behavior invokes once and rejects absent callbacks safely', () => {
  let calls = 0;
  assert.equal(invokeRetry(() => { calls += 1; }), true);
  assert.equal(calls, 1);
  assert.equal(invokeRetry(null), false);
});

test('sensitive actions use centralized explicit confirmations', () => {
  assert.deepEqual(Object.keys(SENSITIVE_ACTION_CONFIRMATIONS), Object.values(SENSITIVE_ACTIONS));
  assert.ok(Object.values(SENSITIVE_ACTIONS).every((action) => getSensitiveActionConfirmation(action)?.confirmLabel !== 'Confirm'));
  for (const file of ['AccessRequestDetails.jsx', 'AssignmentDialog.jsx', 'UserAdministrativeActions.jsx']) {
    assert.match(readFileSync(new URL(`../src/components/${file}`, import.meta.url), 'utf8'), /sensitiveActions\.js/);
  }
});

test('Auditor final permissions match approved capabilities', () => {
  assert.deepEqual(getPermissionsForRole(ROLE_KEYS.AUDITOR), [PERMISSIONS.VIEW_DASHBOARD, PERMISSIONS.VIEW_TRANSACTIONS, PERMISSIONS.REVIEW_TRANSACTIONS, PERMISSIONS.VIEW_ALERTS, PERMISSIONS.REVIEW_ALERTS, PERMISSIONS.VIEW_AUDIT_RULES, PERMISSIONS.VIEW_OWN_PROFILE]);
});

test('Supervisor final permissions include team, assignment, reports, and audit log without user management', () => {
  const permissions = getPermissionsForRole(ROLE_KEYS.SUPERVISOR);
  assert.ok([PERMISSIONS.VIEW_REPORTS, PERMISSIONS.VIEW_TEAM_ACTIVITY, PERMISSIONS.ASSIGN_ALERTS, PERMISSIONS.VIEW_AUDIT_LOG].every((permission) => permissions.includes(permission)));
  assert.equal(permissions.includes(PERMISSIONS.MANAGE_USERS), false);
});

test('Admin receives all current capabilities', () => {
  assert.deepEqual(new Set(getPermissionsForRole(ROLE_KEYS.ADMIN)), new Set(Object.values(PERMISSIONS)));
});

test('assignment action visibility derives from ASSIGN_ALERTS permission', () => {
  assert.equal(hasPermission(ROLE_KEYS.AUDITOR, PERMISSIONS.ASSIGN_ALERTS), false);
  assert.equal(hasPermission(ROLE_KEYS.SUPERVISOR, PERMISSIONS.ASSIGN_ALERTS), true);
  assert.equal(hasPermission(ROLE_KEYS.ADMIN, PERMISSIONS.ASSIGN_ALERTS), true);
});

test('user management permission remains Admin only', () => {
  assert.equal(hasPermission(ROLE_KEYS.AUDITOR, PERMISSIONS.MANAGE_USERS), false);
  assert.equal(hasPermission(ROLE_KEYS.SUPERVISOR, PERMISSIONS.MANAGE_USERS), false);
  assert.equal(hasPermission(ROLE_KEYS.ADMIN, PERMISSIONS.MANAGE_USERS), true);
});

test('audit log permission remains Supervisor and Admin only', () => {
  assert.equal(hasPermission(ROLE_KEYS.AUDITOR, PERMISSIONS.VIEW_AUDIT_LOG), false);
  assert.equal(hasPermission(ROLE_KEYS.SUPERVISOR, PERMISSIONS.VIEW_AUDIT_LOG), true);
  assert.equal(hasPermission(ROLE_KEYS.ADMIN, PERMISSIONS.VIEW_AUDIT_LOG), true);
});

test('Development Role Preview is excluded by production configuration', () => {
  const production = createRolePreviewConfiguration(false);
  assert.equal(production.enabled, false);
  assert.deepEqual(production.options, []);
});

test('unconnected profile state generates no fake identity', () => {
  const profile = createProfileModel();
  assert.equal(profile.hasIdentity, false);
  assert.ok(Object.values(profile.fields).every((value) => value === null));
});

test('notification helpers return immutable records without mutating input', () => {
  const input = { id: 'n1', type: NOTIFICATION_TYPES.SYSTEM_NOTICE, priority: NOTIFICATION_PRIORITIES.NORMAL, readAt: null };
  const snapshot = structuredClone(input);
  const records = normalizeNotifications([input]);
  assert.deepEqual(input, snapshot);
  assert.ok(Object.isFrozen(records));
  assert.ok(Object.isFrozen(records[0]));
});

test('unknown notification type is rejected safely', () => {
  assert.equal(normalizeNotification({ type: 'UNKNOWN', priority: NOTIFICATION_PRIORITIES.NORMAL }), null);
});

test('route maps contain no duplicate paths', () => {
  const applicationPaths = APPLICATION_ROUTE_ACCESS.map((route) => route.path);
  assert.equal(new Set(applicationPaths).size, applicationPaths.length);
  assert.equal(new Set(STANDALONE_AUTH_PATHS).size, STANDALONE_AUTH_PATHS.length);
});

test('all authentication routes remain outside the application shell', () => {
  for (const path of STANDALONE_AUTH_PATHS) {
    assert.equal(resolvePreviewRouteAccess(path, ROLE_KEYS.AUDITOR), ROUTE_ACCESS_RESULTS.STANDALONE_AUTH);
  }
  assert.equal(Object.values(APPLICATION_ROUTES).some((path) => STANDALONE_AUTH_PATHS.includes(path)), false);
});

test('unknown roles receive no protected capabilities', () => {
  assert.deepEqual(getPermissionsForRole('UNKNOWN'), []);
  assert.ok(Object.values(PERMISSIONS).every((permission) => !hasPermission('UNKNOWN', permission)));
});
