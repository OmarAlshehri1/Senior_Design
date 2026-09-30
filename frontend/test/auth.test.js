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
import { authService } from '../src/auth/authService.js';
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

test('auth service never fabricates successful authentication', async () => {
  await assert.rejects(
    authService.signIn('auditor@example.com', 'not-persisted'),
    (error) => error instanceof AuthError && error.code === AUTH_ERROR_CODES.AUTH_UNAVAILABLE
  );
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

test('auth service does not fabricate access-request submission', async () => {
  await assert.rejects(
    authService.requestAccess({ fullName: 'Not persisted' }),
    (error) => error instanceof AuthError
      && error.code === AUTH_ERROR_CODES.ACCESS_REQUESTS_UNAVAILABLE
      && error.message === 'Access requests are not available yet.'
  );
});

test('auth service does not fabricate password-reset success', async () => {
  await assert.rejects(
    authService.requestPasswordReset('person@example.com'),
    (error) => error instanceof AuthError
      && error.code === AUTH_ERROR_CODES.PASSWORD_RESET_UNAVAILABLE
      && error.message === 'Password reset is not available yet.'
  );
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
    '/access-pending',
    '/account-locked',
    '/account-disabled',
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
