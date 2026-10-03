import { apiClient } from './apiClient.js';
import { adaptAlert, adaptAlertCollection } from '../adapters/alertAdapter.js';

export function createAlertsService(client = apiClient) {
  const list = async (options = {}) => adaptAlertCollection(await client.get('/alerts', options));

  return Object.freeze({
    list,
    listAll: async ({ pageSize = 100, ...options } = {}) => {
      const size = Math.max(1, Math.min(100, Math.trunc(pageSize) || 100));
      const alertsById = new Map();
      let page = 1;
      let total = 0;
      let lastPageSize = 0;

      do {
        const result = await list({
          ...options,
          query: { ...options.query, page, page_size: size },
        });
        total = result.total;
        lastPageSize = result.items.length;
        result.items.forEach((alert) => {
          if (alert?.id) alertsById.set(alert.id, alert);
        });
        page += 1;
      } while (alertsById.size < total && lastPageSize === size);

      return { items: [...alertsById.values()], total, page: 1, pageSize: size };
    },
    updateReview: async (alertId, status = 'REVIEWED', note = null, options = {}) => adaptAlert(
      await client.patch(
        `/alerts/${encodeURIComponent(alertId)}/review`,
        { status, note },
        options
      )
    ),
    markReviewed: async (alertId, options = {}) => adaptAlert(
      await client.patch(`/alerts/${encodeURIComponent(alertId)}/review`, { status: 'REVIEWED' }, options)
    ),
  });
}

export const alertsService = createAlertsService();
