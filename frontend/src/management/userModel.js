import { ACCOUNT_STATUSES } from '../auth/accountStatus.js';
import { ROLE_KEYS } from '../auth/roles.js';

export const USER_FIELDS = Object.freeze([
  'id', 'name', 'email', 'role', 'accountStatus', 'lastLoginAt',
  'createdAt', 'updatedAt', 'teamId', 'supervisorId',
]);

export function normalizeUser(user) {
  if (!user || typeof user !== 'object') return null;
  const normalized = Object.fromEntries(USER_FIELDS.map((field) => [field, user[field] ?? null]));
  if (normalized.role && !Object.values(ROLE_KEYS).includes(normalized.role)) normalized.role = null;
  if (normalized.accountStatus && !Object.values(ACCOUNT_STATUSES).includes(normalized.accountStatus)) {
    normalized.accountStatus = null;
  }
  return Object.freeze(normalized);
}

export function normalizeUsers(users = []) {
  if (!Array.isArray(users)) return Object.freeze([]);
  return Object.freeze(users.map(normalizeUser).filter(Boolean));
}

export function deriveUserSummary(users = null) {
  if (!Array.isArray(users)) {
    return Object.freeze({ total: null, active: null, locked: null, disabled: null });
  }
  return Object.freeze({
    total: users.length,
    active: users.filter((user) => user.accountStatus === ACCOUNT_STATUSES.ACTIVE).length,
    locked: users.filter((user) => user.accountStatus === ACCOUNT_STATUSES.LOCKED).length,
    disabled: users.filter((user) => user.accountStatus === ACCOUNT_STATUSES.DISABLED).length,
  });
}

