import { ROLE_DEFINITIONS, ROLE_KEYS } from './roles.js';

const WORKSPACE_DEFINITIONS = Object.freeze({
  [ROLE_KEYS.AUDITOR]: Object.freeze({
    role: ROLE_KEYS.AUDITOR,
    roleLabel: ROLE_DEFINITIONS[ROLE_KEYS.AUDITOR].displayName,
    contextLabel: 'Auditor Workspace',
    metricDefinitions: Object.freeze([
      Object.freeze({ key: 'assignedAlerts', label: 'My Assigned Alerts', description: 'Assignment data is not available yet.', to: '/alerts' }),
      Object.freeze({ key: 'transactionsNeedingReview', label: 'Transactions Needing Review', description: 'Current transactions marked for review.' }),
      Object.freeze({ key: 'reviewsToday', label: 'My Reviews Today', description: 'Review attribution is not available yet.' }),
    ]),
    sections: Object.freeze([
      Object.freeze({ key: 'workQueue', title: 'My Work Queue', emptyMessage: 'Assignment data is not available yet.' }),
      Object.freeze({ key: 'recentReviewActivity', title: 'Recent Review Activity', source: 'REVIEW_HISTORY', emptyMessage: 'Review activity is not available yet.' }),
    ]),
  }),
  [ROLE_KEYS.SUPERVISOR]: Object.freeze({
    role: ROLE_KEYS.SUPERVISOR,
    roleLabel: ROLE_DEFINITIONS[ROLE_KEYS.SUPERVISOR].displayName,
    contextLabel: 'Supervisor Workspace',
    metricDefinitions: Object.freeze([
      Object.freeze({ key: 'activeTeamAlerts', label: 'Active Team Alerts', description: 'Team relationships are not available yet.', to: '/team-activity' }),
      Object.freeze({ key: 'unassignedAlerts', label: 'Unassigned Alerts', description: 'Assignment data is not available yet.', to: '/team-activity' }),
      Object.freeze({ key: 'teamReviewsToday', label: 'Team Reviews Today', description: 'Team activity is not available yet.' }),
    ]),
    sections: Object.freeze([
      Object.freeze({ key: 'teamWorkload', title: 'Team Workload', to: '/team-activity', emptyMessage: 'Team workload is not available yet.' }),
      Object.freeze({ key: 'recentTeamActivity', title: 'Recent Team Activity', to: '/team-activity', source: 'AUDIT_EVENTS', emptyMessage: 'Team activity is not available yet.' }),
    ]),
  }),
  [ROLE_KEYS.ADMIN]: Object.freeze({
    role: ROLE_KEYS.ADMIN,
    roleLabel: ROLE_DEFINITIONS[ROLE_KEYS.ADMIN].displayName,
    contextLabel: 'Administrator Workspace',
    metricDefinitions: Object.freeze([
      Object.freeze({ key: 'activeUsers', label: 'Active Users', description: 'Identity metrics are not available yet.', to: '/users' }),
      Object.freeze({ key: 'lockedAccounts', label: 'Locked Accounts', description: 'Account security data is not available yet.', to: '/users' }),
      Object.freeze({ key: 'failedLoginsToday', label: 'Failed Logins Today', description: 'Sign-in activity is not available yet.' }),
    ]),
    sections: Object.freeze([
      Object.freeze({ key: 'systemActivity', title: 'System Activity', source: 'AUDIT_EVENTS', emptyMessage: 'Security activity is not available yet.' }),
      Object.freeze({ key: 'recentAuditLog', title: 'Recent Audit Log', to: '/audit-log', source: 'AUDIT_EVENTS', emptyMessage: 'Audit log activity is not available yet.' }),
    ]),
  }),
});

export const NEUTRAL_WORKSPACE = Object.freeze({
  role: null,
  roleLabel: null,
  contextLabel: null,
  metrics: Object.freeze([]),
  sections: Object.freeze([]),
  message: 'Personal work queues will appear when identity and access information is available.',
});

export function getWorkspaceDefinition(role) {
  return WORKSPACE_DEFINITIONS[role] ?? null;
}

export function deriveWorkspaceData(role, { transactions = [] } = {}) {
  const definition = getWorkspaceDefinition(role);
  if (!definition) return NEUTRAL_WORKSPACE;

  const values = role === ROLE_KEYS.AUDITOR
    ? { transactionsNeedingReview: transactions.filter((item) => item?.ruleStatus === 'Review').length }
    : {};

  const metrics = definition.metricDefinitions.map(({ key, label, description, to }) => (
    Object.freeze({ key, label, value: values[key] ?? null, description, to: to ?? null })
  ));
  const sections = definition.sections.map((section) => Object.freeze({
    ...section,
    items: Object.freeze([]),
  }));

  return Object.freeze({
    role: definition.role,
    roleLabel: definition.roleLabel,
    contextLabel: definition.contextLabel,
    metrics: Object.freeze(metrics),
    sections: Object.freeze(sections),
    message: null,
  });
}

export const WORKSPACE_DEFINITIONS_BY_ROLE = WORKSPACE_DEFINITIONS;
