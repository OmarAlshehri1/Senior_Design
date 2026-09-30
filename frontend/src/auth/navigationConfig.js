import { APPLICATION_ROUTES, getRoutePermission } from './routeAccess.js';
import { hasPermission } from './roles.js';

export const NAVIGATION_GROUPS = Object.freeze([
  Object.freeze({
    label: 'Monitoring',
    links: Object.freeze([
      Object.freeze({ to: APPLICATION_ROUTES.DASHBOARD, label: 'Dashboard', icon: 'dashboard', end: true, permission: getRoutePermission(APPLICATION_ROUTES.DASHBOARD) }),
      Object.freeze({ to: APPLICATION_ROUTES.TRANSACTIONS, label: 'Transactions', icon: 'transactions', permission: getRoutePermission(APPLICATION_ROUTES.TRANSACTIONS) }),
      Object.freeze({ to: APPLICATION_ROUTES.ALERTS, label: 'Alerts', icon: 'alerts', permission: getRoutePermission(APPLICATION_ROUTES.ALERTS) }),
      Object.freeze({ to: APPLICATION_ROUTES.VENDORS, label: 'Vendors', icon: 'vendors', permission: getRoutePermission(APPLICATION_ROUTES.VENDORS) }),
    ]),
  }),
  Object.freeze({
    label: 'Auditing',
    links: Object.freeze([
      Object.freeze({ to: APPLICATION_ROUTES.AUDIT_RULES, label: 'Audit Rules', icon: 'audit-rules', permission: getRoutePermission(APPLICATION_ROUTES.AUDIT_RULES) }),
      Object.freeze({ to: APPLICATION_ROUTES.REPORTS, label: 'Reports', icon: 'reports', permission: getRoutePermission(APPLICATION_ROUTES.REPORTS) }),
    ]),
  }),
  Object.freeze({
    label: 'Management',
    links: Object.freeze([
      Object.freeze({ to: APPLICATION_ROUTES.CASES, label: 'Cases', icon: 'cases', permission: getRoutePermission(APPLICATION_ROUTES.CASES) }),
      Object.freeze({ to: APPLICATION_ROUTES.TEAM_ACTIVITY, label: 'Team Activity', icon: 'team-activity', permission: getRoutePermission(APPLICATION_ROUTES.TEAM_ACTIVITY) }),
      Object.freeze({ to: APPLICATION_ROUTES.USERS, label: 'User Management', icon: 'user-management', permission: getRoutePermission(APPLICATION_ROUTES.USERS) }),
      Object.freeze({ to: APPLICATION_ROUTES.AUDIT_LOG, label: 'Audit Log', icon: 'audit-log', permission: getRoutePermission(APPLICATION_ROUTES.AUDIT_LOG) }),
    ]),
  }),
  Object.freeze({
    label: 'System',
    links: Object.freeze([
      Object.freeze({ to: APPLICATION_ROUTES.SETTINGS, label: 'Settings', icon: 'settings', permission: getRoutePermission(APPLICATION_ROUTES.SETTINGS) }),
    ]),
  }),
]);

export function getNavigationState(role) {
  return NAVIGATION_GROUPS.map((group) => ({
    ...group,
    links: group.links.map((link) => ({
      ...link,
      restricted: role ? !hasPermission(role, link.permission) : false,
    })),
  }));
}
