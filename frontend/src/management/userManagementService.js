import { apiClient } from '../services/apiClient.js';
import { normalizeUser, normalizeUsers } from './userModel.js';

function adaptAccessRequest(value) {
  if (!value || typeof value !== 'object') return null;
  return Object.freeze({
    id: value.id ?? null,
    fullName: value.full_name ?? null,
    email: value.email ?? null,
    department: value.department ?? null,
    employeeId: value.employee_id ?? null,
    reason: value.reason ?? null,
    status: value.status ?? null,
    assignedRole: value.assigned_role ?? null,
    requestedAt: value.requested_at ?? null,
    reviewedAt: value.decided_at ?? null,
    reviewedBy: value.decided_by ?? null,
    decisionReason: value.decision_reason ?? null,
  });
}

export function createUserManagementService(client = apiClient) {
  const action = (userId, type, role) => client.patch(`/users/${encodeURIComponent(userId)}`, { action: type, ...(role ? { role } : {}) });
  return Object.freeze({
    async listUsers(options = {}) {
      const page = await client.get('/users', options);
      return Object.freeze({ ...page, items: normalizeUsers(page?.items) });
    },
    async getUser(userId, options = {}) {
      return normalizeUser(await client.get(`/users/${encodeURIComponent(userId)}`, options));
    },
    async listLoginHistory(userId, options = {}) {
      const page = await client.get(`/users/${encodeURIComponent(userId)}/login-history`, options);
      return page;
    },
    async listAccessRequests(options = {}) {
      const page = await client.get('/access-requests', options);
      return Object.freeze({ ...page, items: Object.freeze((page?.items ?? []).map(adaptAccessRequest).filter(Boolean)) });
    },
    async listUnlockRequests(options = {}) {
      return client.get('/account-unlock-requests', options);
    },
    async decideUnlockRequest(requestId, decision) {
      return client.post(`/account-unlock-requests/${encodeURIComponent(requestId)}/decision`, decision);
    },
    async decideAccessRequest(requestId, decision) {
      return adaptAccessRequest(await client.post(`/access-requests/${encodeURIComponent(requestId)}/decision`, decision));
    },
    async approveAccessRequest(requestId, role, reason = null) {
      return this.decideAccessRequest(requestId, { approve: true, role, reason });
    },
    async rejectAccessRequest(requestId, reason = null) {
      return this.decideAccessRequest(requestId, { approve: false, reason });
    },
    async changeUserRole(userId, role) {
      return normalizeUser(await action(userId, 'role', role));
    },
    async disableUser(userId) { return normalizeUser(await action(userId, 'disable')); },
    async enableUser(userId) { return normalizeUser(await action(userId, 'enable')); },
  });
}

export const userManagementService = createUserManagementService();
