export const CASE_STATUSES = Object.freeze({
  OPEN: 'OPEN',
  INVESTIGATING: 'INVESTIGATING',
  ESCALATED: 'ESCALATED',
  RESOLUTION_REQUESTED: 'RESOLUTION_REQUESTED',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
});

export const CASE_PRIORITIES = Object.freeze({ LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' });

export const CASE_STATUS_META = Object.freeze({
  OPEN: Object.freeze({ label: 'Open', tone: 'blue' }),
  INVESTIGATING: Object.freeze({ label: 'Investigating', tone: 'amber' }),
  ESCALATED: Object.freeze({ label: 'Escalated', tone: 'red' }),
  RESOLUTION_REQUESTED: Object.freeze({ label: 'Resolution Requested', tone: 'purple' }),
  RESOLVED: Object.freeze({ label: 'Resolved', tone: 'green' }),
  CLOSED: Object.freeze({ label: 'Closed', tone: 'slate' }),
});

export const CASE_FIELDS = Object.freeze([
  'id', 'title', 'description', 'status', 'priority', 'riskLevel', 'vendorId', 'vendorName',
  'transactionId', 'alertId', 'assignedToId', 'assignedToName', 'createdById', 'createdByName',
  'createdAt', 'updatedAt', 'slaDueAt', 'slaStatus', 'resolution', 'resolutionNote',
  'evidenceSummary', 'closureRequestedBy', 'closureRequestedAt', 'closedBy', 'closedAt',
]);

export function normalizeCase(value) {
  if (!value || typeof value !== 'object') return null;
  if (!Object.values(CASE_STATUSES).includes(value.status)) return null;
  if (!Object.values(CASE_PRIORITIES).includes(value.priority)) return null;
  return Object.freeze(Object.fromEntries(CASE_FIELDS.map((field) => [field, value[field] ?? null])));
}

export function normalizeCases(values = []) {
  if (!Array.isArray(values)) return Object.freeze([]);
  return Object.freeze(values.map(normalizeCase).filter(Boolean));
}

export const CASES = normalizeCases();

export const CASE_ACTIVITY_TYPES = Object.freeze({
  CREATED: 'CASE_CREATED', ASSIGNED: 'CASE_ASSIGNED', REASSIGNED: 'CASE_REASSIGNED',
  STATUS_CHANGED: 'CASE_STATUS_CHANGED', EVIDENCE_ADDED: 'EVIDENCE_ADDED',
  COMMENT_ADDED: 'CASE_COMMENT_ADDED', ESCALATED: 'CASE_ESCALATED',
  CLOSURE_REQUESTED: 'CASE_CLOSURE_REQUESTED', CLOSURE_REJECTED: 'CASE_CLOSURE_REJECTED',
  CLOSURE_APPROVED: 'CASE_CLOSURE_APPROVED', CLOSED: 'CASE_CLOSED',
});

export function normalizeCaseActivity(values = []) {
  if (!Array.isArray(values)) return Object.freeze([]);
  return Object.freeze(values.filter((item) => item && Object.values(CASE_ACTIVITY_TYPES).includes(item.type)).map((item) => Object.freeze({
    id: item.id ?? null, type: item.type, actorName: item.actorName ?? null,
    timestamp: item.timestamp ?? null, details: item.details ?? null,
  })));
}
