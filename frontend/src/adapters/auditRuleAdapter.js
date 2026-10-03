const FIELD_LABELS = Object.freeze({
  created_by: 'Creator ID', approved_by: 'Approver ID', amount: 'Transaction Amount',
  approval_limit: 'Approval Limit', invoice_number: 'Invoice Number',
  vendor_id: 'Vendor ID', vendor_name: 'Vendor Name', timestamp: 'Transaction Timestamp',
});
const CATEGORIES = Object.freeze({
  segregation_of_duties: 'Internal Control', approval_limits: 'Authorization Control',
  duplicate_payment: 'Payment Control', invoice_splitting: 'Approval Control', ghost_vendors: 'Vendor Control',
});
const UI_KEYS = Object.freeze({ approval_limits: 'approvalLimit', ghost_vendors: 'ghostVendor' });

export function adaptAuditRule(value) {
  if (!value || typeof value !== 'object' || typeof value.key !== 'string') return null;
  const alternatives = Array.isArray(value.required_any_of) ? value.required_any_of
    .filter(Array.isArray).map((group) => group.map((field) => FIELD_LABELS[field] ?? field).join(' or ')) : [];
  const required = Array.isArray(value.required_fields) ? value.required_fields.map((field) => FIELD_LABELS[field] ?? field) : [];
  const key = UI_KEYS[value.key] ?? value.key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  return Object.freeze({
    id: value.id ?? null, key, name: value.name ?? value.key,
    category: value.category ?? CATEGORIES[value.key] ?? 'Audit Control',
    description: value.description ?? '', requiredFields: Object.freeze([...required, ...alternatives]),
    evaluation: value.description ?? '', configurationNote: 'Inputs and historical context follow the authoritative audit rule implementation.',
    enabled: value.enabled === true, version: value.version ?? null,
    status: value.enabled === true ? 'Active' : 'Disabled',
  });
}

export function adaptAuditRuleCollection(value) {
  if (!value || !Array.isArray(value.items)) return Object.freeze([]);
  return Object.freeze(value.items.map(adaptAuditRule).filter(Boolean));
}
