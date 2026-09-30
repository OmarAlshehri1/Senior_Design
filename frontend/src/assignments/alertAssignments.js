export const ASSIGNMENT_STATUSES = Object.freeze({
  ASSIGNED: 'ASSIGNED',
  REASSIGNED: 'REASSIGNED',
  UNASSIGNED: 'UNASSIGNED',
});

export const ALERT_ASSIGNMENT_FIELDS = Object.freeze([
  'id', 'alertId', 'assigneeId', 'assigneeName', 'assignedById',
  'assignedByName', 'assignedAt', 'status',
]);

export function normalizeAlertAssignment(assignment) {
  if (!assignment || typeof assignment !== 'object') return null;
  if (!Object.values(ASSIGNMENT_STATUSES).includes(assignment.status)) return null;
  return Object.freeze(Object.fromEntries(
    ALERT_ASSIGNMENT_FIELDS.map((field) => [field, assignment[field] ?? null])
  ));
}

export function normalizeAssignmentHistory(history = []) {
  if (!Array.isArray(history)) return Object.freeze([]);
  return Object.freeze(history.map(normalizeAlertAssignment).filter(Boolean));
}

