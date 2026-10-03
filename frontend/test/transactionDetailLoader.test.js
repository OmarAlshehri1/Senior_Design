import test from 'node:test';
import assert from 'node:assert/strict';

import {
  loadTransactionDetail,
  TRANSACTION_DETAIL_STATES,
} from '../src/services/transactionDetailLoader.js';

test('transaction detail fetches by ID when absent from the current page', async () => {
  const requests = [];
  const service = {
    getById: async (id, options) => {
      requests.push({ id, options });
      return { id, vendor: 'Fetched Vendor' };
    },
  };
  const controller = new AbortController();

  const result = await loadTransactionDetail({
    id: 'TX-OUTSIDE-PAGE',
    service,
    signal: controller.signal,
  });

  assert.equal(result.status, TRANSACTION_DETAIL_STATES.SUCCESS);
  assert.equal(result.transaction.id, 'TX-OUTSIDE-PAGE');
  assert.deepEqual(requests, [{
    id: 'TX-OUTSIDE-PAGE',
    options: { signal: controller.signal },
  }]);
});

test('transaction detail reuses a current-page transaction without fetching', async () => {
  const currentTransaction = { id: 'TX-CURRENT' };
  const service = {
    getById: async () => assert.fail('getById should not be called'),
  };

  const result = await loadTransactionDetail({
    id: 'TX-CURRENT',
    currentTransaction,
    service,
  });

  assert.equal(result.status, TRANSACTION_DETAIL_STATES.SUCCESS);
  assert.equal(result.transaction, currentTransaction);
});

test('transaction detail distinguishes not found from request errors', async () => {
  const notFound = await loadTransactionDetail({
    id: 'TX-MISSING',
    service: {
      getById: async () => { throw Object.assign(new Error('Missing'), { status: 404 }); },
    },
  });
  const unavailable = await loadTransactionDetail({
    id: 'TX-ERROR',
    service: {
      getById: async () => { throw Object.assign(new Error('Unavailable'), { status: 503 }); },
    },
  });

  assert.equal(notFound.status, TRANSACTION_DETAIL_STATES.NOT_FOUND);
  assert.equal(notFound.error, null);
  assert.equal(unavailable.status, TRANSACTION_DETAIL_STATES.ERROR);
  assert.equal(unavailable.error.status, 503);
});
