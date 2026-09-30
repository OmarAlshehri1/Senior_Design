export const ANALYTICS_PERIODS = Object.freeze(['7_DAYS', '30_DAYS', '90_DAYS']);
export const AUDIT_COVERAGE_RULES = Object.freeze(['Segregation of Duties', 'Approval Limits', 'Duplicate Payments', 'Invoice Splitting', 'Ghost Vendors']);
export function createAuditCoverage(value = null) {
  if (!value) return Object.freeze({ totalTransactions: null, fullyEvaluated: null, partiallyEvaluated: null, notEvaluated: null, coveragePercentage: null, byRule: Object.freeze([]), exclusions: Object.freeze([]) });
  return Object.freeze({ totalTransactions: value.totalTransactions ?? null, fullyEvaluated: value.fullyEvaluated ?? null, partiallyEvaluated: value.partiallyEvaluated ?? null, notEvaluated: value.notEvaluated ?? null, coveragePercentage: value.coveragePercentage ?? null, byRule: Object.freeze(Array.isArray(value.byRule) ? [...value.byRule] : []), exclusions: Object.freeze(Array.isArray(value.exclusions) ? [...value.exclusions] : []) });
}
export function createTrendModel(value = null) {
  return Object.freeze({ period: ANALYTICS_PERIODS.includes(value?.period) ? value.period : '30_DAYS', series: Object.freeze(Array.isArray(value?.series) ? [...value.series] : []) });
}
