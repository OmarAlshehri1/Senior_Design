import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { createTransactionsService } from '../src/services/transactionsService.js';
import { getTotalPages, shouldShowPageNavigation } from '../src/utils/pagination.js';

test('transaction list preserves authoritative filters and filtered total', async () => {
  const calls = [];
  const service = createTransactionsService({
    get: async (path, options) => {
      calls.push([path, options]);
      return { items: [], total: 47, page: 2, page_size: 10 };
    },
  });
  const query = {
    page: 2,
    page_size: 10,
    search: 'vendor',
    risk_level: 'MEDIUM',
    rule_status: 'REVIEW',
    sort_by: 'highest-amount',
  };

  const result = await service.list({ query });

  assert.equal(result.total, 47);
  assert.deepEqual(calls, [['/transactions', { query }]]);
});

test('transaction page renders the server result without current-page filtering', async () => {
  const source = await readFile(
    new URL('../src/pages/Transactions.jsx', import.meta.url),
    'utf8'
  );
  const context = await readFile(
    new URL('../src/context/AppContext.jsx', import.meta.url),
    'utf8'
  );

  assert.doesNotMatch(source, /filterAndSortTransactions|\.filter\(/);
  assert.match(source, /transactions=\{transactions\}/);
  assert.match(source, /transactionsTotal/);
  assert.match(context, /risk_level: transactionsRiskLevel/);
  assert.match(context, /rule_status: transactionsRuleStatus/);
});

test('filtered pagination hides one page and shows multiple pages', () => {
  assert.equal(getTotalPages(10, 10), 1);
  assert.equal(shouldShowPageNavigation(1), false);
  assert.equal(getTotalPages(47, 10), 5);
  assert.equal(shouldShowPageNavigation(5), true);
});
