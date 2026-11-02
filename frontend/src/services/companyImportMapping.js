export const IMPORT_FIELDS = Object.freeze({
  timestamp: 'Transaction date / time', amount: 'Amount', currency: 'Currency',
  vendor_id: 'Supplier reference', vendor_name: 'Supplier name', invoice_number: 'Invoice number',
  created_by: 'Created by', approved_by: 'Approved by', approval_limit: 'Source approval limit',
  approver_role: 'Approver role', category: 'Department / category',
});

export function createImportMapping(columns, settings) {
  const fields = {};
  for (const field of Object.keys(IMPORT_FIELDS)) {
    if (!columns[field]) continue;
    fields[field] = { path: [columns[field]] };
    if (field === 'amount' || field === 'approval_limit') {
      fields[field].number = { decimal_separator: settings.decimal,
        thousands_separator: settings.thousands || null, unit_scale: '1' };
    }
    if (field === 'timestamp') {
      fields[field].time = settings.timeFormat === 'iso8601'
        ? { precision: 'instant', format: 'iso8601' }
        : { precision: 'date', format: settings.timeFormat };
    }
  }
  return { schema_version: '1.0', fields,
    supported_currencies: settings.currencies.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
    actor_namespace: settings.actorNamespace || null, vendor_namespace: settings.vendorNamespace || null };
}

export function restoreImportMapping(profile) {
  const fields = profile.mapping.fields;
  const number = fields.amount?.number || fields.approval_limit?.number;
  return { columns: Object.fromEntries(Object.entries(fields).map(([key, value]) => [key, value.path[0]])),
    identity: profile.identity_column, settings: { decimal: number?.decimal_separator || '.',
      thousands: number?.thousands_separator || '', timeFormat: fields.timestamp?.time?.format || 'iso8601',
      currencies: profile.mapping.supported_currencies.join(','),
      actorNamespace: profile.mapping.actor_namespace || '', vendorNamespace: profile.mapping.vendor_namespace || '' } };
}
