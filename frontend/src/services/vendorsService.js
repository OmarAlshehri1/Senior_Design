import { apiClient } from './apiClient.js';
import { normalizeVendor, normalizeVendors } from '../vendors/vendorModel.js';

export function createVendorsService(client = apiClient) {
  return Object.freeze({
    async listVendors(options = {}) {
      const result = await client.get('/vendors', options);
      return { ...result, items: normalizeVendors(result?.items) };
    },
    async getVendor(vendorId, options = {}) {
      const result = await client.get(`/vendors/${encodeURIComponent(vendorId)}`, options);
      return { ...result, vendor: normalizeVendor(result?.vendor) };
    },
    requestVendorWatchlist: (vendorId, reason, options = {}) => client.post(`/vendors/${encodeURIComponent(vendorId)}/watchlist-requests`, { reason }, options),
    requestVendorBlock: (vendorId, reason, options = {}) => client.post(`/vendors/${encodeURIComponent(vendorId)}/block-requests`, { reason }, options),
    reviewVendorWatchlistRequest: (requestId, approve, note = null, options = {}) => client.post(`/vendors/requests/${encodeURIComponent(requestId)}/decision`, { approve, note }, options),
    decideVendorBlockRequest: (requestId, approve, note = null, options = {}) => client.post(`/vendors/requests/${encodeURIComponent(requestId)}/decision`, { approve, note }, options),
    removeVendorWatchlist: (vendorId, note = null, options = {}) => client.post(`/vendors/${encodeURIComponent(vendorId)}/monitoring`, { action: 'REMOVE_WATCHLIST', note }, options),
    unblockVendor: (vendorId, note = null, options = {}) => client.post(`/vendors/${encodeURIComponent(vendorId)}/monitoring`, { action: 'UNBLOCK', note }, options),
  });
}

export const vendorsService = createVendorsService();
