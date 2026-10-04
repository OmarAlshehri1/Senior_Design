export const ANALYTICS_PERIODS = Object.freeze(['7_DAYS', '30_DAYS', '90_DAYS']);
export const AUDIT_COVERAGE_RULES = Object.freeze(['Segregation of Duties', 'Approval Limits', 'Duplicate Payments', 'Invoice Splitting', 'Ghost Vendors']);
export function createAuditCoverage(value = null) {
  if (!value) return Object.freeze({ totalTransactions: null, fullyEvaluated: null, partiallyEvaluated: null, notEvaluated: null, coveragePercentage: null, byRule: Object.freeze([]), exclusions: Object.freeze([]) });
  return Object.freeze({
    totalTransactions: value.totalTransactions ?? value.total_transactions ?? null,
    fullyEvaluated: value.fullyEvaluated ?? value.fully_evaluated ?? null,
    partiallyEvaluated: value.partiallyEvaluated ?? value.partially_evaluated ?? null,
    notEvaluated: value.notEvaluated ?? value.not_evaluated ?? null,
    coveragePercentage: value.coveragePercentage ?? value.coverage_percent ?? null,
    byRule: Object.freeze((Array.isArray(value.byRule) ? value.byRule : Array.isArray(value.by_rule) ? value.by_rule : []).map((rule) => Object.freeze({
      ...rule, ruleKey: rule.ruleKey ?? rule.rule_key, ruleName: rule.ruleName ?? rule.rule_name,
      evaluatedTransactions: rule.evaluatedTransactions ?? rule.evaluated_transactions,
      notEvaluatedTransactions: rule.notEvaluatedTransactions ?? rule.not_evaluated_transactions,
      coveragePercentage: rule.coveragePercentage ?? rule.coverage_percent,
    }))),
    exclusions: Object.freeze((Array.isArray(value.exclusions) ? value.exclusions : []).map((item) => Object.freeze({
      ...item, ruleKey: item.ruleKey ?? item.rule_key, transactionCount: item.transactionCount ?? item.transaction_count,
    }))),
  });
}
export function createTrendModel(value = null) {
  return Object.freeze({ period: ANALYTICS_PERIODS.includes(value?.period) ? value.period : '30_DAYS', series: Object.freeze(Array.isArray(value?.series) ? [...value.series] : []) });
}
