// Display only. Never use these references as API parameters or routing keys.
export function caseReference(value) {
  if (typeof value !== 'string') return '—';
  const match = /^CASE-(\d+)$/.exec(value);
  return match ? `Case #${match[1].replace(/^0+(?=\d)/, '')}` : shortReference(value);
}

// Generated payment IDs (PAY- + hex digest) display as TR- + the first eight hex
// characters. Deterministic; the stored ID stays the key everywhere else.
const GENERATED_TRANSACTION_ID = /^PAY-([0-9a-f]{16,})$/i;

export function transactionReference(value) {
  if (typeof value !== 'string' || !value) return '—';
  const match = GENERATED_TRANSACTION_ID.exec(value);
  return match ? `TR-${match[1].slice(0, 8).toUpperCase()}` : value;
}

export function shortReference(value) {
  if (typeof value !== 'string' || !value) return '—';
  if (GENERATED_TRANSACTION_ID.test(value)) return transactionReference(value);
  if (value.length <= 22) return value;
  return `${value.slice(0, value.startsWith('AL-') ? 7 : 8)}…${value.slice(-4)}`;
}

const actions = {
  BUSINESS_REPORT_CREATED: 'Created business report', ALERT_ASSIGNED: 'Assigned alert',
  ALERT_REASSIGNED: 'Reassigned alert', ALERT_REVIEWED: 'Reviewed alert', ALERT_REOPENED: 'Reopened alert',
  TEAM_MEMBER_ADDED: 'Added team member', TEAM_MEMBER_REMOVED: 'Removed team member',
  TEAM_MEMBER_TRANSFERRED: 'Transferred team member', TEAM_CREATED: 'Created team', TEAM_UPDATED: 'Updated team',
  TEAM_DEACTIVATED: 'Deactivated team',
  LOGIN_SUCCESS: 'Signed in', LOGIN_FAILED: 'Sign-in failed', LOGOUT: 'Signed out',
  ACCOUNT_LOCKED: 'Locked account', ACCOUNT_UNLOCKED: 'Unlocked account',
  ACCOUNT_DISABLED: 'Disabled account', ACCOUNT_ENABLED: 'Enabled account',
  ACCOUNT_UNLOCK_REJECTED: 'Rejected account unlock', TRANSACTION_REVIEWED: 'Reviewed transaction',
  TRANSACTION_REOPENED: 'Reopened transaction', REVIEW_NOTE_ADDED: 'Added review note',
  ACCESS_REQUEST_APPROVED: 'Approved access request', ACCESS_REQUEST_REJECTED: 'Rejected access request',
  USER_ROLE_CHANGED: 'Changed user role', CASE_CREATED: 'Created case', CASE_ASSIGNED: 'Assigned case',
  CASE_REASSIGNED: 'Reassigned case', CASE_STATUS_CHANGED: 'Changed case status', CASE_ESCALATED: 'Escalated case',
  CASE_CLOSURE_REQUESTED: 'Requested case closure', CASE_CLOSURE_APPROVED: 'Approved case closure',
  CASE_CLOSURE_REJECTED: 'Rejected case closure', CASE_CLOSED: 'Closed case',
  EVIDENCE_ADDED: 'Added evidence', EVIDENCE_REJECTED: 'Rejected evidence', CASE_COMMENT_ADDED: 'Commented on case',
  SLA_OVERDUE: 'Review overdue', ORGANIZATION_SETTINGS_UPDATED: 'Updated organization settings',
};
export function eventLabel(code) {
  if (!code) return 'Activity';
  return actions[code] ?? String(code).toLowerCase().replaceAll('_', ' ').replace(/^./, (letter) => letter.toUpperCase());
}
export function resourceLabel(type, id) {
  const kind = type ? eventLabel(type) : 'Record';
  if (!id) return kind;
  return type === 'CASE' ? caseReference(id) : `${kind} ${shortReference(id)}`;
}
