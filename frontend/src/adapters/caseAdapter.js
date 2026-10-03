import { normalizeCase, normalizeCaseActivity } from '../cases/caseModel.js';
import { normalizeComments, normalizeEvidenceCollection } from '../cases/caseArtifacts.js';

export function adaptCase(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return normalizeCase({
    ...value,
    reference: value.case_reference ?? (value.case_number ? `CASE-${String(value.case_number).padStart(6, '0')}` : null),
    assignedToId: value.assigned_to ?? value.assigned_to_id,
    assignedToName: value.assigned_to_name,
    createdById: value.created_by,
    createdByName: value.created_by_name,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    slaDueAt: value.sla_due_at,
    slaStatus: value.sla_status,
    slaTargetHours: value.sla_target_hours,
    transactionId: value.transaction_id,
    alertId: value.alert_id,
    department: value.department,
    sourceType: value.source_type,
    sourceId: value.source_id,
    resolutionOutcome: value.resolution_outcome,
    resolution: value.resolution_outcome,
    resolutionNote: value.resolution_note,
    evidenceSummary: value.evidence_summary,
    closureRequestedById: value.closure_requested_by,
    closureRequestedBy: value.closure_requested_by_name ?? value.closure_requested_by,
    closureRequestedAt: value.closure_requested_at,
    closureDecidedBy: value.closure_decided_by_name ?? value.closure_decided_by,
    closedBy: value.closure_decided_by,
    closedAt: value.closed_at,
    completedAt: value.closed_at,
  });
}

export function adaptCaseCollection(value) {
  if (!value || typeof value !== 'object' || !Array.isArray(value.items)) {
    return { items: [], total: 0, page: 1, pageSize: 25 };
  }
  return {
    items: value.items.map(adaptCase).filter(Boolean),
    total: Number.isFinite(value.total) ? value.total : 0,
    page: Number.isFinite(value.page) ? value.page : 1,
    pageSize: Number.isFinite(value.page_size) ? value.page_size : 25,
  };
}

export function adaptCaseBundle(value) {
  if (!value || typeof value !== 'object') return null;
  const record = adaptCase(value.case);
  if (!record) return null;
  return Object.freeze({
    caseRecord: record,
    activity: normalizeCaseActivity(Array.isArray(value.activity) ? value.activity.map(item => ({
      ...item, type: item.action, actorName: item.actor_name, timestamp: item.created_at,
    })) : []),
    comments: normalizeComments(Array.isArray(value.comments) ? value.comments.map(item => ({
      ...item, authorId: item.author_id, authorName: item.author_name, authorRole: item.author_role,
      createdAt: item.created_at,
    })) : []),
    evidence: normalizeEvidenceCollection(Array.isArray(value.evidence) ? value.evidence.map(item => ({
      ...item, caseId: item.case_id, fileName: item.file_name, fileSize: item.file_size,
      mimeType: item.mime_type, uploadedBy: item.uploaded_by, uploadedAt: item.uploaded_at,
      scanStatus: item.scan_status,
    })) : []),
    eligibleUsers: Array.isArray(value.eligible_users) ? value.eligible_users.map(user => Object.freeze({
      id: user.id ?? null, name: user.name ?? null, role: user.role ?? null, teamId: user.team_id ?? null,
    })) : [],
    assignmentHistory: Array.isArray(value.assignment_history) ? value.assignment_history.map(item => Object.freeze({
      ...item, previousAssigneeId: item.previous_assignee_id ?? null, assigneeId: item.assignee_id ?? null,
      actorId: item.actor_id ?? null, actorName: item.actor_name ?? null, actorRole: item.actor_role ?? null,
      assigneeName: item.assignee_name ?? null,
      previousAssigneeName: item.previous_assignee_name ?? null,
      createdAt: item.created_at ?? null,
    })) : [],
  });
}
