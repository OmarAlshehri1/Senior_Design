import { apiClient } from '../services/apiClient.js';
import { normalizeAuditEvent } from './auditEvents.js';
import { normalizeReviewRecord } from './reviewRecords.js';

export function createAuditService(client = apiClient) {
  const adaptPage = (page, normalize) => Object.freeze({
    ...page,
    items: Object.freeze((page?.items ?? []).map(normalize).filter(Boolean)),
  });
  return Object.freeze({
    getAuditEvents: async (query = {}) => adaptPage(await client.get('/audit-events', { query }), normalizeAuditEvent),
    getReviewHistory: async (resourceType, resourceId, query = {}) => adaptPage(await client.get(
      `/reviews/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`, { query }
    ), normalizeReviewRecord),
    addReviewNote: (resourceType, resourceId, note) => client.post(
      `/reviews/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`,
      { action: 'NOTE_ADDED', note }
    ),
    recordReview: async (resourceType, resourceId, action, note = null) => {
      const response = await client.post(
        `/reviews/${encodeURIComponent(resourceType)}/${encodeURIComponent(resourceId)}`,
        { action, note }
      );
      return Object.freeze({ ...response, record: normalizeReviewRecord(response?.record) });
    },
    getLoginHistory: (userId, query = {}) => client.get(`/users/${encodeURIComponent(userId)}/login-history`, { query }),
    getSecurityActivity: (query = {}) => client.get('/audit-events', { query }),
  });
}

export const auditService = createAuditService();
