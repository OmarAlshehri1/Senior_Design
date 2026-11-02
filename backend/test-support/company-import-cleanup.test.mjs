import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewFixture } from './feed-review-fixture.mjs';

test('draft cleanup is bounded, owner-only and preserves confirmed, fresh and receipt-bearing evidence', async () => {
  const { db, users } = await createReviewFixture();
  const document = { filename: 'SYNTHETIC.csv', records: [{ row: 2, record: { reference: 'SYNTHETIC' } }] };
  const add = async (created, expiry, confirmed = false, receipts = null) => (await db.query(
    `insert into company_import_batches(source_id,actor_id,document,created_at,expires_at,confirmed_at,receipts)
     values('SYNTHETIC-A',$1,$2,clock_timestamp()+$3::interval,clock_timestamp()+$4::interval,
            case when $5 then clock_timestamp()-interval '1 hour' end,$6) returning id`,
    [users.admin, JSON.stringify(document), created, expiry, confirmed, receipts === null ? null : JSON.stringify(receipts)]
  )).rows[0].id;
  const cleanup = async (limit = 100) => (await db.query('select cleanup_expired_company_imports($1) value', [limit])).rows[0].value;
  const count = async (table) => (await db.query(`select count(*)::int n from ${table}`)).rows[0].n;
  try {
    const evidenceTables = ['ingestion_receipts', 'ingestion_validations', 'feed_transactions', 'feed_audit_jobs', 'feed_audit_results'];
    const beforeCounts = await Promise.all(evidenceTables.map(count));
    const oldest = await add('-3 days', '-2 days');
    const next = await add('-2 days', '-1 day');
    const fresh = await add('-1 hour', '23 hours');
    const extended = await add('-2 days', '1 hour');
    const confirmed = await add('-2 days', '-1 day', true, { inserted: 1, items: [] });
    const receiptBearing = await add('-2 days', '-1 day', false, { inserted: 1, items: [] });
    const prematurelyExpired = await add('-1 hour', '-1 minute');
    const retained = [fresh, extended, confirmed, receiptBearing, prematurelyExpired];
    const before = (await db.query('select id,document,preview,receipts,confirmed_at from company_import_batches where id=any($1::uuid[]) order by id', [retained])).rows;
    for (const invalid of [0, 101, null]) await assert.rejects(cleanup(invalid), /between 1 and 100/);
    const first = await cleanup(1);
    assert.equal(first.deleted_batches, 1); assert.equal(first.skipped_busy, false);
    assert.equal((await db.query('select count(*)::int n from company_import_batches where id=$1', [oldest])).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int n from company_import_batches where id=$1', [next])).rows[0].n, 1);
    assert.equal((await cleanup()).deleted_batches, 1);
    assert.equal((await cleanup()).deleted_batches, 0);
    assert.deepEqual((await db.query('select id,document,preview,receipts,confirmed_at from company_import_batches where id=any($1::uuid[]) order by id', [retained])).rows, before);
    assert.deepEqual(await Promise.all(evidenceTables.map(count)), beforeCounts);
    assert.equal(await count('company_import_cleanup_runs'), 3);
    const columns = (await db.query("select column_name from information_schema.columns where table_name='company_import_cleanup_runs' order by ordinal_position")).rows.map(r => r.column_name);
    assert.deepEqual(columns, ['id', 'started_at', 'completed_at', 'deleted_batches', 'batch_limit']);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(cleanup(), /permission denied/);
        await assert.rejects(db.query('select * from company_import_cleanup_runs'), /permission denied/);
      } finally { await db.exec('reset role'); }
    }
  } finally { await db.close(); }
});
