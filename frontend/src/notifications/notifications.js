import { ROLE_KEYS } from '../auth/roles.js';

export const NOTIFICATION_TYPES = Object.freeze({
  HIGH_RISK_ALERT: 'HIGH_RISK_ALERT',
  ALERT_ASSIGNED: 'ALERT_ASSIGNED',
  ALERT_REASSIGNED: 'ALERT_REASSIGNED',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED',
  ACCESS_REQUEST_APPROVED: 'ACCESS_REQUEST_APPROVED',
  ACCESS_REQUEST_REJECTED: 'ACCESS_REQUEST_REJECTED',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  SECURITY_ALERT: 'SECURITY_ALERT',
  SYSTEM_NOTICE: 'SYSTEM_NOTICE',
});

export const NOTIFICATION_PRIORITIES = Object.freeze({
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
});

export const NOTIFICATION_FIELDS = Object.freeze([
  'id', 'type', 'title', 'message', 'timestamp', 'readAt',
  'resourceType', 'resourceId', 'priority',
]);

export const NOTIFICATION_CATEGORIES = Object.freeze({
  AUDIT_WORK: Object.freeze({ types: Object.freeze([
    NOTIFICATION_TYPES.HIGH_RISK_ALERT,
    NOTIFICATION_TYPES.ALERT_ASSIGNED,
    NOTIFICATION_TYPES.ALERT_REASSIGNED,
    NOTIFICATION_TYPES.REVIEW_REQUIRED,
  ]) }),
  ACCESS: Object.freeze({ types: Object.freeze([
    NOTIFICATION_TYPES.ACCESS_REQUEST_APPROVED,
    NOTIFICATION_TYPES.ACCESS_REQUEST_REJECTED,
  ]) }),
  SECURITY: Object.freeze({ types: Object.freeze([
    NOTIFICATION_TYPES.ACCOUNT_LOCKED,
    NOTIFICATION_TYPES.ACCOUNT_UNLOCKED,
    NOTIFICATION_TYPES.SECURITY_ALERT,
  ]) }),
  SYSTEM: Object.freeze({ types: Object.freeze([NOTIFICATION_TYPES.SYSTEM_NOTICE]) }),
});

// Relevance metadata prepares future subscriptions; authorization and delivery
// scope remain responsibilities of the server.
export const NOTIFICATION_ROLE_RELEVANCE = Object.freeze({
  [ROLE_KEYS.AUDITOR]: Object.freeze([
    NOTIFICATION_TYPES.ALERT_ASSIGNED,
    NOTIFICATION_TYPES.REVIEW_REQUIRED,
    NOTIFICATION_TYPES.HIGH_RISK_ALERT,
  ]),
  [ROLE_KEYS.SUPERVISOR]: Object.freeze([
    NOTIFICATION_TYPES.ALERT_ASSIGNED,
    NOTIFICATION_TYPES.ALERT_REASSIGNED,
    NOTIFICATION_TYPES.HIGH_RISK_ALERT,
    NOTIFICATION_TYPES.REVIEW_REQUIRED,
  ]),
  [ROLE_KEYS.ADMIN]: Object.freeze([
    NOTIFICATION_TYPES.ACCESS_REQUEST_APPROVED,
    NOTIFICATION_TYPES.ACCESS_REQUEST_REJECTED,
    NOTIFICATION_TYPES.ACCOUNT_LOCKED,
    NOTIFICATION_TYPES.ACCOUNT_UNLOCKED,
    NOTIFICATION_TYPES.SECURITY_ALERT,
    NOTIFICATION_TYPES.SYSTEM_NOTICE,
  ]),
});

export function normalizeNotification(notification) {
  if (!notification || typeof notification !== 'object') return null;
  if (!Object.values(NOTIFICATION_TYPES).includes(notification.type)) return null;
  if (!Object.values(NOTIFICATION_PRIORITIES).includes(notification.priority)) return null;
  return Object.freeze(Object.fromEntries(
    NOTIFICATION_FIELDS.map((field) => [field, notification[field] ?? null])
  ));
}

export function normalizeNotifications(notifications = []) {
  if (!Array.isArray(notifications)) return Object.freeze([]);
  return Object.freeze(notifications.map(normalizeNotification).filter(Boolean));
}

export function isNotificationUnread(notification) {
  return Boolean(notification) && notification.readAt === null;
}

export function getUnreadNotificationCount(notifications = []) {
  if (!Array.isArray(notifications)) return 0;
  return notifications.filter(isNotificationUnread).length;
}
