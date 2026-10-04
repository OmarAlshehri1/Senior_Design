import { apiClient } from './apiClient.js';
import { adaptAuditRuleCollection } from '../adapters/auditRuleAdapter.js';

export function createAuditRulesService(client = apiClient) {
  return Object.freeze({
    async list(options = {}) {
      return adaptAuditRuleCollection(await client.get('/audit-rules', options));
    },
  });
}

export const auditRulesService = createAuditRulesService();
