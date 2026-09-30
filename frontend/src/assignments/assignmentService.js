import { IntegrationError, INTEGRATION_ERROR_CODES } from '../services/integrationError.js';

const unavailable = (operation) => Promise.reject(new IntegrationError(
  `${operation} is not available yet.`,
  { code: INTEGRATION_ERROR_CODES.CONFIGURATION_UNAVAILABLE }
));

export const assignmentService = Object.freeze({
  assignAlert: () => unavailable('Alert assignment'),
  reassignAlert: () => unavailable('Alert reassignment'),
  getAlertAssignmentHistory: () => unavailable('Assignment history'),
});

