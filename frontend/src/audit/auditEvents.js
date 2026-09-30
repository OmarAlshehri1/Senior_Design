export const AUDIT_ACTIONS = Object.freeze({
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  ACCOUNT_ENABLED: 'ACCOUNT_ENABLED',
  TRANSACTION_REVIEWED: 'TRANSACTION_REVIEWED',
  TRANSACTION_REOPENED: 'TRANSACTION_REOPENED',
  REVIEW_NOTE_ADDED: 'REVIEW_NOTE_ADDED',
  ALERT_REVIEWED: 'ALERT_REVIEWED',
  ALERT_ASSIGNED: 'ALERT_ASSIGNED',
  ALERT_REASSIGNED: 'ALERT_REASSIGNED',
  ACCESS_REQUEST_APPROVED: 'ACCESS_REQUEST_APPROVED',
  ACCESS_REQUEST_REJECTED: 'ACCESS_REQUEST_REJECTED',
  USER_ROLE_CHANGED: 'USER_ROLE_CHANGED',
});

export const AUDIT_OUTCOMES = Object.freeze({
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  DENIED: 'DENIED',
});

export const AUDIT_RESOURCE_TYPES = Object.freeze({
  ACCOUNT: 'ACCOUNT',
  TRANSACTION: 'TRANSACTION',
  ALERT: 'ALERT',
  ACCESS_REQUEST: 'ACCESS_REQUEST',
  USER: 'USER',
});

export const AUDIT_EVENT_FIELDS = Object.freeze([
  'id', 'actorId', 'actorName', 'actorRole', 'action', 'resourceType',
  'resourceId', 'timestamp', 'outcome', 'details',
]);

export function normalizeAuditEvent(event) {
  if (!event || typeof event !== 'object') return null;
  if (!Object.values(AUDIT_ACTIONS).includes(event.action)) return null;
  if (!Object.values(AUDIT_OUTCOMES).includes(event.outcome)) return null;
  if (!Object.values(AUDIT_RESOURCE_TYPES).includes(event.resourceType)) return null;

  const normalized = Object.fromEntries(
    AUDIT_EVENT_FIELDS.map((field) => [field, event[field] ?? null])
  );
  if (normalized.details && typeof normalized.details === 'object') {
    normalized.details = Object.freeze({ ...normalized.details });
  }
  return Object.freeze(normalized);
}
