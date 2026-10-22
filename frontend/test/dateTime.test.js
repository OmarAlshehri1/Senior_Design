import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  formatDateOnly, formatDate, formatTimestamp, formatTime, formatUtcDate, formatUtcTimestamp,
  getDateTimePresentation,
} from '../src/utils/dateTime.js';
import { businessReportRequest } from '../src/services/businessReportsService.js';
import { createAuditService } from '../src/audit/auditService.js';
import { createTransactionsService } from '../src/services/transactionsService.js';
import { sortTransactions } from '../src/utils/transactions.js';

test('UTC microsecond timestamp displays in Riyadh with English months and a 24-hour clock', () => {
  const raw = '2026-10-19T14:10:38.816954+00:00';
  assert.equal(formatTimestamp(raw), '19 Oct 2026, 17:10:38 (UTC+3)');
  assert.equal(formatTimestamp(raw, { showZone: false }), '19 Oct 2026, 17:10:38');
  assert.equal(formatTime(raw), '17:10:38 (UTC+3)');
  assert.equal(formatDate(raw), '19 Oct 2026');
});

test('Riyadh conversion crosses midnight, month and year boundaries without a 24:00 clock', () => {
  assert.equal(formatTimestamp('2026-10-19T22:30:00Z'), '20 Oct 2026, 01:30:00 (UTC+3)');
  assert.equal(formatTimestamp('2026-12-31T21:00:00Z'), '1 Jan 2027, 00:00:00 (UTC+3)');
  assert.equal(formatTimestamp('2026-03-01T00:15:00+05:30'), '28 Feb 2026, 21:45:00 (UTC+3)');
});

test('calendar-only values never acquire a time or offset', () => {
  assert.equal(formatDateOnly('2022-01-03'), '3 Jan 2022');
  assert.equal(formatTimestamp('2022-01-03'), '3 Jan 2022');
  assert.equal(formatUtcDate('2022-01-03'), '3 Jan 2022');
  assert.equal(formatTime('2022-01-03'), '—');
  assert.deepEqual(getDateTimePresentation('2022-01-03'), { kind: 'date', date: '3 Jan 2022', time: null, zone: null });
  assert.equal(formatDateOnly('2024-02-29'), '29 Feb 2024');
  assert.equal(formatDateOnly('1900-02-29'), '—');
  assert.equal(formatDateOnly('2000-02-29'), '29 Feb 2000');
  assert.equal(formatTimestamp('2026-09-01T00:00:00Z'), '1 Sep 2026, 03:00:00 (UTC+3)');
  assert.equal(formatDateOnly('2026-09-01'), '1 Sep 2026');
});

test('missing and malformed values never throw, normalize invalid days or render Invalid Date', () => {
  for (const raw of [null, undefined, '', ' ', 'invalid', {}, 0, '2026-02-30',
    '2026-02-30T14:10:38Z', '2026-10-19T25:00:00Z', '2026-10-19T14:61:00Z',
    '2026-10-19T14:10:38+24:00', '2026-10-19T14:10:38+03:60']) {
    assert.equal(formatTimestamp(raw), '—');
    assert.equal(formatTime(raw), '—');
    assert.equal(formatUtcDate(raw), '—');
  }
});

test('offset-free timestamps and explicitly unknown offsets do not acquire a timezone', () => {
  assert.equal(formatTimestamp('2026-10-19T14:10:38'), 'Unknown timezone');
  assert.equal(formatTime('2026-10-19T14:10:38'), 'Unknown timezone');
  assert.equal(formatTimestamp('2026-10-19T14:10:38-00:00'), 'Unknown timezone');
});

test('calendar and timestamp display is independent of the host/browser timezone', () => {
  const moduleUrl = new URL('../src/utils/dateTime.js', import.meta.url).href;
  for (const TZ of ['America/Los_Angeles', 'Asia/Tokyo']) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import {formatTimestamp} from ${JSON.stringify(moduleUrl)};
      process.stdout.write(JSON.stringify([
        formatTimestamp('2022-01-03'),
        formatTimestamp('2026-10-19T14:10:38Z'),
        formatTimestamp('2026-10-19T14:10:38')
      ]));
    `], { env: { ...process.env, TZ }, encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout), ['3 Jan 2022', '19 Oct 2026, 17:10:38 (UTC+3)', 'Unknown timezone']);
  }
});

test('UTC report dates and exact-day generation retain UTC boundaries across local midnight', () => {
  assert.equal(formatUtcDate('2026-10-19T22:30:00Z'), '19 Oct 2026');
  assert.equal(formatUtcTimestamp('2026-10-19T22:30:00Z'), '19 Oct 2026, 22:30:00');
  assert.deepEqual(businessReportRequest({ day: '2026-10-19' }), {
    data_context: 'UNVERIFIED', period_start: '2026-10-19T00:00:00.000Z', period_end: '2026-10-20T00:00:00.000Z',
  });
});

test('formatting does not replace raw chronological sorting values or UTC API filters', async () => {
  const rows = Object.freeze([
    Object.freeze({ id: 'earlier', timestamp: '2026-10-19T23:30:00+03:00' }),
    Object.freeze({ id: 'later', timestamp: '2026-10-19T21:00:00Z' }),
  ]);
  rows.forEach((row) => formatTimestamp(row.timestamp));
  assert.deepEqual(sortTransactions(rows, 'newest').map((row) => row.id), ['later', 'earlier']);
  assert.equal(rows[0].timestamp, '2026-10-19T23:30:00+03:00');
  const calls = [];
  const client = { get: async (path, options) => { calls.push({ path, query: options.query }); return { items: [], total: 0 }; } };
  await createAuditService(client).getAuditEvents({ date: '2026-10-19', sort: 'NEWEST', page: 2 });
  await createTransactionsService(client).list({ query: { sort_by: 'newest', page: 3, page_size: 10 } });
  assert.deepEqual(calls, [
    { path: '/audit-events', query: { date: '2026-10-19', sort: 'NEWEST', page: 2 } },
    { path: '/transactions', query: { sort_by: 'newest', page: 3, page_size: 10 } },
  ]);
});
