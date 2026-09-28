import { apiClient } from './apiClient.js';
import { adaptTransaction, adaptTransactionCollection } from '../adapters/transactionAdapter.js';

export function createTransactionsService(client = apiClient) {
  return Object.freeze({
    list: async (options = {}) => adaptTransactionCollection(
      await client.get('/transactions', options)
    ),
    getById: async (transactionId, options = {}) => adaptTransaction(
      await client.get(`/transactions/${encodeURIComponent(transactionId)}`, options)
    ),
    create: async (transaction, options = {}) => adaptTransaction(
      await client.post('/transactions', transaction, options)
    ),
  });
}

export const transactionsService = createTransactionsService();
