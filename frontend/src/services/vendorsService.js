import { unavailableOperation } from './unavailableService.js';

const unavailable = unavailableOperation('Vendor monitoring');
export const vendorsService = Object.freeze({
  listVendors: unavailable, getVendor: unavailable, getVendorTransactions: unavailable,
  getVendorAlerts: unavailable, getVendorCases: unavailable, getVendorRiskHistory: unavailable,
  requestVendorWatchlist: unavailable, reviewVendorWatchlistRequest: unavailable,
  requestVendorBlock: unavailable, blockVendor: unavailable, unblockVendor: unavailable,
  removeVendorWatchlist: unavailable,
});
