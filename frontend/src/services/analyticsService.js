import { unavailableOperation } from './unavailableService.js';

const unavailable = unavailableOperation('Audit analytics');
export const analyticsService = Object.freeze({
  getAuditCoverage: unavailable, getAuditCoverageByRule: unavailable,
  getRiskTrends: unavailable, getRuleViolationTrends: unavailable,
});
