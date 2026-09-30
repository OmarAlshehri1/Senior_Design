import { ROLE_KEYS } from './roles.js';

export const ACCESS_REQUEST_STATUSES = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
});

export const ACCESS_REQUEST_STATUS_DEFINITIONS = Object.freeze({
  [ACCESS_REQUEST_STATUSES.PENDING]: Object.freeze({
    key: ACCESS_REQUEST_STATUSES.PENDING,
    displayName: 'Pending',
  }),
  [ACCESS_REQUEST_STATUSES.APPROVED]: Object.freeze({
    key: ACCESS_REQUEST_STATUSES.APPROVED,
    displayName: 'Approved',
  }),
  [ACCESS_REQUEST_STATUSES.REJECTED]: Object.freeze({
    key: ACCESS_REQUEST_STATUSES.REJECTED,
    displayName: 'Rejected',
  }),
});

export const ACCESS_REQUEST_INPUT_FIELDS = Object.freeze([
  'fullName',
  'email',
  'department',
  'employeeId',
  'reason',
]);

export const ACCESS_REQUEST_CONTRACT_FIELDS = Object.freeze([
  'id',
  ...ACCESS_REQUEST_INPUT_FIELDS,
  'status',
  'requestedAt',
  'reviewedAt',
  'reviewedBy',
  'assignedRole',
]);

export const ACCESS_REQUEST_ASSIGNABLE_ROLES = Object.freeze(Object.values(ROLE_KEYS));

// These describe the future administrator boundary only. No operation is
// implemented until a real access-management service exists.
export const ADMIN_ACCESS_RESPONSIBILITIES = Object.freeze([
  'REVIEW_ACCESS_REQUESTS',
  'APPROVE_OR_REJECT_REQUESTS',
  'ASSIGN_ROLES',
  'ACTIVATE_USERS',
  'UNLOCK_USERS',
  'DISABLE_USERS',
]);
