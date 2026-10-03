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
import { createUserManagementService } from '../src/management/userManagementService.js';
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
  assert.deepEqual(Object.keys(user), ['id', 'name', 'email', 'role', 'accountStatus', 'lastLoginAt', 'failedSignInAttempts', 'lockedAt', 'disabledAt', 'lockReason', 'disabledReason', 'createdAt', 'updatedAt', 'teamId', 'supervisorId']);
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

test('Team and assignment service boundaries do not fabricate success', async () => {
  const calls = [
    ...Object.values(teamService).map((method) => method()),
    ...Object.values(assignmentService).map((method) => method()),
  ];
  const results = await Promise.allSettled(calls);
  assert.ok(results.every((result) => result.status === 'rejected'));
});

test('user management service calls identity routes with role decisions server-side', async () => {
  const calls = [];
  const service = createUserManagementService({
    get: async (path, options) => { calls.push({ method: 'GET', path, options }); return { items: [] }; },
    post: async (path, body) => { calls.push({ method: 'POST', path, body }); return { id: 'req-1', status: 'APPROVED', assigned_role: body.role }; },
    patch: async (path, body) => { calls.push({ method: 'PATCH', path, body }); return { id: 'u1', role: body.role ?? 'AUDITOR', accountStatus: 'ACTIVE' }; },
  });
  await service.listUsers();
  await service.approveAccessRequest('req-1', ROLE_KEYS.AUDITOR);
  await service.changeUserRole('u1', ROLE_KEYS.SUPERVISOR);
  assert.deepEqual(calls.map(({ method, path }) => [method, path]), [
    ['GET', '/users'], ['POST', '/access-requests/req-1/decision'], ['PATCH', '/users/u1'],
  ]);
  assert.deepEqual(calls[1].body, { approve: true, role: ROLE_KEYS.AUDITOR, reason: null });
});

test('unlock administration uses the request decision flow instead of a direct user unlock', async () => {
  const calls = [];
  const service = createUserManagementService({
    get: async (path) => { calls.push(['GET', path]); return { items: [] }; },
    post: async (path, body) => { calls.push(['POST', path, body]); return { id: 'unlock-1', status: 'APPROVED' }; },
    patch: async (path, body) => { calls.push(['PATCH', path, body]); return { id: 'u1' }; },
  });
  await service.listUnlockRequests();
  await service.decideUnlockRequest('unlock-1', { approve: true });
  assert.deepEqual(calls, [
    ['GET', '/account-unlock-requests'],
    ['POST', '/account-unlock-requests/unlock-1/decision', { approve: true }],
  ]);
  assert.equal('unlockUser' in service, false);
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
