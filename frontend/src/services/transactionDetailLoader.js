import { transactionsService } from './transactionsService.js';

export const TRANSACTION_DETAIL_STATES = Object.freeze({
  SUCCESS: 'success',
  NOT_FOUND: 'not-found',
  ERROR: 'error',
});

export async function loadTransactionDetail({
  id,
  currentTransaction = null,
  service = transactionsService,
  signal,
}) {
  if (currentTransaction?.id === id) {
    return {
      status: TRANSACTION_DETAIL_STATES.SUCCESS,
      transaction: currentTransaction,
      error: null,
    };
  }

  try {
    const transaction = await service.getById(id, { signal });

    if (!transaction) {
      return {
        status: TRANSACTION_DETAIL_STATES.NOT_FOUND,
        transaction: null,
        error: null,
      };
    }

    return {
      status: TRANSACTION_DETAIL_STATES.SUCCESS,
      transaction,
      error: null,
    };
  } catch (error) {
    if (error?.status === 404) {
      return {
        status: TRANSACTION_DETAIL_STATES.NOT_FOUND,
        transaction: null,
        error: null,
      };
    }

    return {
      status: TRANSACTION_DETAIL_STATES.ERROR,
      transaction: null,
      error,
    };
  }
}
