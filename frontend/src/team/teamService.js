import { IntegrationError, INTEGRATION_ERROR_CODES } from '../services/integrationError.js';

const unavailable = (operation) => Promise.reject(new IntegrationError(
  `${operation} is not available yet.`,
  { code: INTEGRATION_ERROR_CODES.CONFIGURATION_UNAVAILABLE }
));

export const teamService = Object.freeze({
  getTeamActivity: () => unavailable('Team activity'),
  getTeamWorkload: () => unavailable('Team workload'),
});

