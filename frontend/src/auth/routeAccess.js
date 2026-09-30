import { PERMISSIONS, hasPermission } from './roles.js';
import { STANDALONE_AUTH_PATHS } from './authRoutes.js';

export const APPLICATION_ROUTES = Object.freeze({
  DASHBOARD: '/',
  DASHBOARD_ALIAS: '/dashboard',
  TRANSACTIONS: '/transactions',
  TRANSACTION_DETAIL: '/transactions/:id',
  ALERTS: '/alerts',
  AUDIT_RULES: '/audit-rules',
  REPORTS: '/reports',
  SETTINGS: '/settings',
  PROFILE: '/profile',
  AUDIT_LOG: '/audit-log',
  TEAM_ACTIVITY: '/team-activity',
  USERS: '/users',
  USER_DETAIL: '/users/:userId',
  CASES: '/cases',
  CASE_DETAIL: '/cases/:caseId',
  VENDORS: '/vendors',
  VENDOR_DETAIL: '/vendors/:vendorId',
  FORBIDDEN: '/403',
});

export const APPLICATION_ROUTE_ACCESS = Object.freeze([
  Object.freeze({ key: 'dashboard', path: APPLICATION_ROUTES.DASHBOARD, permission: PERMISSIONS.VIEW_DASHBOARD }),
  Object.freeze({ key: 'dashboard-alias', path: APPLICATION_ROUTES.DASHBOARD_ALIAS, permission: PERMISSIONS.VIEW_DASHBOARD }),
  Object.freeze({ key: 'transactions', path: APPLICATION_ROUTES.TRANSACTIONS, permission: PERMISSIONS.VIEW_TRANSACTIONS }),
  Object.freeze({ key: 'transaction-detail', path: APPLICATION_ROUTES.TRANSACTION_DETAIL, permission: PERMISSIONS.VIEW_TRANSACTIONS }),
  Object.freeze({ key: 'alerts', path: APPLICATION_ROUTES.ALERTS, permission: PERMISSIONS.VIEW_ALERTS }),
  Object.freeze({ key: 'audit-rules', path: APPLICATION_ROUTES.AUDIT_RULES, permission: PERMISSIONS.VIEW_AUDIT_RULES }),
  Object.freeze({ key: 'reports', path: APPLICATION_ROUTES.REPORTS, permission: PERMISSIONS.VIEW_REPORTS }),
  Object.freeze({ key: 'settings', path: APPLICATION_ROUTES.SETTINGS, permission: PERMISSIONS.VIEW_SETTINGS }),
  Object.freeze({ key: 'profile', path: APPLICATION_ROUTES.PROFILE, permission: PERMISSIONS.VIEW_OWN_PROFILE }),
  Object.freeze({ key: 'audit-log', path: APPLICATION_ROUTES.AUDIT_LOG, permission: PERMISSIONS.VIEW_AUDIT_LOG }),
  Object.freeze({ key: 'team-activity', path: APPLICATION_ROUTES.TEAM_ACTIVITY, permission: PERMISSIONS.VIEW_TEAM_ACTIVITY }),
  Object.freeze({ key: 'users', path: APPLICATION_ROUTES.USERS, permission: PERMISSIONS.MANAGE_USERS }),
  Object.freeze({ key: 'user-detail', path: APPLICATION_ROUTES.USER_DETAIL, permission: PERMISSIONS.MANAGE_USERS }),
  Object.freeze({ key: 'cases', path: APPLICATION_ROUTES.CASES, permission: PERMISSIONS.VIEW_CASES }),
  Object.freeze({ key: 'case-detail', path: APPLICATION_ROUTES.CASE_DETAIL, permission: PERMISSIONS.VIEW_CASES }),
  Object.freeze({ key: 'vendors', path: APPLICATION_ROUTES.VENDORS, permission: PERMISSIONS.VIEW_VENDORS }),
  Object.freeze({ key: 'vendor-detail', path: APPLICATION_ROUTES.VENDOR_DETAIL, permission: PERMISSIONS.VIEW_VENDORS }),
]);

export const ROUTE_ACCESS_RESULTS = Object.freeze({
  ALLOWED: 'ALLOWED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  STANDALONE_AUTH: 'STANDALONE_AUTH',
});

function normalizePath(pathname) {
  if (typeof pathname !== 'string') return '';
  const withoutQuery = pathname.split(/[?#]/, 1)[0];
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) return withoutQuery.slice(0, -1);
  return withoutQuery;
}

function matchesPattern(pattern, pathname) {
  const patternParts = pattern.split('/').filter(Boolean);
  const pathParts = pathname.split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return false;
  return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index]);
}

export function getRouteAccess(pathname) {
  const normalizedPath = normalizePath(pathname);
  return APPLICATION_ROUTE_ACCESS.find(({ path }) => matchesPattern(path, normalizedPath)) ?? null;
}

export function getRoutePermission(pathname) {
  return getRouteAccess(pathname)?.permission ?? null;
}

export function resolvePreviewRouteAccess(pathname, role) {
  const normalizedPath = normalizePath(pathname);
  if (STANDALONE_AUTH_PATHS.includes(normalizedPath)) return ROUTE_ACCESS_RESULTS.STANDALONE_AUTH;
  if (normalizedPath === APPLICATION_ROUTES.FORBIDDEN) return ROUTE_ACCESS_RESULTS.ALLOWED;

  const route = getRouteAccess(normalizedPath);
  if (!route) return ROUTE_ACCESS_RESULTS.NOT_FOUND;
  return hasPermission(role, route.permission)
    ? ROUTE_ACCESS_RESULTS.ALLOWED
    : ROUTE_ACCESS_RESULTS.FORBIDDEN;
}
