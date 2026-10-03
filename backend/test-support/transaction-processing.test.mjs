import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';

// For a temporary install, set PGLITE_PACKAGE_JSON to its package.json.
// Otherwise npm install in this directory, then npm test.
const require = createRequire(process.env.PGLITE_PACKAGE_JSON || import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite')));
const { pgcrypto } = await import(pathToFileURL(require.resolve('@electric-sql/pglite/contrib/pgcrypto')));
const db = new PGlite({ extensions: { pgcrypto } });
const migrationDir = fileURLToPath(new URL('../migrations/', import.meta.url));
await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
for (const file of (await readdir(migrationDir)).filter(x => x.endsWith('.sql')).sort()) {
  await db.exec(await readFile(`${migrationDir}/${file}`, 'utf8'));
}
const input = id => ({ id, data_quality_status: 'PARTIAL', missing_fields: ['approval_limit'], amount: 10 });
const bundle = id => ({
  rule_version: '1.0.0', model_version: '1.0.0', risk_version: '1.0.0',
  anomaly: { threshold: 90.6, is_anomalous: true },
  result: { ...input(id), rule_status: 'REVIEW', rule_score: 100, ai_score: 100,
    risk_score: 100, risk_level: 'HIGH', rule_results: [], explanation: null },
});
const create = (id, value = input(id)) => db.query(
  'select public.create_transaction_with_job($1::jsonb, now())', [JSON.stringify(value)]);
const claim = async id => (await db.query('select public.claim_transaction_job($1) as job', [id])).rows[0].job;
const finish = async (id, token, value = bundle(id)) => (await db.query(
  'select public.finish_transaction_job($1, $2::uuid, $3::jsonb) as job',
  [id, token, JSON.stringify(value)])).rows[0].job;
const release = (id, token) => db.query('select public.release_transaction_job($1,$2::uuid)', [id, token]);
const count = async (table, id) => Number((await db.query(
  `select count(*) as n from public.${table} where transaction_id=$1`, [id])).rows[0].n);
const tables = ['transaction_evaluations', 'transaction_anomaly_scores', 'transaction_risk_scores', 'alerts'];
await db.exec("create function public.test_fail() returns trigger language plpgsql as $$ begin raise exception 'injected isolated failure'; end; $$;");

test('source and recovery job roll back together', async () => {
  await db.exec('create trigger test_fail before insert on public.transaction_processing_jobs for each row execute function public.test_fail();');
  try {
    await assert.rejects(create('ATOMIC-CREATE'), /injected isolated failure/);
    assert.equal(Number((await db.query("select count(*) as n from public.transactions where id='ATOMIC-CREATE'")).rows[0].n), 0);
  } finally { await db.exec('drop trigger test_fail on public.transaction_processing_jobs'); }
});

test('duplicate/concurrent IDs never overwrite source', async () => {
  const responses = await Promise.allSettled([create('DUPLICATE'), create('DUPLICATE', { ...input('DUPLICATE'), amount: 99 })]);
  assert.equal(responses.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(responses.find(x => x.status === 'rejected').reason.code, '23505');
  assert.equal(await count('transaction_processing_jobs', 'DUPLICATE'), 1);
  assert.equal(Number((await db.query("select amount from public.transactions where id='DUPLICATE'")).rows[0].amount), 10);
});

for (const boundary of [...tables, 'transaction_processing_jobs']) {
  test(`partial failure at ${boundary} rolls all derived state back and retries once`, async () => {
    const id = `FAIL-${boundary}`;
    await create(id);
    const job = await claim(id);
    await db.exec(`create trigger test_fail before ${boundary === 'transaction_processing_jobs' ? 'update' : 'insert'} on public.${boundary} for each row execute function public.test_fail();`);
    try { await assert.rejects(finish(id, job.lease_token), /injected isolated failure/); }
    finally { await db.exec(`drop trigger test_fail on public.${boundary}`); }
    for (const table of tables) assert.equal(await count(table, id), 0);
    await release(id, job.lease_token);
    assert.equal(await claim(id), null); // failed work backs off
    await db.query('update public.transaction_processing_jobs set available_at=now() where transaction_id=$1', [id]);
    const reclaimed = await claim(id);
    const complete = await finish(id, reclaimed.lease_token);
    assert.equal(complete.status, 'COMPLETED');
    assert.equal(complete.event_pending, true);
    assert.equal(complete.alert_event.transaction_id, id);
    // Replay a lost commit response. No duplicate snapshots or alerts.
    const replayed = await finish(id, reclaimed.lease_token);
    assert.deepEqual(replayed.result, complete.result);
    for (const table of tables) assert.equal(await count(table, id), 1);
  });
}

test('expired/reclaimed lease fences old workers; completed result is replayable', async () => {
  await create('RESTART');
  const first = await claim('RESTART');
  assert.equal(await claim('RESTART'), null);
  await db.query("update public.transaction_processing_jobs set lease_until=now()-interval '1 second' where transaction_id='RESTART'");
  const second = await claim('RESTART');
  assert.notEqual(first.lease_token, second.lease_token);
  await assert.rejects(finish('RESTART', first.lease_token), /Processing lease expired/);
  await release('RESTART', first.lease_token);
  assert.equal(await claim('RESTART'), null);
  await finish('RESTART', second.lease_token);
  assert.equal((await claim('RESTART')).status, 'COMPLETED');
});

test('invalid risk policy cannot partially persist', async () => {
  await create('POLICY'); const job = await claim('POLICY');
  const value = bundle('POLICY'); value.result.risk_score = 99;
  await assert.rejects(finish('POLICY', job.lease_token, value), /Risk policy mismatch/);
  for (const table of tables) assert.equal(await count(table, 'POLICY'), 0);
});

test('low and insufficient scores complete without fabricating alerts or risk', async () => {
  for (const insufficient of [false, true]) {
    const id = insufficient ? 'INSUFFICIENT' : 'LOW';
    await create(id); const job = await claim(id); const value = bundle(id);
    value.result.rule_status = insufficient ? 'NOT_EVALUATED' : 'PASSED';
    value.result.rule_score = insufficient ? null : 0;
    value.result.ai_score = 25;
    value.result.risk_score = insufficient ? null : 10;
    value.result.risk_level = insufficient ? null : 'LOW';
    value.anomaly.is_anomalous = false;
    const result = await finish(id, job.lease_token, value);
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.event_pending, false);
    assert.equal(await count('alerts', id), 0);
    assert.equal(await count('transaction_risk_scores', id), insufficient ? 0 : 1);
  }
});

test('pending selection excludes active leases and delayed failed work', async () => {
  await create('READY'); await create('LEASED'); await create('DELAYED');
  await claim('LEASED'); const delayed = await claim('DELAYED');
  await release('DELAYED', delayed.lease_token);
  const ids = (await db.query('select * from public.get_pending_transaction_jobs(100)')).rows.map(x => x.transaction_id);
  assert.ok(ids.includes('READY'));
  assert.ok(!ids.includes('LEASED'));
  assert.ok(!ids.includes('DELAYED'));
});

test('unprivileged callers cannot execute processing RPCs', async () => {
  await db.exec('set role anon');
  try { await assert.rejects(create('UNAUTHORIZED'), /permission denied/); }
  finally { await db.exec('reset role'); }
});

test('durable event pending state survives dump and restore', async () => {
  const restored = new PGlite({ loadDataDir: await db.dumpDataDir(), extensions: { pgcrypto } });
  try {
    assert.equal((await restored.query("select status, event_pending from public.transaction_processing_jobs where transaction_id='RESTART'")).rows[0].event_pending, true);
  } finally { await restored.close(); }
});

test.after(async () => { await db.close(); });
