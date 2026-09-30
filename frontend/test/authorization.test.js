import test from 'node:test';
import assert from 'node:assert/strict';

import { STANDALONE_AUTH_PATHS } from '../src/auth/authRoutes.js';
import { getNavigationState } from '../src/auth/navigationConfig.js';
import { createRolePreviewConfiguration } from '../src/auth/rolePreview.js';
import {
  APPLICATION_ROUTE_ACCESS,
  APPLICATION_ROUTES,
  ROUTE_ACCESS_RESULTS,
  getRouteAccess,
  resolvePreviewRouteAccess,
} from '../src/auth/routeAccess.js';
import { PERMISSIONS, ROLE_KEYS } from '../src/auth/roles.js';

const auditorAllowed = [
  '/',
  '/dashboard',
  '/transactions',
  '/transactions/TX-10486',
  '/alerts',
  '/audit-rules',
];

test('Auditor route access allows monitoring and audit work but denies reports and settings', () => {
  for (const path of auditorAllowed) {
    assert.equal(resolvePreviewRouteAccess(path, ROLE_KEYS.AUDITOR), ROUTE_ACCESS_RESULTS.ALLOWED);
  }
  assert.equal(resolvePreviewRouteAccess('/reports', ROLE_KEYS.AUDITOR), ROUTE_ACCESS_RESULTS.FORBIDDEN);
  assert.equal(resolvePreviewRouteAccess('/settings', ROLE_KEYS.AUDITOR), ROUTE_ACCESS_RESULTS.FORBIDDEN);
});

test('Supervisor route access allows reports and denies settings', () => {
  assert.equal(resolvePreviewRouteAccess('/reports', ROLE_KEYS.SUPERVISOR), ROUTE_ACCESS_RESULTS.ALLOWED);
  assert.equal(resolvePreviewRouteAccess('/settings', ROLE_KEYS.SUPERVISOR), ROUTE_ACCESS_RESULTS.FORBIDDEN);
});

test('Admin can access every configured application route', () => {
  for (const route of APPLICATION_ROUTE_ACCESS) {
    const path = route.path.replace(':id', 'TX-10486');
    assert.equal(resolvePreviewRouteAccess(path, ROLE_KEYS.ADMIN), ROUTE_ACCESS_RESULTS.ALLOWED);
  }
});

test('unknown role receives no protected route permission', () => {
  for (const route of APPLICATION_ROUTE_ACCESS) {
    const path = route.path.replace(':id', 'TX-10486');
    assert.equal(resolvePreviewRouteAccess(path, 'UNKNOWN'), ROUTE_ACCESS_RESULTS.FORBIDDEN);
  }
});

test('route access config uses centralized permissions and transaction detail reuses VIEW_TRANSACTIONS', () => {
  const knownPermissions = new Set(Object.values(PERMISSIONS));
  assert.ok(APPLICATION_ROUTE_ACCESS.every((route) => knownPermissions.has(route.permission)));
  assert.equal(getRouteAccess('/transactions/TX-10486').permission, PERMISSIONS.VIEW_TRANSACTIONS);
  assert.ok(Object.isFrozen(APPLICATION_ROUTE_ACCESS));
  assert.ok(APPLICATION_ROUTE_ACCESS.every(Object.isFrozen));
});

test('locked navigation is derived from permission checks rather than role-specific link lists', () => {
  const auditor = getNavigationState(ROLE_KEYS.AUDITOR).flatMap((group) => group.links);
  const supervisor = getNavigationState(ROLE_KEYS.SUPERVISOR).flatMap((group) => group.links);

  assert.deepEqual(
    auditor.filter((link) => link.restricted).map((link) => link.label),
    ['Reports', 'Settings']
  );
  assert.deepEqual(
    supervisor.filter((link) => link.restricted).map((link) => link.label),
    ['Settings']
  );
});

test('direct restricted routes resolve to forbidden behavior during role preview', () => {
  assert.equal(resolvePreviewRouteAccess('/reports?view=summary', ROLE_KEYS.AUDITOR), ROUTE_ACCESS_RESULTS.FORBIDDEN);
  assert.equal(resolvePreviewRouteAccess('/settings', ROLE_KEYS.SUPERVISOR), ROUTE_ACCESS_RESULTS.FORBIDDEN);
});

test('403 and 404 route outcomes remain distinct', () => {
  assert.equal(resolvePreviewRouteAccess(APPLICATION_ROUTES.FORBIDDEN, ROLE_KEYS.AUDITOR), ROUTE_ACCESS_RESULTS.ALLOWED);
  assert.equal(resolvePreviewRouteAccess('/route-that-does-not-exist', ROLE_KEYS.AUDITOR), ROUTE_ACCESS_RESULTS.NOT_FOUND);
});

test('standalone auth routes are outside role restrictions', () => {
  for (const path of STANDALONE_AUTH_PATHS) {
    assert.equal(resolvePreviewRouteAccess(path, 'UNKNOWN'), ROUTE_ACCESS_RESULTS.STANDALONE_AUTH);
  }
});

test('development role preview is in-memory, non-persistent, and disabled by production configuration', () => {
  const development = createRolePreviewConfiguration(true);
  const production = createRolePreviewConfiguration(false);

  assert.equal(development.persistent, false);
  assert.equal(development.storage, null);
  assert.deepEqual(development.options.map((option) => option.value), [
    ROLE_KEYS.AUDITOR,
    ROLE_KEYS.SUPERVISOR,
    ROLE_KEYS.ADMIN,
  ]);
  assert.equal(production.enabled, false);
  assert.deepEqual(production.options, []);
  assert.ok(Object.isFrozen(development));
});
