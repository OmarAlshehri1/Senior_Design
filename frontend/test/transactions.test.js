import test from 'node:test';
import assert from 'node:assert/strict';

import { displayValue, formatSAR, formatScore } from '../src/components/statusUtils.js';
import { initialTransactions } from '../src/data/mockData.js';
import {
  AUDIT_RULE_DEFINITIONS,
  TRANSACTION_SORT_OPTIONS,
  filterAndSortTransactions,
  findTransactionById,
  getRiskFilterFromQuery,
  getTransactionDataQuality,
  sortTransactions,
} from '../src/utils/transactions.js';

function ids(transactions) {
  return transactions.map(({ id }) => id);
}

test('transaction search matches ID, vendor, and category case-insensitively', () => {
  assert.deepEqual(
    ids(filterAndSortTransactions(initialTransactions, { search: '  tx-10480  ' })),
    ['TX-10480']
  );
  assert.deepEqual(
    ids(filterAndSortTransactions(initialTransactions, { search: 'AL NOOR' })),
    ['TX-10480', 'TX-10465']
  );
  assert.deepEqual(
    ids(filterAndSortTransactions(initialTransactions, { search: '  technology ' })),
    ['TX-10471']
  );
});

test('transaction risk filters use the centralized risk classification', () => {
  assert.equal(filterAndSortTransactions(initialTransactions, { riskFilter: 'Low' }).length, 18);
  assert.equal(filterAndSortTransactions(initialTransactions, { riskFilter: 'Medium' }).length, 4);
  assert.equal(filterAndSortTransactions(initialTransactions, { riskFilter: 'High' }).length, 2);
});

test('transaction rule-status filters keep Passed and Review separate', () => {
  assert.equal(filterAndSortTransactions(initialTransactions, { ruleFilter: 'Passed' }).length, 18);
  assert.equal(filterAndSortTransactions(initialTransactions, { ruleFilter: 'Review' }).length, 6);
});

test('URL risk filter values initialize predictably', () => {
  assert.equal(getRiskFilterFromQuery('low'), 'Low');
  assert.equal(getRiskFilterFromQuery('MEDIUM'), 'Medium');
  assert.equal(getRiskFilterFromQuery('High'), 'High');
  assert.equal(getRiskFilterFromQuery('unsupported'), 'All');
  assert.equal(getRiskFilterFromQuery(null), 'All');
});

test('all transaction sort modes are deterministic and non-mutating', () => {
  const originalOrder = ids(initialTransactions);

  assert.equal(sortTransactions(initialTransactions, TRANSACTION_SORT_OPTIONS.NEWEST)[0].id, 'TX-10496');
  assert.equal(sortTransactions(initialTransactions, TRANSACTION_SORT_OPTIONS.OLDEST)[0].id, 'TX-10460');
  assert.equal(sortTransactions(initialTransactions, TRANSACTION_SORT_OPTIONS.HIGHEST_RISK)[0].id, 'TX-10496');
  assert.equal(sortTransactions(initialTransactions, TRANSACTION_SORT_OPTIONS.LOWEST_RISK)[0].id, 'TX-10473');
  assert.equal(sortTransactions(initialTransactions, TRANSACTION_SORT_OPTIONS.HIGHEST_AMOUNT)[0].id, 'TX-10496');
  assert.equal(sortTransactions(initialTransactions, TRANSACTION_SORT_OPTIONS.LOWEST_AMOUNT)[0].id, 'TX-10473');
  assert.deepEqual(ids(initialTransactions), originalOrder);
});

test('missing optional values are safe and expose data-quality state', () => {
  const complete = initialTransactions[0];
  const partiallyComplete = {
    ...complete,
    category: null,
    dataQuality: undefined,
  };
  const needsReview = {
    ...complete,
    vendor: null,
    amount: undefined,
    dataQuality: undefined,
  };

  assert.doesNotThrow(() => filterAndSortTransactions([partiallyComplete], { search: 'missing' }));
  assert.equal(displayValue(null), 'Not available');
  assert.equal(formatSAR(undefined), 'Not available');
  assert.equal(formatScore(null), 'Not available');
  assert.deepEqual(getTransactionDataQuality(partiallyComplete), {
    status: 'Partially Complete',
    missingFields: ['Category'],
  });
  assert.deepEqual(getTransactionDataQuality(needsReview), {
    status: 'Needs Review',
    missingFields: ['Vendor', 'Amount'],
  });
});

test('transaction lookup handles missing IDs without broken detail data', () => {
  assert.equal(findTransactionById(initialTransactions, 'TX-DOES-NOT-EXIST'), null);
  assert.equal(findTransactionById(initialTransactions, 'TX-10480')?.id, 'TX-10480');
});

test('transaction detail exposes exactly the five project audit rules', () => {
  assert.deepEqual(
    AUDIT_RULE_DEFINITIONS.map(({ label }) => label),
    [
      'Segregation of Duties',
      'Approval Limits',
      'Duplicate Payments',
      'Invoice Splitting',
      'Ghost Vendors',
    ]
  );
});
