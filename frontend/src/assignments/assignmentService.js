import { apiClient } from '../services/apiClient.js';

const base = (id) => `/alerts/${encodeURIComponent(id)}/assignment`;

export function createAssignmentService(client = apiClient) {
  return Object.freeze({
  assignAlert: (alertId, assigneeId, note = null) => client.post(base(alertId), { action: 'ASSIGNED', assignee_id: assigneeId, note }),
  reassignAlert: (alertId, assigneeId, note = null) => client.post(base(alertId), { action: 'REASSIGNED', assignee_id: assigneeId, note }),
  unassignAlert: (alertId, note = null) => client.post(base(alertId), { action: 'UNASSIGNED', note }),
  getAlertAssignmentHistory: async (alertId) => {
    const data = await client.get(base(alertId));
    return {
      assignment: data.assignment ? { ...data.assignment, assigneeName: data.assignment.assigneeName ?? data.assignment.assignee_name } : null,
      history: (data.history ?? []).map((record) => ({
        ...record, assigneeName: record.assigneeName ?? record.assignee_name,
        assignedByName: record.assignedByName ?? record.assigned_by_name,
        assignedAt: record.assignedAt ?? record.createdAt ?? record.created_at,
      })),
      eligibleUsers: data.eligible_users ?? [],
    };
  },
  });
}

export const assignmentService = createAssignmentService();

