import { adaptReport, adaptReportCollection } from '../adapters/reportAdapter.js';
import { environment } from '../config/env.js';
import { apiClient } from './apiClient.js';

export function createReportsService(
  client = apiClient,
  apiBaseUrl = environment.apiBaseUrl
) {
  const normalizedBaseUrl = typeof apiBaseUrl === 'string'
    ? apiBaseUrl.replace(/\/+$/, '')
    : null;

  return Object.freeze({
    list: async (options = {}) => adaptReportCollection(
      await client.get('/reports', options)
    ),
    generate: async (reportRequest, options = {}) => adaptReport(
      await client.post('/reports', reportRequest, options)
    ),
    generateLatest: async (options = {}) => adaptReport(
      await client.post('/reports/latest', {}, options)
    ),
    getDownloadUrl(reportId) {
      if (
        !normalizedBaseUrl
        || typeof reportId !== 'string'
        || !reportId.trim()
      ) {
        return null;
      }

      return (
        `${normalizedBaseUrl}/reports/`
        + `${encodeURIComponent(reportId)}/download`
      );
    },
    download(reportId, options = {}) {
      if (typeof reportId !== 'string' || !reportId.trim()) {
        throw new TypeError('A report ID is required.');
      }
      if (typeof client.getFile !== 'function') {
        throw new TypeError('Authenticated file downloads are unavailable.');
      }
      return client.getFile(`/reports/${encodeURIComponent(reportId)}/download`, options);
    },
  });
}

export const reportsService = createReportsService();
