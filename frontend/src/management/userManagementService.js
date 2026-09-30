import { IntegrationError, INTEGRATION_ERROR_CODES } from '../services/integrationError.js';

const unavailable = (operation) => Promise.reject(new IntegrationError(
  `${operation} is not available yet.`,
  { code: INTEGRATION_ERROR_CODES.CONFIGURATION_UNAVAILABLE }
));

export const userManagementService = Object.freeze({
  listUsers: () => unavailable('User management'),
  getUser: () => unavailable('User details'),
  listAccessRequests: () => unavailable('Access request administration'),
  approveAccessRequest: () => unavailable('Access request approval'),
  rejectAccessRequest: () => unavailable('Access request rejection'),
  changeUserRole: () => unavailable('Role management'),
  unlockUser: () => unavailable('Account unlocking'),
  disableUser: () => unavailable('Account disabling'),
  enableUser: () => unavailable('Account enabling'),
});

