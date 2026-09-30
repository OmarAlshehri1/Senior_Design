import { ACCESS_REQUEST_ASSIGNABLE_ROLES, ACCESS_REQUEST_STATUSES } from '../auth/accessRequest.js';

export const ACCESS_REQUEST_ADMIN_FIELDS = Object.freeze([
  'id', 'fullName', 'email', 'department', 'employeeId', 'reason',
  'requestedAt', 'status', 'reviewedAt', 'reviewedBy', 'assignedRole',
]);

export function normalizeAccessRequest(request) {
  if (!request || typeof request !== 'object') return null;
  const normalized = Object.fromEntries(
    ACCESS_REQUEST_ADMIN_FIELDS.map((field) => [field, request[field] ?? null])
  );
  if (normalized.status && !Object.values(ACCESS_REQUEST_STATUSES).includes(normalized.status)) {
    normalized.status = null;
  }
  if (normalized.assignedRole && !ACCESS_REQUEST_ASSIGNABLE_ROLES.includes(normalized.assignedRole)) {
    normalized.assignedRole = null;
  }
  return Object.freeze(normalized);
}

export function normalizeAccessRequests(requests = []) {
  if (!Array.isArray(requests)) return Object.freeze([]);
  return Object.freeze(requests.map(normalizeAccessRequest).filter(Boolean));
}

export function createApprovalModel(values = {}) {
  const assignedRole = ACCESS_REQUEST_ASSIGNABLE_ROLES.includes(values.assignedRole)
    ? values.assignedRole
    : null;
  return Object.freeze({
    assignedRole,
    teamId: values.teamId ?? null,
    valid: Boolean(assignedRole),
  });
}

