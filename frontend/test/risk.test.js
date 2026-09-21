import test from 'node:test';
import assert from 'node:assert/strict';

import { initialAlerts, initialTransactions } from '../src/data/mockData.js';
import {
  DASHBOARD_RISK_LINKS,
  deriveDashboardSummary,
  getRecentTransactions,
} from '../src/utils/dashboard.js';
import { getRiskLevel } from '../src/utils/risk.js';

const boundaryCases = [
  [0, 'Low Risk'],
  [49, 'Low Risk'],
  [50, 'Medium Risk'],
  [61, 'Medium Risk'],
  [74, 'Medium Risk'],
  [75, 'High Risk'],
  [100, 'High Risk'],
];

test('getRiskLevel uses the approved boundaries', () => {
  boundaryCases.forEach(([score, expected]) => {
    assert.equal(getRiskLevel(score), expected, `${score} should be ${expected}`);
  });
});

test('dashboard summary and distribution are derived from transaction risk scores', () => {
  const { summary, riskCounts, riskOverview } = deriveDashboardSummary(initialTransactions);

  assert.deepEqual(summary, {
    totalTransactions: 24,
    transactionsEvaluated: 24,
    highRiskTransactions: 2,
    averageRiskScore: 34,
  });
  assert.deepEqual(riskCounts, { low: 18, medium: 4, high: 2 });
  assert.deepEqual(riskOverview, { low: 75, medium: 17, high: 8 });
  assert.equal(riskOverview.low + riskOverview.medium + riskOverview.high, 100);
});

test('dashboard risk actions use supported transaction filter links', () => {
  assert.deepEqual(DASHBOARD_RISK_LINKS, {
    low: '/transactions?risk=low',
    medium: '/transactions?risk=medium',
    high: '/transactions?risk=high',
  });
});

test('dashboard recent transactions are newest first and limited', () => {
  const recent = getRecentTransactions(initialTransactions, 4);

  assert.deepEqual(
    recent.map(({ id }) => id),
    ['TX-10496', 'TX-10482', 'TX-10481', 'TX-10480']
  );
  assert.equal(recent.length, 4);
});

test('Review status remains separate from Medium Risk classification', () => {
  const transaction = initialTransactions.find(({ id }) => id === 'TX-10480');

  assert.ok(transaction);
  assert.equal(transaction.ruleStatus, 'Review');
  assert.equal(transaction.aiScore, 54);
  assert.equal(transaction.riskScore, 61);
  assert.equal(getRiskLevel(transaction.riskScore), 'Medium Risk');
  assert.equal(transaction.rules.invoiceSplitting.status, 'Failed');
  assert.equal(Object.hasOwn(transaction, 'riskLevel'), false);
  assert.equal(Object.hasOwn(transaction, 'status'), false);
});

test('every fixture keeps score, rule status, and detailed rule evidence consistent', () => {
  initialTransactions.forEach((transaction) => {
    const failedRules = Object.values(transaction.rules)
      .filter(({ status }) => status === 'Failed');

    assert.ok(transaction.riskScore >= 0 && transaction.riskScore <= 100);
    assert.ok(transaction.ruleScore >= 0 && transaction.ruleScore <= 100);
    assert.ok(transaction.aiScore >= 0 && transaction.aiScore <= 100);
    assert.notEqual(getRiskLevel(transaction.riskScore), null);
    assert.equal(transaction.ruleStatus, failedRules.length > 0 ? 'Review' : 'Passed');
    assert.ok(failedRules.length <= 1, `${transaction.id} has contradictory failed rules`);
    assert.equal(Object.hasOwn(transaction, 'riskLevel'), false);
    assert.equal(Object.hasOwn(transaction, 'status'), false);
  });
});

test('every alert is consistent with its linked transaction and rule evidence', () => {
  const alertRuleKeys = {
    'Duplicate Payment Detected': 'duplicatePayment',
    'Approval Limit Exception': 'approvalLimit',
    'Invoice Splitting Detected': 'invoiceSplitting',
    'Ghost Vendor Flagged': 'ghostVendor',
    'Segregation of Duties Violation': 'segregationOfDuties',
  };

  initialAlerts.forEach((alert) => {
    const transaction = initialTransactions.find(({ id }) => id === alert.transactionId);
    const ruleKey = alertRuleKeys[alert.title];

    assert.ok(transaction, `${alert.id} must link to an existing transaction`);
    assert.ok(ruleKey, `${alert.id} must identify a known rule`);
    assert.equal(transaction.ruleStatus, 'Review');
    assert.equal(transaction.rules[ruleKey].status, 'Failed');
    assert.match(alert.reason, new RegExp(alert.title.replace(/ (Detected|Exception|Flagged|Violation)$/, ''), 'i'));
    assert.equal(alert.riskScore, transaction.riskScore);
    assert.equal(alert.severity, getRiskLevel(transaction.riskScore).replace(' Risk', ''));
    assert.equal(alert.timestamp, transaction.timestamp);
    assert.equal(alert.time, transaction.time);
    assert.ok(['Active', 'Reviewed'].includes(alert.status));
    assert.equal(Number.isNaN(Date.parse(alert.timestamp)), false);
  });
});
