export const AUTH_STATUSES = Object.freeze({
  UNKNOWN: 'unknown',
  UNAUTHENTICATED: 'unauthenticated',
  AUTHENTICATED: 'authenticated',
});

/**
 * Future authenticated user contract.
 * @typedef {object} AuthUser
 * @property {string} id
 * @property {string} name
 * @property {string} email
 * @property {'AUDITOR'|'SUPERVISOR'|'ADMIN'} role
 * @property {'ACTIVE'|'LOCKED'|'DISABLED'} accountStatus
 * @property {string|null} lastLoginAt
 */

export function createAuthState(status = AUTH_STATUSES.UNKNOWN, user = null) {
  const knownStatus = Object.values(AUTH_STATUSES).includes(status)
    ? status
    : AUTH_STATUSES.UNKNOWN;

  return Object.freeze({
    status: knownStatus,
    user: knownStatus === AUTH_STATUSES.AUTHENTICATED ? user : null,
  });
}

export const INITIAL_AUTH_STATE = createAuthState();
