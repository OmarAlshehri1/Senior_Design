const ALERT_STATUS_MAP = Object.freeze({ ACTIVE: 'Active', REVIEWED: 'Reviewed' });
const SEVERITY_MAP = Object.freeze({ LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High' });

export function adaptAlert(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;

  return {
    id: payload.id ?? null,
    transactionId: payload.transaction_id ?? null,
    timestamp: payload.created_at ?? null,
    severity: SEVERITY_MAP[payload.severity] ?? null,
    title: payload.title ?? null,
    description: payload.description ?? null,
    reason: payload.reason ?? null,
    status: ALERT_STATUS_MAP[payload.status] ?? null,
    reviewedAt: payload.reviewed_at ?? null,
  };
}

export function adaptAlertCollection(payload) {
  if (!payload || !Array.isArray(payload.items)) {
    return { items: [], total: 0, page: null, pageSize: null };
  }

  return {
    items: payload.items.map(adaptAlert).filter(Boolean),
    total: Number.isFinite(payload.total) ? payload.total : 0,
    page: Number.isFinite(payload.page) ? payload.page : null,
    pageSize: Number.isFinite(payload.page_size) ? payload.page_size : null,
  };
}
