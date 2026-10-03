import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PERMISSIONS,
  ROLE_DEFINITIONS,
  ROLE_KEYS,
  ROLE_PERMISSION_MAP,
  getPermissionsForRole,
  getRoleDefinition,
  hasPermission,
} from '../src/auth/roles.js';
import {
  ACCOUNT_STATUSES,
  ACCOUNT_STATUS_DEFINITIONS,
} from '../src/auth/accountStatus.js';
import {
  AUTH_ERROR_CODES,
  AuthError,
  normalizeAuthError,
} from '../src/auth/authErrors.js';
import { createAuthService } from '../src/auth/authService.js';
import { AUTH_STATUSES, createAuthState } from '../src/auth/authState.js';
import { validateEmail, validateLoginForm } from '../src/auth/loginValidation.js';
import {
  ACCESS_REQUEST_CONTRACT_FIELDS,
  ACCESS_REQUEST_INPUT_FIELDS,
  ACCESS_REQUEST_STATUSES,
  ACCESS_REQUEST_STATUS_DEFINITIONS,
} from '../src/auth/accessRequest.js';
import {
  ACCESS_REASON_MAX_LENGTH,
  validateAccessRequest,
} from '../src/auth/accessRequestValidation.js';
import { AUTH_ROUTES, STANDALONE_AUTH_PATHS } from '../src/auth/authRoutes.js';
import { getSupportPresentation } from '../src/auth/supportConfig.js';
import { USER_LIFECYCLE_SEQUENCE } from '../src/auth/userLifecycle.js';

test('role model defines exactly Auditor, Supervisor, and Admin', () => {
  assert.deepEqual(Object.keys(ROLE_DEFINITIONS), [
    ROLE_KEYS.AUDITOR,
    ROLE_KEYS.SUPERVISOR,
    ROLE_KEYS.ADMIN,
  ]);
  assert.equal(ROLE_DEFINITIONS.ADMIN.displayName, 'Administrator');
});

test('Auditor permission matrix matches the approved capabilities', () => {
  assert.deepEqual(getPermissionsForRole(ROLE_KEYS.AUDITOR), [
    PERMISSIONS.VIEW_DASHBOARD,
    PERMISSIONS.VIEW_TRANSACTIONS,
    PERMISSIONS.REVIEW_TRANSACTIONS,
    PERMISSIONS.VIEW_ALERTS,
    PERMISSIONS.REVIEW_ALERTS,
    PERMISSIONS.VIEW_AUDIT_RULES,
    PERMISSIONS.VIEW_OWN_PROFILE,
    PERMISSIONS.VIEW_CASES,
    PERMISSIONS.CREATE_CASE,
    PERMISSIONS.UPDATE_ASSIGNED_CASE,
    PERMISSIONS.REQUEST_CASE_CLOSURE,
    PERMISSIONS.ESCALATE_CASE,
    PERMISSIONS.VIEW_VENDORS,
    PERMISSIONS.REQUEST_VENDOR_WATCHLIST,
  ]);
});

test('unknown roles receive no permissions or role definition', () => {
  assert.deepEqual(getPermissionsForRole('UNKNOWN'), []);
  assert.equal(getRoleDefinition('UNKNOWN'), null);
  assert.equal(hasPermission('UNKNOWN', PERMISSIONS.VIEW_DASHBOARD), false);
});

test('Admin receives every defined permission', () => {
  assert.deepEqual(
    new Set(getPermissionsForRole(ROLE_KEYS.ADMIN)),
    new Set(Object.values(PERMISSIONS))
  );
});

test('Supervisor receives Auditor permissions plus approved supervisor permissions', () => {
  const auditor = getPermissionsForRole(ROLE_KEYS.AUDITOR);
  const supervisor = getPermissionsForRole(ROLE_KEYS.SUPERVISOR);

  assert.ok(auditor.every((permission) => supervisor.includes(permission)));
  assert.deepEqual(supervisor.slice(auditor.length), [
    PERMISSIONS.VIEW_REPORTS,
    PERMISSIONS.VIEW_TEAM_ACTIVITY,
    PERMISSIONS.ASSIGN_ALERTS,
    PERMISSIONS.VIEW_AUDIT_LOG,
    PERMISSIONS.APPROVE_CASE_CLOSURE,
    PERMISSIONS.REVIEW_VENDOR_WATCHLIST_REQUEST,
    PERMISSIONS.REQUEST_VENDOR_BLOCK,
  ]);
});

test('Auditor cannot access management or settings permissions', () => {
  const restricted = [
    PERMISSIONS.MANAGE_USERS,
    PERMISSIONS.UNLOCK_USERS,
    PERMISSIONS.CHANGE_USER_ROLES,
    PERMISSIONS.VIEW_SETTINGS,
    PERMISSIONS.MANAGE_SETTINGS,
  ];
  assert.ok(restricted.every((permission) => !hasPermission(ROLE_KEYS.AUDITOR, permission)));
});

test('role helpers do not expose mutable permission metadata', () => {
  const permissions = getPermissionsForRole(ROLE_KEYS.AUDITOR);
  permissions.push(PERMISSIONS.MANAGE_USERS);

  assert.equal(hasPermission(ROLE_KEYS.AUDITOR, PERMISSIONS.MANAGE_USERS), false);
  assert.ok(Object.isFrozen(ROLE_DEFINITIONS));
  assert.ok(Object.isFrozen(ROLE_PERMISSION_MAP[ROLE_KEYS.AUDITOR]));
});

test('auth service signs in through API and keeps credentials only in session storage', async () => {
  const values = new Map();
  const calls = [];
  const service = createAuthService({
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    client: { post: async (...args) => { calls.push(args); return { access_token: 'access', refresh_token: 'refresh', user: { id: 'u1', role: 'AUDITOR' } }; } },
  });
  const user = await service.signIn('auditor@example.com', 'password');
  assert.deepEqual(user, { id: 'u1', role: 'AUDITOR' });
  assert.deepEqual(calls[0], ['/auth/login', { email: 'auditor@example.com', password: 'password' }]);
  assert.equal(JSON.parse([...values.values()][0]).access_token, 'access');
  assert.equal(JSON.parse([...values.values()][0]).user.id, 'u1');
  await service.signOut();
  assert.equal(values.size, 0);
});

test('auth service restores and rotates an expired session before loading profile', async () => {
  const values = new Map([['m004.auth.session.v1', JSON.stringify({ access_token: 'old', refresh_token: 'refresh' })]]);
  const calls = [];
  const service = createAuthService({
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    client: {
      get: async () => {
        calls.push('me');
        if (calls.length === 1) throw Object.assign(new Error('expired'), { status: 401 });
        return { id: 'u2', role: 'SUPERVISOR' };
      },
      post: async (path, body) => { calls.push({ path, body }); return { access_token: 'new', refresh_token: 'new-refresh' }; },
    },
  });
  assert.deepEqual(await service.restoreSession(), { id: 'u2', role: 'SUPERVISOR' });
  assert.equal(calls[1].path, '/auth/refresh');
  assert.equal(JSON.parse(values.get('m004.auth.session.v1')).access_token, 'new');
  await service.signOut();
});

test('auth service exchanges one-time link credentials and clears the session after password update', async () => {
  const values = new Map();
  const calls = [];
  const service = createAuthService({
    storage: { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) },
    client: { post: async (...args) => {
      calls.push(args);
      if (args[0] === '/auth/exchange') return { access_token: 'verified', refresh_token: 'rotating', user: { id: 'u3' } };
      return null;
    } },
  });
  assert.deepEqual(await service.exchange('provider-access', 'provider-refresh'), { id: 'u3' });
  await service.updatePassword('long-secure-password');
  assert.deepEqual(calls, [
    ['/auth/exchange', { access_token: 'provider-access', refresh_token: 'provider-refresh' }],
    ['/auth/password', { password: 'long-secure-password' }],
  ]);
  assert.equal(values.size, 0);
});

test('AUTH_UNAVAILABLE and unknown errors normalize to a safe message', () => {
  const unavailable = normalizeAuthError(new AuthError(AUTH_ERROR_CODES.AUTH_UNAVAILABLE));
  const unknown = normalizeAuthError(new Error('sensitive provider detail'));

  assert.equal(unavailable.message, 'Sign-in service is not available yet.');
  assert.equal(unknown.code, AUTH_ERROR_CODES.AUTH_UNAVAILABLE);
  assert.doesNotMatch(unknown.message, /sensitive provider detail/);
});

test('login validation reports a missing email', () => {
  assert.equal(
    validateLoginForm({ email: '', password: 'value' }).email,
    'Enter your email address.'
  );
});

test('login validation reports an invalid email', () => {
  assert.equal(
    validateLoginForm({ email: 'not-an-email', password: 'value' }).email,
    'Enter a valid email address.'
  );
});

test('login validation reports a missing password', () => {
  assert.equal(
    validateLoginForm({ email: 'auditor@example.com', password: '' }).password,
    'Enter your password.'
  );
});

test('login validation accepts a basic valid form without imposing password policy', () => {
  assert.deepEqual(
    validateLoginForm({ email: ' auditor@example.com ', password: 'x' }),
    {}
  );
});

test('account status model defines exactly Active, Locked, and Disabled', () => {
  assert.deepEqual(Object.keys(ACCOUNT_STATUS_DEFINITIONS), [
    ACCOUNT_STATUSES.ACTIVE,
    ACCOUNT_STATUSES.LOCKED,
    ACCOUNT_STATUSES.DISABLED,
  ]);
  assert.match(ACCOUNT_STATUS_DEFINITIONS.LOCKED.message, /Contact an administrator/);
});

test('auth state contract does not retain a user while unauthenticated', () => {
  const state = createAuthState(AUTH_STATUSES.UNAUTHENTICATED, { id: 'ignored' });
  assert.deepEqual(state, { status: AUTH_STATUSES.UNAUTHENTICATED, user: null });
  assert.ok(Object.isFrozen(state));
});

test('access request validation covers required fields and basic email format', () => {
  const errors = validateAccessRequest({
    fullName: '',
    email: 'invalid',
    department: '',
    employeeId: '',
    reason: '',
  });

  assert.deepEqual(errors, {
    fullName: 'Enter your full name.',
    email: 'Enter a valid email address.',
    department: 'Enter your department.',
    reason: 'Explain why you need access.',
  });
});

test('access request validation keeps employee ID optional and limits the reason', () => {
  const valid = validateAccessRequest({
    fullName: 'Casey Morgan',
    email: 'casey@example.com',
    department: 'Internal Audit',
    reason: 'Review assigned transaction alerts.',
  });
  const tooLong = validateAccessRequest({
    fullName: 'Casey Morgan',
    email: 'casey@example.com',
    department: 'Internal Audit',
    reason: 'x'.repeat(ACCESS_REASON_MAX_LENGTH + 1),
  });

  assert.deepEqual(valid, {});
  assert.match(tooLong.reason, /500 characters or fewer/);
});

test('request statuses are centralized and remain separate from account statuses', () => {
  assert.deepEqual(Object.keys(ACCESS_REQUEST_STATUS_DEFINITIONS), [
    ACCESS_REQUEST_STATUSES.PENDING,
    ACCESS_REQUEST_STATUSES.APPROVED,
    ACCESS_REQUEST_STATUSES.REJECTED,
  ]);
  assert.equal(ACCOUNT_STATUSES.LOCKED in ACCESS_REQUEST_STATUS_DEFINITIONS, false);
  assert.equal(ACCESS_REQUEST_STATUSES.PENDING in ACCOUNT_STATUS_DEFINITIONS, false);
});

test('requester inputs do not include role selection or password creation', () => {
  assert.deepEqual(ACCESS_REQUEST_INPUT_FIELDS, [
    'fullName',
    'email',
    'department',
    'employeeId',
    'reason',
  ]);
  assert.equal(ACCESS_REQUEST_INPUT_FIELDS.includes('assignedRole'), false);
  assert.equal(ACCESS_REQUEST_INPUT_FIELDS.includes('password'), false);
  assert.equal(ACCESS_REQUEST_CONTRACT_FIELDS.includes('assignedRole'), true);
});

test('forgot-password validation uses the same neutral email rules', () => {
  assert.equal(validateEmail(''), 'Enter your email address.');
  assert.equal(validateEmail('person@company.test'), null);
});

test('auth service submits access requests without selecting a role', async () => {
  const calls = [];
  const service = createAuthService({ client: { post: async (...args) => { calls.push(args); return { message: 'received' }; } } });
  await service.requestAccess({ fullName: 'Casey Morgan', email: 'casey@example.com', department: 'Audit', reason: 'Review work.' });
  assert.equal(calls[0][0], '/access-requests');
  assert.equal('role' in calls[0][1], false);
});

test('auth service requests a password reset through the backend', async () => {
  const calls = [];
  const service = createAuthService({ client: { post: async (...args) => { calls.push(args); return { message: 'received' }; } } });
  await service.requestPasswordReset('person@example.com');
  assert.deepEqual(calls[0], ['/auth/password-reset', { email: 'person@example.com' }]);
});

test('support configuration safely handles missing contact data', () => {
  assert.deepEqual(getSupportPresentation(), {
    instruction: 'Contact your system administrator.',
    contact: null,
  });
  assert.equal(getSupportPresentation({ contactLabel: 'Help desk' }).contact, null);
});

test('standalone auth route contract contains the complete auth experience', () => {
  assert.deepEqual(STANDALONE_AUTH_PATHS, [
    '/login',
    '/request-access',
    '/forgot-password',
    '/auth/callback',
    '/access-pending',
    '/account-locked',
    '/account-disabled',
    '/session-expired',
    '/support',
    '/privacy-security',
  ]);
  assert.equal(AUTH_ROUTES.LOGIN, '/login');
});

test('user lifecycle ends in active without replacing request or account statuses', () => {
  assert.deepEqual(USER_LIFECYCLE_SEQUENCE, [
    'REQUESTED',
    'PENDING_APPROVAL',
    'APPROVED',
    'ACTIVE',
  ]);
  assert.equal(USER_LIFECYCLE_SEQUENCE.includes(ACCOUNT_STATUSES.LOCKED), false);
  assert.equal(USER_LIFECYCLE_SEQUENCE.includes(ACCESS_REQUEST_STATUSES.REJECTED), false);
});
