export const ROLE_KEYS = Object.freeze({
  AUDITOR: 'AUDITOR',
  SUPERVISOR: 'SUPERVISOR',
  ADMIN: 'ADMIN',
});

export const PERMISSIONS = Object.freeze({
  VIEW_DASHBOARD: 'VIEW_DASHBOARD',
  VIEW_TRANSACTIONS: 'VIEW_TRANSACTIONS',
  REVIEW_TRANSACTIONS: 'REVIEW_TRANSACTIONS',
  VIEW_ALERTS: 'VIEW_ALERTS',
  REVIEW_ALERTS: 'REVIEW_ALERTS',
  VIEW_AUDIT_RULES: 'VIEW_AUDIT_RULES',
  VIEW_REPORTS: 'VIEW_REPORTS',
  VIEW_TEAM_ACTIVITY: 'VIEW_TEAM_ACTIVITY',
  ASSIGN_ALERTS: 'ASSIGN_ALERTS',
  VIEW_AUDIT_LOG: 'VIEW_AUDIT_LOG',
  MANAGE_USERS: 'MANAGE_USERS',
  UNLOCK_USERS: 'UNLOCK_USERS',
  CHANGE_USER_ROLES: 'CHANGE_USER_ROLES',
  VIEW_SETTINGS: 'VIEW_SETTINGS',
  MANAGE_SETTINGS: 'MANAGE_SETTINGS',
  VIEW_OWN_PROFILE: 'VIEW_OWN_PROFILE',
});

const auditorPermissions = Object.freeze([
  PERMISSIONS.VIEW_DASHBOARD,
  PERMISSIONS.VIEW_TRANSACTIONS,
  PERMISSIONS.REVIEW_TRANSACTIONS,
  PERMISSIONS.VIEW_ALERTS,
  PERMISSIONS.REVIEW_ALERTS,
  PERMISSIONS.VIEW_AUDIT_RULES,
  PERMISSIONS.VIEW_OWN_PROFILE,
]);

const supervisorPermissions = Object.freeze([
  ...auditorPermissions,
  PERMISSIONS.VIEW_REPORTS,
  PERMISSIONS.VIEW_TEAM_ACTIVITY,
  PERMISSIONS.ASSIGN_ALERTS,
  PERMISSIONS.VIEW_AUDIT_LOG,
]);

export const ROLE_DEFINITIONS = Object.freeze({
  [ROLE_KEYS.AUDITOR]: Object.freeze({
    key: ROLE_KEYS.AUDITOR,
    displayName: 'Auditor',
    description: 'Reviews transactions, alerts, and audit-rule findings.',
  }),
  [ROLE_KEYS.SUPERVISOR]: Object.freeze({
    key: ROLE_KEYS.SUPERVISOR,
    displayName: 'Supervisor',
    description: 'Oversees audit work, reporting, assignments, and team activity.',
  }),
  [ROLE_KEYS.ADMIN]: Object.freeze({
    key: ROLE_KEYS.ADMIN,
    displayName: 'Administrator',
    description: 'Manages system access, users, roles, and configuration.',
  }),
});

export const ROLE_PERMISSION_MAP = Object.freeze({
  [ROLE_KEYS.AUDITOR]: auditorPermissions,
  [ROLE_KEYS.SUPERVISOR]: supervisorPermissions,
  [ROLE_KEYS.ADMIN]: Object.freeze(Object.values(PERMISSIONS)),
});

export function getRoleDefinition(role) {
  return ROLE_DEFINITIONS[role] ?? null;
}

export function getPermissionsForRole(role) {
  return [...(ROLE_PERMISSION_MAP[role] ?? [])];
}

export function hasPermission(role, permission) {
  return ROLE_PERMISSION_MAP[role]?.includes(permission) ?? false;
}
