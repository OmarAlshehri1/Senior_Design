import test from 'node:test';
import assert from 'node:assert/strict';

import { AUDIT_RULES } from '../src/data/auditRules.js';
import { initialAlerts, initialTransactions } from '../src/data/mockData.js';
import { deriveDashboardSummary } from '../src/utils/dashboard.js';
import { getRiskLevel } from '../src/utils/risk.js';
import {
  deriveHighRiskTransactions,
  deriveReportPreview,
  deriveRuleViolationSummary,
} from '../src/utils/reports.js';

test('report summary derives current transaction and alert totals', () => {
  const report = deriveReportPreview(initialTransactions, initialAlerts);

  assert.deepEqual(report.dailySummary, {
    totalTransactions: 24,
    transactionsEvaluated: 24,
    highRiskTransactions: 2,
    averageRiskScore: 34,
    activeAlerts: 4,
    reviewedAlerts: 2,
  });
});

test('report risk distribution matches the centralized dashboard derivation', () => {
  const report = deriveReportPreview(initialTransactions, initialAlerts);
  const dashboard = deriveDashboardSummary(initialTransactions);

  assert.deepEqual(
    Object.fromEntries(report.riskDistribution.map(({ key, count }) => [key, count])),
    dashboard.riskCounts
  );
  assert.deepEqual(
    Object.fromEntries(report.riskDistribution.map(({ key, percentage }) => [key, percentage])),
    dashboard.riskOverview
  );
});

test('rule summary contains exactly the centralized five rules and recorded violations', () => {
  const ruleSummary = deriveRuleViolationSummary(initialTransactions);

  assert.deepEqual(ruleSummary.map(({ id }) => id), AUDIT_RULES.map(({ id }) => id));
  assert.deepEqual(ruleSummary.map(({ name }) => name), AUDIT_RULES.map(({ name }) => name));
  assert.deepEqual(
    Object.fromEntries(ruleSummary.map(({ id, violationCount }) => [id, violationCount])),
    { 'RULE-001': 1, 'RULE-002': 1, 'RULE-003': 2, 'RULE-004': 1, 'RULE-005': 1 }
  );
});

test('high-risk report rows use centralized risk classification', () => {
  const highRiskTransactions = deriveHighRiskTransactions(initialTransactions);

  assert.deepEqual(highRiskTransactions.map(({ id }) => id), ['TX-10496', 'TX-10468']);
  assert.ok(highRiskTransactions.every(({ riskScore }) => getRiskLevel(riskScore) === 'High Risk'));
});

test('alert summary separates total, status, and risk counts', () => {
  assert.deepEqual(deriveReportPreview(initialTransactions, initialAlerts).alertSummary, {
    total: 6,
    active: 4,
    reviewed: 2,
    high: 2,
    medium: 4,
  });
});

test('report derivation is non-mutating and tolerates missing optional transaction values', () => {
  const transactions = [
    ...initialTransactions,
    {
      id: 'TX-INCOMPLETE',
      timestamp: undefined,
      vendor: undefined,
      riskScore: undefined,
      rules: undefined,
    },
  ];
  const originalTransactions = structuredClone(transactions);
  const originalAlerts = structuredClone(initialAlerts);

  assert.doesNotThrow(() => deriveReportPreview(transactions, initialAlerts));
  assert.deepEqual(transactions, originalTransactions);
  assert.deepEqual(initialAlerts, originalAlerts);
});

test('empty datasets produce a safe report preview', () => {
  const report = deriveReportPreview([], []);

  assert.deepEqual(report.dailySummary, {
    totalTransactions: 0,
    transactionsEvaluated: 0,
    highRiskTransactions: 0,
    averageRiskScore: 0,
    activeAlerts: 0,
    reviewedAlerts: 0,
  });
  assert.deepEqual(report.riskDistribution.map(({ count, percentage }) => [count, percentage]), [
    [0, 0], [0, 0], [0, 0],
  ]);
  assert.deepEqual(report.ruleSummary.map(({ violationCount }) => violationCount), [0, 0, 0, 0, 0]);
  assert.deepEqual(report.highRiskTransactions, []);
  assert.equal(report.previewDate, null);
});
