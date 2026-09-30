import { AUDIT_ACTIONS, AUDIT_OUTCOMES, AUDIT_RESOURCE_TYPES } from './auditEvents.js';
import { ROLE_KEYS } from '../auth/roles.js';

export const AUDIT_LOG_SORTS = Object.freeze({
  NEWEST: 'NEWEST',
  OLDEST: 'OLDEST',
});

export const AUDIT_LOG_SCOPES = Object.freeze({
  TEAM: 'TEAM',
  ALL: 'ALL',
});

export const DEFAULT_AUDIT_FILTERS = Object.freeze({
  search: '', actor: '', action: '', resourceType: '', outcome: '', date: '',
});

export const DEFAULT_AUDIT_PAGINATION = Object.freeze({ page: 1, pageSize: 25, total: 0 });

export function getAuditLogScope(role) {
  if (role === ROLE_KEYS.SUPERVISOR) return AUDIT_LOG_SCOPES.TEAM;
  if (role === ROLE_KEYS.ADMIN) return AUDIT_LOG_SCOPES.ALL;
  return null;
}

export function filterAuditEvents(events = [], filters = DEFAULT_AUDIT_FILTERS) {
  if (!Array.isArray(events)) return [];
  const normalized = { ...DEFAULT_AUDIT_FILTERS, ...filters };
  const search = String(normalized.search).trim().toLowerCase();
  const actor = String(normalized.actor).trim().toLowerCase();

  return events.filter((event) => {
    if (!event || typeof event !== 'object') return false;
    if (normalized.action && !Object.values(AUDIT_ACTIONS).includes(normalized.action)) return false;
    if (normalized.action && event.action !== normalized.action) return false;
    if (normalized.resourceType && !Object.values(AUDIT_RESOURCE_TYPES).includes(normalized.resourceType)) return false;
    if (normalized.resourceType && event.resourceType !== normalized.resourceType) return false;
    if (normalized.outcome && !Object.values(AUDIT_OUTCOMES).includes(normalized.outcome)) return false;
    if (normalized.outcome && event.outcome !== normalized.outcome) return false;
    if (normalized.date && !String(event.timestamp ?? '').startsWith(normalized.date)) return false;
    if (actor && !String(event.actorName ?? '').toLowerCase().includes(actor)) return false;
    if (!search) return true;
    return [event.actorName, event.action, event.resourceType, event.resourceId, event.details]
      .some((value) => String(value ?? '').toLowerCase().includes(search));
  });
}

export function sortAuditEvents(events = [], sort = AUDIT_LOG_SORTS.NEWEST) {
  const direction = sort === AUDIT_LOG_SORTS.OLDEST ? 1 : -1;
  return [...(Array.isArray(events) ? events : [])].sort((a, b) => {
    const left = Date.parse(a?.timestamp ?? '') || 0;
    const right = Date.parse(b?.timestamp ?? '') || 0;
    return (left - right) * direction;
  });
}

export function deriveAuditLogView(events = [], filters = DEFAULT_AUDIT_FILTERS, sort = AUDIT_LOG_SORTS.NEWEST) {
  return sortAuditEvents(filterAuditEvents(events, filters), sort);
}
