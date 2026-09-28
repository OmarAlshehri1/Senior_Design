import { apiClient } from './apiClient.js';
import { adaptAlert, adaptAlertCollection } from '../adapters/alertAdapter.js';

export function createAlertsService(client = apiClient) {
  return Object.freeze({
    list: async (options = {}) => adaptAlertCollection(await client.get('/alerts', options)),
    markReviewed: async (alertId, options = {}) => adaptAlert(
      await client.patch(
        `/alerts/${encodeURIComponent(alertId)}/review`,
        { status: 'REVIEWED' },
        options
      )
    ),
  });
}

export const alertsService = createAlertsService();
