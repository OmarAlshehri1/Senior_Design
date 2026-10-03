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

test('vendor profile section controls are explicitly unavailable', async () => {
  const source = await readFile(
    new URL('../src/pages/VendorProfile.jsx', import.meta.url),
    'utf8'
  );

  assert.match(source, /<button key=\{label\} type="button" disabled/);
  assert.doesNotMatch(source, /role="tab"/);
});
