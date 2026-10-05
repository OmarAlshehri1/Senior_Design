import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('test-transaction control is gated by the Vite development flag', async () => {
  const source = await readFile(
    new URL('../src/pages/Dashboard.jsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /import\.meta\.env\.DEV\s*&&/);
  assert.doesNotMatch(source, /import\.meta\.env\.(?:MODE|PROD)/);
});

test('vendor profile renders authoritative records, decisions, and monitoring history', async () => {
  const source = await readFile(
    new URL('../src/pages/VendorProfile.jsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /vendorsService\.getVendor/);
  assert.match(source, /Related audit records/);
  assert.match(source, /Monitoring history/);
  assert.match(source, /reviewVendorWatchlistRequest/);
  assert.doesNotMatch(source, /sections are unavailable/);
  assert.doesNotMatch(source, /role="tab"/);
});
