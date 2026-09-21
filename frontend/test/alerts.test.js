import test from 'node:test';
import assert from 'node:assert/strict';

import { initialAlerts, initialTransactions } from '../src/data/mockData.js';
import { getRiskLevel } from '../src/utils/risk.js';
import {
  ALERT_SORT_OPTIONS,
  buildAlertRows,
  deriveAlertSummary,
  filterAndSortAlerts,
  getAlertReason,
  reviewAlertForTransaction,
  sortAlerts,
} from '../src/utils/alerts.js';

function ids(alerts) {
  return alerts.map(({ id }) => id);
}

test('alert search matches alert ID and transaction ID case-insensitively', () => {
  assert.deepEqual(
    ids(filterAndSortAlerts(initialAlerts, initialTransactions, { search: '  al-3 ' })),
    ['AL-3']
  );
  assert.deepEqual(
    ids(filterAndSortAlerts(initialAlerts, initialTransactions, { search: 'tx-10480' })),
    ['AL-3']
  );
});

test('alert search matches joined vendor and alert type safely', () => {
  assert.deepEqual(
    ids(filterAndSortAlerts(initialAlerts, initialTransactions, { search: 'AL NOOR' })),
    ['AL-3']
  );
  assert.deepEqual(
    ids(filterAndSortAlerts(initialAlerts, initialTransactions, { search: 'approval limit' })),
    ['AL-2']
  );
});

test('alert status filters separate Active and Reviewed state', () => {
  const active = filterAndSortAlerts(initialAlerts, initialTransactions, { statusFilter: 'Active' });
  const reviewed = filterAndSortAlerts(initialAlerts, initialTransactions, { statusFilter: 'Reviewed' });

  assert.equal(active.length, 4);
  assert.ok(active.every(({ status }) => status === 'Active'));
  assert.equal(reviewed.length, 2);
  assert.ok(reviewed.every(({ status }) => status === 'Reviewed'));
});

test('alert risk filters use centralized Medium and High classifications', () => {
  const medium = filterAndSortAlerts(initialAlerts, initialTransactions, { riskFilter: 'Medium' });
  const high = filterAndSortAlerts(initialAlerts, initialTransactions, { riskFilter: 'High' });

  assert.equal(medium.length, 4);
  assert.ok(medium.every(({ riskScore }) => getRiskLevel(riskScore) === 'Medium Risk'));
  assert.equal(high.length, 2);
  assert.ok(high.every(({ riskScore }) => getRiskLevel(riskScore) === 'High Risk'));
});

test('alert-type filtering supports the five project alert types', () => {
  const expectedCounts = {
    'Segregation of Duties': 1,
    'Approval Limit': 1,
    'Duplicate Payment': 2,
    'Invoice Splitting': 1,
    'Ghost Vendor': 1,
  };

  Object.entries(expectedCounts).forEach(([typeFilter, expectedCount]) => {
    const result = filterAndSortAlerts(initialAlerts, initialTransactions, { typeFilter });
    assert.equal(result.length, expectedCount, typeFilter);
    assert.ok(result.every(({ alertType }) => alertType === typeFilter));
  });
});

test('all alert sort modes are deterministic and non-mutating', () => {
  const originalOrder = ids(initialAlerts);

  assert.equal(sortAlerts(initialAlerts, ALERT_SORT_OPTIONS.NEWEST)[0].id, 'AL-1');
  assert.equal(sortAlerts(initialAlerts, ALERT_SORT_OPTIONS.OLDEST)[0].id, 'AL-4');
  assert.equal(sortAlerts(initialAlerts, ALERT_SORT_OPTIONS.HIGHEST_RISK)[0].id, 'AL-1');
  assert.equal(sortAlerts(initialAlerts, ALERT_SORT_OPTIONS.LOWEST_RISK)[0].id, 'AL-2');
  assert.deepEqual(ids(initialAlerts), originalOrder);
});

test('reviewing an alert updates shared review state without altering risk', () => {
  const originalAlert = initialAlerts.find(({ id }) => id === 'AL-1');
  const reviewedAlerts = reviewAlertForTransaction(initialAlerts, originalAlert.transactionId);
  const reviewedAlert = reviewedAlerts.find(({ id }) => id === 'AL-1');

  assert.equal(originalAlert.status, 'Active');
  assert.equal(reviewedAlert.status, 'Reviewed');
  assert.equal(reviewedAlert.riskScore, originalAlert.riskScore);
  assert.equal(getRiskLevel(reviewedAlert.riskScore), 'High Risk');
  assert.deepEqual(deriveAlertSummary(reviewedAlerts), {
    active: 3,
    reviewed: 3,
    high: 2,
    medium: 4,
  });
});

test('alert rows stay consistent with linked transactions and professional reasons', () => {
  const rows = buildAlertRows(initialAlerts, initialTransactions);

  rows.forEach((alert) => {
    const transaction = initialTransactions.find(({ id }) => id === alert.transactionId);
    assert.ok(transaction);
    assert.equal(alert.vendor, transaction.vendor);
    assert.equal(alert.amount, transaction.amount);
    assert.equal(alert.category, transaction.category);
    assert.equal(alert.riskScore, transaction.riskScore);
    assert.doesNotMatch(alert.reasonText, /demo fixture/i);
  });
});

test('empty results and missing optional alert values are handled safely', () => {
  const empty = filterAndSortAlerts(initialAlerts, initialTransactions, { search: 'no such alert' });
  const incompleteAlert = {
    id: 'AL-MISSING',
    transactionId: 'TX-MISSING',
    title: 'Ghost Vendor Flagged',
    description: undefined,
    timestamp: undefined,
    riskScore: 69,
    status: 'Active',
  };

  assert.deepEqual(empty, []);
  assert.doesNotThrow(() => filterAndSortAlerts([incompleteAlert], [], { search: 'ghost' }));
  assert.equal(getAlertReason(incompleteAlert), 'Vendor may not match the registered vendor records.');
});
