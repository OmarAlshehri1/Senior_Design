import { apiClient } from './apiClient.js';
import { adaptCase, adaptCaseBundle, adaptCaseCollection } from '../adapters/caseAdapter.js';

export function createCasesService(client = apiClient) {
  return Object.freeze({
    async listCases(options = {}) {
      return adaptCaseCollection(await client.get('/cases', options));
    },
    async getCase(caseId, options = {}) {
      const [bundleResult, capabilitiesResult] = await Promise.allSettled([
        client.get(`/cases/${encodeURIComponent(caseId)}`, options),
        client.get('/cases/capabilities', options),
      ]);
      if (bundleResult.status === 'rejected') throw bundleResult.reason;
      const capabilities = capabilitiesResult.status === 'fulfilled' ? capabilitiesResult.value : null;
      return { ...adaptCaseBundle(bundleResult.value), capabilities: { evidenceUploadsEnabled: capabilities?.evidence_uploads_enabled === true } };
    },
    async createCase(input, options = {}) {
      return adaptCase(await client.post('/cases', input, options));
    },
    async updateCaseStatus(caseId, status, note = null, options = {}) {
      return adaptCase(await client.post(`/cases/${encodeURIComponent(caseId)}/status`, { status, note }, options));
    },
    async assignCase(caseId, assigneeId, note = null, options = {}) {
      const result = await client.post(`/cases/${encodeURIComponent(caseId)}/assignment`, { assignee_id: assigneeId, note }, options);
      return adaptCase(result?.case);
    },
    async addCaseComment(caseId, message, options = {}) {
      return client.post(`/cases/${encodeURIComponent(caseId)}/comments`, { message }, options);
    },
    async requestCaseClosure(caseId, input, options = {}) {
      return adaptCase(await client.post(`/cases/${encodeURIComponent(caseId)}/closure-request`, input, options));
    },
    async decideCaseClosure(caseId, approve, note = null, options = {}) {
      return adaptCase(await client.post(`/cases/${encodeURIComponent(caseId)}/closure-decision`, { approve, note }, options));
    },
    async addCaseEvidence(caseId, file, { category, description, ...options } = {}) {
      const result = await client.postRaw(`/cases/${encodeURIComponent(caseId)}/evidence`, file, {
        ...options,
        query: { category, description },
        headers: { 'Content-Type': file.type, 'X-File-Name': file.name, ...options.headers },
      });
      return result;
    },
    getCaseEvidence: (caseId, evidenceId, options = {}) => client.getFile(
      `/cases/${encodeURIComponent(caseId)}/evidence/${encodeURIComponent(evidenceId)}`,
      { ...options, headers: { Accept: 'application/octet-stream', ...options.headers } },
    ),
    async getCaseActivity(caseId, options = {}) {
      return (await client.get(`/cases/${encodeURIComponent(caseId)}`, options))?.activity ?? [];
    },
  });
}

export const casesService = createCasesService();
