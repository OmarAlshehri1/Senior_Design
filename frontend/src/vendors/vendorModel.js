export const VENDOR_STATUSES = Object.freeze({ NORMAL: 'NORMAL', WATCHLISTED: 'WATCHLISTED', BLOCKED: 'BLOCKED' });
export const VENDOR_STATUS_META = Object.freeze({
  NORMAL: Object.freeze({ label: 'Normal', transactionLabel: null }),
  WATCHLISTED: Object.freeze({ label: 'Watchlisted', transactionLabel: 'Watchlisted Vendor' }),
  BLOCKED: Object.freeze({ label: 'Blocked', transactionLabel: 'Blocked in Audit Monitoring' }),
});
export const WATCHLIST_REQUEST_STATUSES = Object.freeze({ PENDING: 'PENDING', APPROVED: 'APPROVED', REJECTED: 'REJECTED' });
export const VENDOR_BLOCK_REQUEST_STATUSES = WATCHLIST_REQUEST_STATUSES;
export const VENDOR_FIELDS = Object.freeze(['id', 'name', 'monitoringStatus', 'riskLevel', 'averageRiskScore', 'transactionCount', 'totalTransactionValue', 'activeAlerts', 'openCases', 'ruleViolations']);

export function normalizeVendor(value) {
  if (!value || typeof value !== 'object' || !Object.values(VENDOR_STATUSES).includes(value.monitoringStatus)) return null;
  return Object.freeze(Object.fromEntries(VENDOR_FIELDS.map((field) => [field, value[field] ?? null])));
}
export function normalizeVendors(values = []) {
  if (!Array.isArray(values)) return Object.freeze([]);
  return Object.freeze(values.map(normalizeVendor).filter(Boolean));
}
export function normalizeVendorRequest(value, statuses = WATCHLIST_REQUEST_STATUSES) {
  if (!value || typeof value !== 'object' || !Object.values(statuses).includes(value.status)) return null;
  return Object.freeze({ id: value.id ?? null, vendorId: value.vendorId ?? null, reason: value.reason ?? null, requestedBy: value.requestedBy ?? null, requestedAt: value.requestedAt ?? null, status: value.status, reviewedBy: value.reviewedBy ?? null, reviewedAt: value.reviewedAt ?? null });
}
export const VENDORS = normalizeVendors();
