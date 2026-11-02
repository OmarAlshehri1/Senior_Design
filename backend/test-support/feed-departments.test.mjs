import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewFixture } from './feed-review-fixture.mjs';

test('department groups and listing preserve exact currencies, missing labels, scope and bounded output', async () => {
  const { db, users, teams, add } = await createReviewFixture();
  const rpc = async (sql, args) => {
    await db.exec('set role service_role');
    try { return (await db.query(sql, args)).rows[0].value; }
    finally { await db.exec('reset role'); }
  };
  const report = (actor = users.admin, team = null, start = null, end = null, source = 'SYNTHETIC-A') =>
    rpc('select read_feed_summary_report($1,$2,$3,$4,$5) value', [actor, source, start, end, team]);
  try {
    const finance = await add(6, { category: ' Finance ', amount: '123456789012345678.01' });
    await add(7, { category: 'Finance', currency: 'EUR', amount: '20.02', pending: true });
    await add(8, { category: ' ', amount: '1.01' });
    await add(9, { source: 'SYNTHETIC-B', category: 'PRIVATE OTHER SOURCE', amount: '999.99' });
    const full = await report();
    const usd = full.departments.find(row => row.category === 'Finance' && row.currency === 'USD');
    const eur = full.departments.find(row => row.category === 'Finance' && row.currency === 'EUR');
    assert.equal(usd.recorded_amount, '123456789012345678.01');
    assert.equal(usd.completed, 1);
    assert.equal(eur.recorded_amount, '20.02'); assert.equal(eur.completed, 0);
    assert.equal(full.departments.reduce((sum, row) => sum + row.transactions, 0), full.counts.transactions);
    assert.equal(full.departments.find(row => row.category === 'Uncategorized' && row.currency === 'USD').recorded_amount, '71.71');
    assert.equal(full.schedule.find(row => row.id === finance).category, 'Finance');
    assert(!JSON.stringify(full).includes('PRIVATE OTHER SOURCE'));
    const listing = await rpc('select read_review_feed($1,$2,1,100,null) value', [users.admin, 'SYNTHETIC-A']);
    assert.equal(listing.items.find(row => row.id === finance).category, 'Finance');
    assert.equal(listing.items.find(row => row.record_id === 'SYNTHETIC-row-8').category, null);
    for (const scoped of [await report(users.supervisor), await report(users.admin, teams.A)]) {
      assert.equal(scoped.counts.transactions, 1);
      assert.equal(scoped.departments.length, 1);
      assert.equal(scoped.departments[0].category, 'Uncategorized');
      assert.equal(scoped.departments[0].recorded_amount, '10.10');
    }
    const period = await report(users.admin, null, '2026-10-24T10:06:00Z', '2026-10-24T10:07:00Z');
    assert.equal(period.departments.length, 1); assert.equal(period.departments[0].category, 'Finance');
    await assert.rejects(report(users.admin, null, null, null, 'SYNTHETIC-B'), /denied/);
    await assert.rejects(report(users.auditor), /denied/);
    await assert.rejects(report(users.supervisor, teams.B), /eligible/);
    for (let i = 10; i < 111; i++) await add(i, { category: `Department ${i}`, pending: true });
    const large = await report();
    assert.equal(large.departments.length, 100);
    assert(large.departments_group_count > 100); assert.equal(large.departments_truncated, true);
    assert.equal(large.schedule.length, 100);
    const empty = await report(users.admin, null, '2030-01-01T00:00:00Z', '2030-01-02T00:00:00Z');
    assert.deepEqual(empty.departments, []); assert.equal(empty.departments_group_count, 0);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try { await assert.rejects(db.query('select read_feed_summary_report($1,$2)', [users.admin, 'SYNTHETIC-A']), /permission denied/); }
      finally { await db.exec('reset role'); }
    }
  } finally { await db.close(); }
});
