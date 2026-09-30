import { AUDIT_OUTCOMES } from './auditEvents.js';

export const LOGIN_HISTORY_FIELDS = Object.freeze([
  'id', 'userId', 'timestamp', 'outcome', 'context',
]);

const LOGIN_OUTCOMES = Object.freeze([
  AUDIT_OUTCOMES.SUCCESS,
  AUDIT_OUTCOMES.FAILED,
]);

export function normalizeLoginHistoryRecord(record) {
  if (!record || typeof record !== 'object' || !LOGIN_OUTCOMES.includes(record.outcome)) return null;
  return Object.freeze({
    id: record.id ?? null,
    userId: record.userId ?? null,
    timestamp: record.timestamp ?? null,
    outcome: record.outcome,
    context: record.context && typeof record.context === 'object'
      ? Object.freeze({ ...record.context })
      : null,
  });
}

export function normalizeLoginHistory(records = []) {
  if (!Array.isArray(records)) return Object.freeze([]);
  return Object.freeze(records.map(normalizeLoginHistoryRecord).filter(Boolean));
}

export function createSecurityActivity(records = []) {
  return Object.freeze({
    lastLoginAt: null,
    failedSignInAttempts: null,
    accountStatus: null,
    recentSignIns: normalizeLoginHistory(records),
  });
}
