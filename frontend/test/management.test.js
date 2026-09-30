import test from 'node:test';
import assert from 'node:assert/strict';

import { ACCOUNT_STATUSES } from '../src/auth/accountStatus.js';
import { ACCESS_REQUEST_ASSIGNABLE_ROLES, ACCESS_REQUEST_INPUT_FIELDS } from '../src/auth/accessRequest.js';
import { getNavigationState } from '../src/auth/navigationConfig.js';
import { APPLICATION_ROUTES, ROUTE_ACCESS_RESULTS, getRoutePermission, resolvePreviewRouteAccess } from '../src/auth/routeAccess.js';
import { PERMISSIONS, ROLE_KEYS } from '../src/auth/roles.js';
import { deriveWorkspaceData } from '../src/auth/workspace.js';
import { createApprovalModel, normalizeAccessRequests } from '../src/management/accessRequestAdmin.js';
import { deriveUserSummary, normalizeUser, normalizeUsers } from '../src/management/userModel.js';
import { userManagementService } from '../src/management/userManagementService.js';
import { createTeamActivityModel } from '../src/team/teamActivity.js';
import { teamService } from '../src/team/teamService.js';
import { ALERT_ASSIGNMENT_FIELDS, ASSIGNMENT_STATUSES, normalizeAlertAssignment, normalizeAssignmentHistory } from '../src/assignments/alertAssignments.js';
import { assignmentService } from '../src/assignments/assignmentService.js';

test('User Management denies Auditor and Supervisor while allowing Admin', () => {
  assert.equal(getRoutePermission(APPLICATION_ROUTES.USERS), PERMISSIONS.MANAGE_USERS);
  assert.equal(resolvePreviewRouteAccess('/users', ROLE_KEYS.AUDITOR), ROUTE_ACCESS_RESULTS.FORBIDDEN);
  assert.equal(resolvePreviewRouteAccess('/users', ROLE_KEYS.SUPERVISOR), ROUTE_ACCESS_RESULTS.FORBIDDEN);
  assert.equal(resolvePreviewRouteAccess('/users', ROLE_KEYS.ADMIN), ROUTE_ACCESS_RESULTS.ALLOWED);
});

test('Team Activity denies Auditor while allowing Supervisor and Admin', () => {
  assert.equal(getRoutePermission(APPLICATION_ROUTES.TEAM_ACTIVITY), PERMISSIONS.VIEW_TEAM_ACTIVITY);
  assert.equal(resolvePreviewRouteAccess('/team-activity', ROLE_KEYS.AUDITOR), ROUTE_ACCESS_RESULTS.FORBIDDEN);
  assert.equal(resolvePreviewRouteAccess('/team-activity', ROLE_KEYS.SUPERVISOR), ROUTE_ACCESS_RESULTS.ALLOWED);
  assert.equal(resolvePreviewRouteAccess('/team-activity', ROLE_KEYS.ADMIN), ROUTE_ACCESS_RESULTS.ALLOWED);
});

test('Sidebar Management navigation is ordered and derived from permissions', () => {
  const roles = [ROLE_KEYS.AUDITOR, ROLE_KEYS.SUPERVISOR, ROLE_KEYS.ADMIN];
  const states = roles.map((role) => getNavigationState(role).find((group) => group.label === 'Management'));
  assert.deepEqual(states[0].links.map((link) => link.label), ['Cases', 'Team Activity', 'User Management', 'Audit Log']);
  assert.deepEqual(states.map((state) => state.links.map((link) => link.restricted)), [
    [false, true, true, true], [false, false, true, false], [false, false, false, false],
  ]);
});

test('Access request approval roles come from the centralized role model', () => {
  assert.deepEqual(ACCESS_REQUEST_ASSIGNABLE_ROLES, Object.values(ROLE_KEYS));
});

test('Requester cannot self-select a role in the request-access flow', () => {
  assert.equal(ACCESS_REQUEST_INPUT_FIELDS.includes('assignedRole'), false);
});

test('Approval model requires a valid centralized role', () => {
  for (const role of Object.values(ROLE_KEYS)) assert.equal(createApprovalModel({ assignedRole: role }).valid, true);
  assert.equal(createApprovalModel().valid, false);
});

test('Unknown approval and user roles are rejected safely', () => {
  assert.deepEqual(createApprovalModel({ assignedRole: 'OWNER' }), { assignedRole: null, teamId: null, valid: false });
  assert.equal(normalizeUser({ id: '1', role: 'OWNER' }).role, null);
});

test('User model reuses centralized account status definitions', () => {
  assert.equal(normalizeUser({ accountStatus: ACCOUNT_STATUSES.LOCKED }).accountStatus, ACCOUNT_STATUSES.LOCKED);
  assert.equal(normalizeUser({ accountStatus: 'SUSPENDED' }).accountStatus, null);
});

test('User model supports unavailable and null values', () => {
  const user = normalizeUser({ id: null });
  assert.deepEqual(Object.keys(user), ['id', 'name', 'email', 'role', 'accountStatus', 'lastLoginAt', 'createdAt', 'updatedAt', 'teamId', 'supervisorId']);
  assert.ok(Object.values(user).every((value) => value === null));
});

test('Empty user collections and unavailable summaries are safe', () => {
  assert.deepEqual(normalizeUsers(), []);
  assert.deepEqual(deriveUserSummary(), { total: null, active: null, locked: null, disabled: null });
});

test('Empty access request collections are safe', () => {
  assert.deepEqual(normalizeAccessRequests(), []);
  assert.ok(Object.isFrozen(normalizeAccessRequests()));
});

test('Empty locked account collections are safe', () => {
  assert.deepEqual(normalizeUsers([]).filter((user) => user.accountStatus === ACCOUNT_STATUSES.LOCKED), []);
});

test('Empty disabled account collections are safe', () => {
  assert.deepEqual(normalizeUsers([]).filter((user) => user.accountStatus === ACCOUNT_STATUSES.DISABLED), []);
});

test('Assignment contract normalizes only minimal centralized statuses', () => {
  const assignment = normalizeAlertAssignment({ id: 'a1', alertId: 'x1', status: ASSIGNMENT_STATUSES.ASSIGNED });
  assert.deepEqual(Object.keys(assignment), ALERT_ASSIGNMENT_FIELDS);
  assert.equal(normalizeAlertAssignment({ status: 'COMPLETED' }), null);
});

test('Empty assignment history is safe', () => {
  assert.deepEqual(normalizeAssignmentHistory(), []);
  assert.ok(Object.isFrozen(normalizeAssignmentHistory()));
});

test('Auditor workspace never treats all system alerts as assigned alerts', () => {
  const workspace = deriveWorkspaceData(ROLE_KEYS.AUDITOR, { alerts: [{ id: 'system-alert' }] });
  assert.equal(workspace.metrics.find((metric) => metric.key === 'assignedAlerts').value, null);
});

test('Supervisor team data accepts a completely unavailable state', () => {
  const team = createTeamActivityModel();
  assert.ok(Object.values(team.overview).every((value) => value === null));
  assert.deepEqual(team.activity, []);
  assert.deepEqual(team.workload, []);
});

test('Admin user and security metrics accept unavailable state', () => {
  const workspace = deriveWorkspaceData(ROLE_KEYS.ADMIN);
  assert.ok(workspace.metrics.every((metric) => metric.value === null));
});

test('Management, team, and assignment service boundaries do not fabricate success', async () => {
  const calls = [
    ...Object.values(userManagementService).map((method) => method()),
    ...Object.values(teamService).map((method) => method()),
    ...Object.values(assignmentService).map((method) => method()),
  ];
  const results = await Promise.allSettled(calls);
  assert.ok(results.every((result) => result.status === 'rejected'));
});

test('Administrative models do not mutate inputs and assignment history is immutable', () => {
  const userInput = { id: 'u1', role: ROLE_KEYS.AUDITOR, accountStatus: ACCOUNT_STATUSES.ACTIVE };
  const assignmentInput = { id: 'a1', alertId: 'x1', status: ASSIGNMENT_STATUSES.REASSIGNED };
  const userSnapshot = structuredClone(userInput);
  const assignmentSnapshot = structuredClone(assignmentInput);
  const user = normalizeUser(userInput);
  const history = normalizeAssignmentHistory([assignmentInput]);
  assert.deepEqual(userInput, userSnapshot);
  assert.deepEqual(assignmentInput, assignmentSnapshot);
  assert.ok(Object.isFrozen(user));
  assert.ok(Object.isFrozen(history));
  assert.ok(Object.isFrozen(history[0]));
});
