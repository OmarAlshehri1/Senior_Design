import { transactionsService } from './transactionsService.js';

export function createDashboardRecentService(service = transactionsService) {
  return {
    // Deliberately accepts no transaction-list query state.
    list: ({ signal } = {}) => service.list({
      query: { page: 1, page_size: 6, sort_by: 'newest' }, signal,
    }),
  };
}

export const dashboardRecentService = createDashboardRecentService();
