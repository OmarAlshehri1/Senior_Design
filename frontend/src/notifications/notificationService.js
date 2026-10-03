import { apiClient } from '../services/apiClient.js';
import { normalizeNotifications } from './notifications.js';

export function createNotificationService(client = apiClient) {
  return Object.freeze({
    async listNotifications(options = {}) {
      const result = await client.get('/notifications', options);
      return {
        ...result,
        items: normalizeNotifications(result?.items),
        unreadCount: Number.isFinite(result?.unread_count) ? result.unread_count : 0,
      };
    },
    markNotificationRead: (notificationId, options = {}) => client.patch(
      `/notifications/${encodeURIComponent(notificationId)}/read`, {}, options
    ),
    markAllNotificationsRead: (options = {}) => client.post('/notifications/read-all', {}, options),
  });
}

export const notificationService = createNotificationService();

