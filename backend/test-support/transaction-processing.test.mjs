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
// Isolated Auth schema fixture; never connect to Supabase's live auth.users.
await db.exec("create schema auth; create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);");
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

test('identity migration provisions disabled users, lockout, and login history', async () => {
  const adminId = '10000000-0000-4000-8000-000000000001';
  const lockedId = '10000000-0000-4000-8000-000000000002';
  await db.query(`insert into auth.users(id,email) values ($1,'admin@example.test'),($2,'locked@example.test')`, [adminId, lockedId]);
  await db.query("update public.user_profiles set role='ADMIN',account_status='ACTIVE' where id=$1", [adminId]);
  const initial = await db.query("select account_status from public.user_profiles where id=$1", [lockedId]);
  assert.equal(initial.rows[0].account_status, 'DISABLED');
  await db.query("update public.user_profiles set account_status='ACTIVE' where id=$1", [lockedId]);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    await db.query("select public.record_login('locked@example.test',false)");
  }
  const profile = await db.query("select account_status,failed_sign_in_attempts,locked_at from public.user_profiles where id=$1", [lockedId]);
  assert.equal(profile.rows[0].account_status, 'LOCKED');
  assert.equal(profile.rows[0].failed_sign_in_attempts, 3);
  assert.ok(profile.rows[0].locked_at);
  assert.equal(Number((await db.query("select count(*) as n from public.login_history where user_id=$1 and outcome='DENIED'", [lockedId])).rows[0].n), 3);
  await db.query("update public.user_profiles set account_status='DISABLED' where id=$1", [adminId]);
});

test('identity migration atomically decides access and revokes sessions on admin lifecycle changes', async () => {
  const adminId = '20000000-0000-4000-8000-000000000001';
  const userId = '20000000-0000-4000-8000-000000000002';
  await db.query(`insert into auth.users(id,email) values ($1,'root@example.test'),($2,'approved@example.test')`, [adminId, userId]);
  await db.query("update public.user_profiles set role='ADMIN',account_status='ACTIVE' where id=$1", [adminId]);
  const requestId = (await db.query(
    "insert into public.access_requests(email,full_name,department,reason) values ('approved@example.test','Approved User','Audit','Needs system access') returning id"
  )).rows[0].id;
  const decision = (await db.query(
    'select public.decide_access_request($1,$2,true,$3,\'SUPERVISOR\',\'Verified by administrator\') as value',
    [adminId, requestId, userId]
  )).rows[0].value;
  assert.equal(decision.status, 'APPROVED');
  const active = await db.query("select role,account_status from public.user_profiles where id=$1", [userId]);
  assert.deepEqual(active.rows[0], { role: 'SUPERVISOR', account_status: 'ACTIVE' });

  const tokenHash = 'a'.repeat(64);
  await db.query('select public.start_app_session($1,$2,now()+interval \'1 hour\')', [userId, tokenHash]);
  await db.query("select public.admin_user_action($1,$2,'disable',null)", [adminId, userId]);
  assert.equal((await db.query('select public.check_app_session($1) as value', [tokenHash])).rows[0].value, null);
  await assert.rejects(db.query("select public.admin_user_action($1,$2,'disable',null)", [adminId, adminId]), /Last active administrator/);
});

test('locked accounts require their own request and an administrator decision to unlock', async () => {
  const adminId = '30000000-0000-4000-8000-000000000001';
  const userId = '30000000-0000-4000-8000-000000000002';
  await db.query(`insert into auth.users(id,email) values ($1,'admin-unlock@example.test'),($2,'locked-request@example.test')`, [adminId, userId]);
  await db.query("update public.user_profiles set role='ADMIN',account_status='ACTIVE' where id=$1", [adminId]);
  await db.query("update public.user_profiles set account_status='ACTIVE' where id=$1", [userId]);
  for (let attempt = 0; attempt < 3; attempt += 1) await db.query("select public.record_login('locked-request@example.test',false)");
  await db.exec('set role service_role');
  try {
    await assert.rejects(() => db.query("select public.admin_user_action($1,$2,'unlock',null)", [adminId, userId]), /Invalid action/);
    await db.query("select public.request_account_unlock('locked-request@example.test')");
    await db.query("select public.request_account_unlock('locked-request@example.test')");
    const requestId = (await db.query("select id from public.account_unlock_requests where user_id=$1 and status='PENDING'", [userId])).rows[0].id;
    assert.equal(Number((await db.query("select count(*) as n from public.account_unlock_requests where user_id=$1 and status='PENDING'", [userId])).rows[0].n), 1);
    const result = (await db.query("select public.decide_account_unlock($1,$2,true,'Identity verified') as result", [adminId, requestId])).rows[0].result;
    assert.equal(result.status, 'APPROVED');
  } finally { await db.exec('reset role'); }
  const profile = (await db.query("select account_status,failed_sign_in_attempts from public.user_profiles where id=$1", [userId])).rows[0];
  assert.equal(profile.account_status, 'ACTIVE');
  assert.equal(profile.failed_sign_in_attempts, 0);
});

const reviewerId = '00000000-0000-4000-8000-000000000015';
const prepareReviewer = async () => {
  await db.query('insert into auth.users(id,email) values($1,$2) on conflict do nothing', [reviewerId, 'reviewer@example.test']);
  await db.query("update public.user_profiles set name='Reviewer One',role='AUDITOR',account_status='ACTIVE' where id=$1", [reviewerId]);
};

test('transaction reviews can reopen and append notes while audit history stays immutable', async () => {
  await prepareReviewer();
  await db.query("insert into public.transactions(id,completeness_status) values('REVIEW-TX','COMPLETE')");
  const record = (action, note = null) => db.query(
    "select public.record_review_action($1,'TRANSACTION','REVIEW-TX',$2,$3)", [reviewerId, action, note]);
  await record('REVIEWED');
  await record('NOTE_ADDED', 'Checked supporting invoice.');
  await record('REOPENED');
  assert.equal(Number((await db.query("select count(*) as n from public.review_records where transaction_id='REVIEW-TX'")).rows[0].n), 3);
  assert.equal(Number((await db.query("select count(*) as n from public.transaction_review_states where transaction_id='REVIEW-TX'")).rows[0].n), 0);
  assert.deepEqual((await db.query("select action from public.audit_events where resource_id='REVIEW-TX' order by id")).rows.map(x => x.action),
    ['TRANSACTION_REVIEWED', 'REVIEW_NOTE_ADDED', 'TRANSACTION_REOPENED']);
  await assert.rejects(db.query("update public.review_records set note='changed' where transaction_id='REVIEW-TX'"), /append-only/);
  await assert.rejects(db.query("delete from public.audit_events where resource_id='REVIEW-TX'"), /append-only/);
});

test('concurrent review transitions allow one winner and serialize alert reopen state', async () => {
  await prepareReviewer();
  await db.query("insert into public.transactions(id,completeness_status) values('REVIEW-RACE','COMPLETE')");
  const call = () => db.query("select public.record_review_action($1,'TRANSACTION','REVIEW-RACE','REVIEWED',null)", [reviewerId]);
  const outcomes = await Promise.allSettled([call(), call()]);
  assert.equal(outcomes.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter(x => x.status === 'rejected').length, 1);
  assert.equal(Number((await db.query("select count(*) as n from public.review_records where transaction_id='REVIEW-RACE'")).rows[0].n), 1);

  await db.query("insert into public.transactions(id,completeness_status) values('REVIEW-ALERT-TX','COMPLETE')");
  await db.query("insert into public.alerts(transaction_id,severity,title,description,reason,risk_score,risk_scoring_version,request_received_at) values('REVIEW-ALERT-TX','HIGH','Alert','Description','Reason',90,'1.0.0',now())");
  const alertId = (await db.query("select id from public.alerts where transaction_id='REVIEW-ALERT-TX'")).rows[0].id;
  await db.query("select public.record_review_action($1,'ALERT',$2,'REVIEWED',null)", [reviewerId, alertId]);
  await db.query("select public.record_review_action($1,'ALERT',$2,'REOPENED',null)", [reviewerId, alertId]);
  const alert = (await db.query("select status,reviewed_at from public.alerts where id=$1", [alertId])).rows[0];
  assert.equal(alert.status, 'ACTIVE');
  assert.equal(alert.reviewed_at, null);
  assert.equal(Number((await db.query("select count(*) as n from public.review_records where alert_id=$1", [alertId])).rows[0].n), 2);
});

test('login history writes append attributable security activity', async () => {
  await prepareReviewer();
  await db.query("insert into public.login_history(user_id,action,outcome) values($1,'SIGN_IN','SUCCESS')", [reviewerId]);
  const event = (await db.query("select actor_name,actor_role,action,resource_type,outcome from public.audit_events where action='LOGIN_SUCCESS'")).rows[0];
  assert.deepEqual(event, { actor_name: 'Reviewer One', actor_role: 'AUDITOR', action: 'LOGIN_SUCCESS', resource_type: 'ACCOUNT', outcome: 'SUCCESS' });
  await db.query("insert into public.login_history(user_id,action,outcome) values($1,'SIGN_IN','DENIED')", [reviewerId]);
  const failed = (await db.query("select actor_name,action,outcome from public.audit_events where action='LOGIN_FAILED'")).rows[0];
  assert.deepEqual(failed, { actor_name: 'Reviewer One', action: 'LOGIN_FAILED', outcome: 'FAILED' });
});

test('accountability RPC and history tables expose append-only least privilege', async () => {
  const privileges = (await db.query(`select
    has_function_privilege('anon','public.record_review_action(uuid,text,text,text,text)','execute') as anon_execute,
    has_function_privilege('authenticated','public.record_review_action(uuid,text,text,text,text)','execute') as auth_execute,
    has_function_privilege('service_role','public.record_review_action(uuid,text,text,text,text)','execute') as service_execute,
    has_table_privilege('service_role','public.review_records','insert') as review_insert,
    has_table_privilege('service_role','public.review_records','update') as review_update,
    has_table_privilege('service_role','public.audit_events','delete') as event_delete`)).rows[0];
  assert.deepEqual(privileges, {
    anon_execute: false, auth_execute: false, service_execute: true,
    review_insert: false, review_update: false, event_delete: false,
  });
});

test.after(async () => { await db.close(); });
