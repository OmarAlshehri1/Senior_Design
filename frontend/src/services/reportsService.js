import { apiClient } from './apiClient.js';

export function createReportsService(client = apiClient) {
  return Object.freeze({
    list: (options = {}) => client.get('/reports', options),
    generate: (reportRequest, options = {}) => client.post('/reports', reportRequest, options),
  });
}

export const reportsService = createReportsService();
