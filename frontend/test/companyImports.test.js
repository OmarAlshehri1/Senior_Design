import test from 'node:test';
import assert from 'node:assert/strict';
import { createImportMapping, restoreImportMapping } from '../src/services/companyImportMapping.js';
import { hasPermission, PERMISSIONS } from '../src/auth/roles.js';
import { getRoutePermission } from '../src/auth/routeAccess.js';

test('company imports require a distinct Admin permission', () => {
  assert.equal(getRoutePermission('/imports'), PERMISSIONS.IMPORT_TRANSACTIONS);
  assert.equal(hasPermission('ADMIN', PERMISSIONS.IMPORT_TRANSACTIONS), true);
  for (const role of ['AUDITOR', 'SUPERVISOR', 'UNKNOWN']) assert.equal(hasPermission(role, PERMISSIONS.IMPORT_TRANSACTIONS), false);
});

test('declared mapping preserves company columns and never supplies missing business values', () => {
  const settings = { decimal: ',', thousands: '.', timeFormat: '%d/%m/%Y', currencies: 'USD, SAR', actorNamespace: '', vendorNamespace: '' };
  const mapping = createImportMapping({ amount: 'Payment_Value', timestamp: 'PostingDate' }, settings);
  assert.deepEqual(mapping.fields.amount.path, ['Payment_Value']);
  assert.deepEqual(mapping.fields.amount.number, { decimal_separator: ',', thousands_separator: '.', unit_scale: '1' });
  assert.equal(mapping.fields.timestamp.time.precision, 'date');
  assert.equal(mapping.fields.approved_by, undefined);
  assert.equal(mapping.fields.currency, undefined);
  const restored = restoreImportMapping({ mapping, identity_column: 'Ref' });
  assert.equal(restored.identity, 'Ref');
  assert.deepEqual(createImportMapping(restored.columns, restored.settings), mapping);
});
