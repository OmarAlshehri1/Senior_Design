import { apiClient } from './apiClient.js';

export function createSettingsService(client = apiClient) {
  const adapt = (value) => Object.freeze({
    organizationName: value?.organization_name ?? '',
    updatedAt: value?.updated_at ?? null,
  });
  return Object.freeze({
    async get(options = {}) {
      return adapt(await client.get('/settings', options));
    },
    async update({ organizationName }, options = {}) {
      return adapt(await client.patch('/settings/organization', {
        organization_name: organizationName,
      }, options));
    },
  });
}

export const settingsService = createSettingsService();
