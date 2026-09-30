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
  CASE_CREATED: 'CASE_CREATED',
  CASE_ASSIGNED: 'CASE_ASSIGNED',
  CASE_ESCALATED: 'CASE_ESCALATED',
  CASE_CLOSURE_REQUESTED: 'CASE_CLOSURE_REQUESTED',
  CASE_CLOSED: 'CASE_CLOSED',
  EVIDENCE_ADDED: 'EVIDENCE_ADDED',
  CASE_COMMENT_ADDED: 'CASE_COMMENT_ADDED',
  VENDOR_WATCHLIST_REQUESTED: 'VENDOR_WATCHLIST_REQUESTED',
  VENDOR_WATCHLIST_APPROVED: 'VENDOR_WATCHLIST_APPROVED',
  VENDOR_BLOCKED: 'VENDOR_BLOCKED',
  VENDOR_UNBLOCKED: 'VENDOR_UNBLOCKED',
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
  CASE: 'CASE',
  VENDOR: 'VENDOR',
  EVIDENCE: 'EVIDENCE',
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
