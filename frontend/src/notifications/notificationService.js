import { IntegrationError, INTEGRATION_ERROR_CODES } from '../services/integrationError.js';

const unavailable = (operation) => Promise.reject(new IntegrationError(
  `${operation} is not available yet.`,
  { code: INTEGRATION_ERROR_CODES.CONFIGURATION_UNAVAILABLE }
));

export const notificationService = Object.freeze({
  listNotifications: () => unavailable('Notifications'),
  markNotificationRead: () => unavailable('Notification updates'),
  markAllNotificationsRead: () => unavailable('Notification updates'),
});

