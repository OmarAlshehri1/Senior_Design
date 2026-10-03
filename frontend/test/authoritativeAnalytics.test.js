import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptAuditRule, adaptAuditRuleCollection } from '../src/adapters/auditRuleAdapter.js';
import { createAuditCoverage, createTrendModel } from '../src/analytics/analyticsModels.js';
import { createAnalyticsService } from '../src/services/analyticsService.js';
import { adaptDashboardSummary, createDashboardService } from '../src/services/dashboardService.js';
import { createAuditRulesService } from '../src/services/auditRulesService.js';

test('dashboard summary adapter preserves authoritative counts and normalizes risk distribution', () => {
  const result = adaptDashboardSummary({
    total_transactions: 12, transactions_evaluated: 10, low_risk_transactions: 3,
    medium_risk_transactions: 4, high_risk_transactions: 3, average_risk_score: 61.25,
    active_alerts: 2, generated_at: '2026-10-03T10:00:00Z',
  });
  assert.deepEqual(result.riskOverview, { low: 30, medium: 40, high: 30 });
  assert.equal(result.summary.totalTransactions, 12);
  assert.equal(result.summary.transactionsEvaluated, 10);
  assert.equal(adaptDashboardSummary({}).summary.averageRiskScore, 0);
  assert.deepEqual(adaptDashboardSummary({}).riskOverview, { low: 0, medium: 0, high: 0 });
});

test('dashboard service requests only the authoritative summary endpoint', async () => {
  const calls = [];
  const service = createDashboardService({ get: async (path) => { calls.push(path); return { total_transactions: 1, high_risk_transactions: 1 }; } });
  assert.equal((await service.getSummary()).riskOverview.high, 100);
  assert.deepEqual(calls, ['/dashboard/summary']);
});

test('audit-rule adapter maps backend keys, required fields, and versions to UI metadata', () => {
  const rule = adaptAuditRule({ key: 'approval_limits', name: 'Approval Limits', required_fields: ['amount'], required_any_of: [['approved_by', 'created_by']], enabled: true, version: '2.1.0' });
  assert.equal(rule.key, 'approvalLimit');
  assert.deepEqual(rule.requiredFields, ['Transaction Amount', 'Approver ID or Creator ID']);
  assert.equal(rule.version, '2.1.0');
  assert.equal(adaptAuditRule({ key: 3 }), null);
  assert.equal(adaptAuditRuleCollection({ items: [{ key: 'ghost_vendors' }, null] }).length, 1);
});

test('audit rules service loads backend definitions through the API client', async () => {
  const calls = [];
  const service = createAuditRulesService({ get: async (path) => { calls.push(path); return { items: [{ key: 'ghost_vendors', enabled: true }] }; } });
  assert.equal((await service.list())[0].key, 'ghostVendor');
  assert.deepEqual(calls, ['/audit-rules']);
});

test('analytics service adapts authoritative coverage and trend payloads for each selected period', async () => {
  const calls = [];
  const service = createAnalyticsService({ get: async (path, options) => {
    calls.push([path, options.query.period]);
    return {
      coverage: { total_transactions: 4, fully_evaluated: 2, partially_evaluated: 1, not_evaluated: 1, coverage_percent: 75,
        by_rule: [{ rule_key: 'ghost_vendors', rule_name: 'Ghost Vendors', evaluated_transactions: 3, not_evaluated_transactions: 1, coverage_percent: 75 }],
        exclusions: [{ rule_key: 'ghost_vendors', reason: 'RULE_CONTEXT_UNAVAILABLE', transaction_count: 1 }] },
      risk_trends: [{ date: '2026-10-03', alerts_created: 2 }], rule_violation_trends: [{ date: '2026-10-03', rule_key: 'ghost_vendors', violations: 1 }],
    };
  } });
  const value = await service.getOverview('7_DAYS');
  assert.equal(value.coverage.totalTransactions, 4);
  assert.equal(value.coverage.byRule[0].ruleKey, 'ghost_vendors');
  assert.equal(value.coverage.exclusions[0].transactionCount, 1);
  assert.equal(value.riskTrends.series[0].alerts_created, 2);
  assert.equal(value.ruleViolationTrends.series[0].violations, 1);
  assert.deepEqual(calls, [['/analytics', '7_DAYS']]);
  assert.equal(createAuditCoverage(null).coveragePercentage, null);
  assert.equal(createTrendModel({ period: 'BAD', series: [] }).period, '30_DAYS');
});
