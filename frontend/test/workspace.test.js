import test from 'node:test';
import assert from 'node:assert/strict';

import { createProfileModel, EMPTY_PROFILE_FIELDS } from '../src/auth/profileModel.js';
import { APPLICATION_ROUTES, getRoutePermission, resolvePreviewRouteAccess, ROUTE_ACCESS_RESULTS } from '../src/auth/routeAccess.js';
import { PERMISSIONS, ROLE_DEFINITIONS, ROLE_KEYS } from '../src/auth/roles.js';
import {
  NEUTRAL_WORKSPACE,
  WORKSPACE_DEFINITIONS_BY_ROLE,
  deriveWorkspaceData,
  getWorkspaceDefinition,
} from '../src/auth/workspace.js';
import { deriveDashboardSummary } from '../src/utils/dashboard.js';

const transactions = Object.freeze([
  Object.freeze({ id: 'TX-1', ruleStatus: 'Review', riskScore: 64 }),
  Object.freeze({ id: 'TX-2', ruleStatus: 'Passed', riskScore: 20 }),
  Object.freeze({ id: 'TX-3', ruleStatus: 'Review', riskScore: 72 }),
]);

test('shared Dashboard summary remains role-independent', () => {
  const before = deriveDashboardSummary(transactions);
  deriveWorkspaceData(ROLE_KEYS.AUDITOR, { transactions });
  deriveWorkspaceData(ROLE_KEYS.SUPERVISOR, { transactions });
  deriveWorkspaceData(ROLE_KEYS.ADMIN, { transactions });
  assert.deepEqual(deriveDashboardSummary(transactions), before);
});

test('Auditor workspace config exposes the approved metrics and operational sections', () => {
  const workspace = getWorkspaceDefinition(ROLE_KEYS.AUDITOR);
  assert.deepEqual(workspace.metricDefinitions.map((metric) => metric.key), [
    'assignedAlerts', 'transactionsNeedingReview', 'reviewsToday',
  ]);
  assert.deepEqual(workspace.sections.map((section) => section.key), [
    'workQueue', 'recentReviewActivity',
  ]);
});

test('Supervisor workspace config exposes future team metrics without team records', () => {
  const workspace = getWorkspaceDefinition(ROLE_KEYS.SUPERVISOR);
  assert.deepEqual(workspace.metricDefinitions.map((metric) => metric.key), [
    'activeTeamAlerts', 'unassignedAlerts', 'teamReviewsToday',
  ]);
  assert.deepEqual(workspace.sections.map((section) => section.key), [
    'teamWorkload', 'recentTeamActivity',
  ]);
});

test('Administrator workspace config exposes security metrics and audit insertion points', () => {
  const workspace = getWorkspaceDefinition(ROLE_KEYS.ADMIN);
  assert.deepEqual(workspace.metricDefinitions.map((metric) => metric.key), [
    'activeUsers', 'lockedAccounts', 'failedLoginsToday',
  ]);
  assert.deepEqual(workspace.sections.map((section) => section.key), [
    'systemActivity', 'recentAuditLog',
  ]);
});

test('workspace role labels derive from centralized role definitions', () => {
  for (const role of Object.values(ROLE_KEYS)) {
    assert.equal(getWorkspaceDefinition(role).roleLabel, ROLE_DEFINITIONS[role].displayName);
  }
});

test('unknown role safely returns the neutral workspace', () => {
  assert.equal(getWorkspaceDefinition('UNKNOWN'), null);
  assert.equal(deriveWorkspaceData('UNKNOWN'), NEUTRAL_WORKSPACE);
  assert.deepEqual(NEUTRAL_WORKSPACE.metrics, []);
});

test('workspace definitions contain no fake users or activity records', () => {
  for (const definition of Object.values(WORKSPACE_DEFINITIONS_BY_ROLE)) {
    assert.equal('user' in definition, false);
    assert.equal('name' in definition, false);
    assert.ok(definition.sections.every((section) => !('items' in section)));
  }
});

test('Administrator security metrics remain unavailable without security services', () => {
  const workspace = deriveWorkspaceData(ROLE_KEYS.ADMIN);
  assert.ok(workspace.metrics.every((metric) => metric.value === null));
  assert.ok(workspace.sections.every((section) => section.items.length === 0));
});

test('Supervisor team metrics remain unavailable without team relationships', () => {
  const workspace = deriveWorkspaceData(ROLE_KEYS.SUPERVISOR);
  assert.ok(workspace.metrics.every((metric) => metric.value === null));
  assert.ok(workspace.sections.every((section) => section.items.length === 0));
});

test('Auditor derives only the system review count while ownership metrics stay unavailable', () => {
  const workspace = deriveWorkspaceData(ROLE_KEYS.AUDITOR, { transactions });
  const values = Object.fromEntries(workspace.metrics.map((metric) => [metric.key, metric.value]));
  assert.deepEqual(values, {
    assignedAlerts: null,
    transactionsNeedingReview: 2,
    reviewsToday: null,
  });
});

test('/profile uses VIEW_OWN_PROFILE in centralized route access', () => {
  assert.equal(APPLICATION_ROUTES.PROFILE, '/profile');
  assert.equal(getRoutePermission('/profile'), PERMISSIONS.VIEW_OWN_PROFILE);
});

test('all three roles can access their own Profile route', () => {
  for (const role of Object.values(ROLE_KEYS)) {
    assert.equal(resolvePreviewRouteAccess('/profile', role), ROUTE_ACCESS_RESULTS.ALLOWED);
  }
});

test('Profile model safely supports a null user', () => {
  const profile = createProfileModel();
  assert.equal(profile.hasIdentity, false);
  assert.deepEqual(profile.fields, EMPTY_PROFILE_FIELDS);
  assert.equal(profile.previewRole, null);
});

test('Role Preview provides context without becoming user identity', () => {
  const profile = createProfileModel(null, ROLE_KEYS.AUDITOR);
  assert.equal(profile.hasIdentity, false);
  assert.equal(profile.previewRole.displayName, 'Auditor');
  assert.ok(Object.values(profile.fields).every((value) => value === null));
});

test('workspace helpers do not mutate inputs and return immutable collections', () => {
  const snapshot = structuredClone(transactions);
  const workspace = deriveWorkspaceData(ROLE_KEYS.AUDITOR, { transactions });
  assert.deepEqual(transactions, snapshot);
  assert.ok(Object.isFrozen(workspace));
  assert.ok(Object.isFrozen(workspace.metrics));
  assert.ok(Object.isFrozen(workspace.sections));
});
