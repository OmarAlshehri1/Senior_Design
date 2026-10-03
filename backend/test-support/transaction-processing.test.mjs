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
  try {
    await db.exec(await readFile(`${migrationDir}/${file}`, 'utf8'));
  } catch (error) {
    throw new Error(`Migration ${file} failed: ${error.message?.split('\n')[0] ?? 'unknown SQL error'} (${error.code ?? 'no code'})`);
  }
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
  const reviewState = (await db.query("select status from public.transaction_review_states where transaction_id='REVIEW-TX'")).rows[0];
  assert.equal(reviewState.status, 'ACTIVE');
  assert.deepEqual((await db.query("select action from public.audit_events where resource_id='REVIEW-TX' order by id")).rows.map(x => x.action),
    ['TRANSACTION_REVIEWED', 'REVIEW_NOTE_ADDED', 'TRANSACTION_REOPENED']);
  await assert.rejects(db.query("update public.review_records set note='changed' where transaction_id='REVIEW-TX'"), /append-only/);
  await assert.rejects(db.query("delete from public.audit_events where resource_id='REVIEW-TX'"), /append-only/);
  await assert.rejects(db.query("delete from public.transactions where id='REVIEW-TX'"), /foreign key|violates/);
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
  await db.query("update public.user_profiles set role='ADMIN' where id=$1", [reviewerId]);
  await db.query("select public.record_review_action($1,'ALERT',$2,'REVIEWED',null)", [reviewerId, alertId]);
  await db.query("select public.record_review_action($1,'ALERT',$2,'REOPENED',null)", [reviewerId, alertId]);
  const alert = (await db.query("select status,reviewed_at from public.alerts where id=$1", [alertId])).rows[0];
  assert.equal(alert.status, 'ACTIVE');
  assert.equal(alert.reviewed_at, null);
  assert.equal(Number((await db.query("select count(*) as n from public.review_records where alert_id=$1", [alertId])).rows[0].n), 2);
  await assert.rejects(db.query("delete from public.alerts where id=$1", [alertId]), /foreign key|violates/);
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

const teamUsers = {
  admin: '00000000-0000-4000-8000-000000000016',
  supervisorA: '00000000-0000-4000-8000-000000000017',
  supervisorB: '00000000-0000-4000-8000-000000000018',
  auditorA: '00000000-0000-4000-8000-000000000019',
  auditorB: '00000000-0000-4000-8000-000000000020',
};
let teamA; let teamB; let teamAlertA; let teamAlertB;
const prepareTeams = async () => {
  if (teamA) return;
  const entries = Object.entries(teamUsers);
  await db.query(`insert into auth.users(id,email) values ${entries.map((_, i) => `($${i + 1},$${i + entries.length + 1})`).join(',')} on conflict do nothing`,
    [...entries.map(([, id]) => id), ...entries.map(([name]) => `phase16-${name}@example.test`)]);
  for (const [key, id] of entries) {
    const role = key === 'admin' ? 'ADMIN' : key.startsWith('supervisor') ? 'SUPERVISOR' : 'AUDITOR';
    await db.query('update public.user_profiles set name=$2,role=$3,account_status=\'ACTIVE\' where id=$1', [id, key, role]);
  }
  const first = (await db.query("select public.manage_audit_team($1,'CREATE',null,'Team A',$2) as value", [teamUsers.admin, teamUsers.supervisorA])).rows[0].value;
  const second = (await db.query("select public.manage_audit_team($1,'CREATE',null,'Team B',$2) as value", [teamUsers.admin, teamUsers.supervisorB])).rows[0].value;
  teamA = first.id; teamB = second.id;
  await db.query("select public.set_audit_team_member($1,$2,$3,'ADD')", [teamUsers.supervisorA, teamA, teamUsers.auditorA]);
  await db.query("select public.set_audit_team_member($1,$2,$3,'ADD')", [teamUsers.admin, teamB, teamUsers.auditorB]);
  await create('TEAM-TX-A'); await create('TEAM-TX-B'); await create('TEAM-TX-UNCLAIMED');
  for (const transactionId of ['TEAM-TX-A', 'TEAM-TX-B', 'TEAM-TX-UNCLAIMED']) {
    await db.query(`insert into public.alerts(transaction_id,severity,title,description,reason,risk_score,risk_scoring_version,request_received_at)
      values($1,'HIGH','Alert','Description','Reason',90,'1.0.0',now())`, [transactionId]);
  }
  teamAlertA = (await db.query("select id from public.alerts where transaction_id='TEAM-TX-A'")).rows[0].id;
  teamAlertB = (await db.query("select id from public.alerts where transaction_id='TEAM-TX-B'")).rows[0].id;
  await db.query("select public.record_alert_assignment($1,$2,'ASSIGNED',$3,null)", [teamUsers.supervisorA, teamAlertA, teamUsers.auditorA]);
  await db.query("select public.record_alert_assignment($1,$2,'ASSIGNED',$3,null)", [teamUsers.supervisorB, teamAlertB, teamUsers.auditorB]);
};

test('team alert visibility enforces assigned Auditor and team Supervisor scopes', async () => {
  await prepareTeams();
  const can = async (actor, alert) => (await db.query('select public.can_access_team_alert($1,$2) as allowed', [actor, alert])).rows[0].allowed;
  assert.equal(await can(teamUsers.auditorA, teamAlertA), true);
  assert.equal(await can(teamUsers.auditorA, teamAlertB), false);
  assert.equal(await can(teamUsers.supervisorA, teamAlertA), true);
  assert.equal(await can(teamUsers.supervisorA, teamAlertB), false);
  const queue = (await db.query('select public.list_accessible_alerts($1,1,100,null) as page', [teamUsers.supervisorA])).rows[0].page;
  assert.ok(queue.items.some(row => row.id === teamAlertA));
  assert.ok(queue.items.some(row => row.transaction_id === 'TEAM-TX-UNCLAIMED'));
  assert.ok(!queue.items.some(row => row.id === teamAlertB));
  const teamCandidates = (await db.query('select public.list_team_member_candidates($1,$2) as value', [teamUsers.supervisorA, teamA])).rows[0].value;
  assert.ok(teamCandidates.some(row => row.id === teamUsers.auditorA));
  assert.ok(!teamCandidates.some(row => row.id === teamUsers.auditorB));
  await assert.rejects(db.query('select public.list_team_member_candidates($1,$2)', [teamUsers.supervisorA, teamB]), /Team membership denied/);
  const auditorPage = (await db.query('select public.list_accessible_alerts($1,1,100,null) as page', [teamUsers.auditorA])).rows[0].page;
  assert.deepEqual(auditorPage.items.map(row => row.id), [teamAlertA]);
  await assert.rejects(db.query('select public.get_alert_assignment_bundle($1,$2)', [teamUsers.supervisorA, teamAlertB]), /Alert access denied/);
});

test('assignment targets, concurrent writes, unassignment history, and membership locks are enforced', async () => {
  await prepareTeams();
  await assert.rejects(db.query("select public.record_alert_assignment($1,$2,'ASSIGNED',$3,null)", [teamUsers.supervisorA, teamAlertB, teamUsers.auditorA]), /Cross-team assignment denied/);
  const otherQueueAlert = (await db.query("select id from public.alerts where transaction_id='TEAM-TX-UNCLAIMED'")).rows[0].id;
  const outcomes = await Promise.allSettled([
    db.query("select public.record_alert_assignment($1,$2,'ASSIGNED',$3,null)", [teamUsers.supervisorA, otherQueueAlert, teamUsers.auditorA]),
    db.query("select public.record_alert_assignment($1,$2,'ASSIGNED',$3,null)", [teamUsers.supervisorA, otherQueueAlert, teamUsers.supervisorA]),
  ]);
  assert.equal(outcomes.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(Number((await db.query('select count(*) as n from public.alert_assignment_history where alert_id=$1', [otherQueueAlert])).rows[0].n), 1);
  await assert.rejects(db.query("select public.set_audit_team_member($1,$2,$3,'REMOVE')", [teamUsers.supervisorA, teamA, teamUsers.auditorA]), /Reassign or unassign active alerts/);
  const current = (await db.query('select assignee_id from public.alert_assignments where alert_id=$1', [otherQueueAlert])).rows[0];
  await db.query("select public.record_alert_assignment($1,$2,'UNASSIGNED',null,'Return to queue')", [teamUsers.supervisorA, otherQueueAlert]);
  assert.equal((await db.query('select status,assignee_id from public.alert_assignments where alert_id=$1', [otherQueueAlert])).rows[0].status, 'UNASSIGNED');
  assert.notEqual(current.assignee_id, null);
  assert.equal(Number((await db.query('select count(*) as n from public.alert_assignment_history where alert_id=$1', [otherQueueAlert])).rows[0].n), 2);
  await assert.rejects(db.query('delete from public.alert_assignment_history where alert_id=$1', [otherQueueAlert]), /append-only/);
});

test('team activity and scoped audit/review history are bounded and least privilege', async () => {
  await prepareTeams();
  await db.query("select public.record_review_action($1,'ALERT',$2,'REVIEWED',null)", [teamUsers.auditorA, teamAlertA]);
  const activity = (await db.query('select public.get_team_activity($1,$2) as value', [teamUsers.supervisorA, teamA])).rows[0].value;
  assert.equal(activity.overview.team_members, 2);
  assert.equal(activity.overview.reviews_today, 1);
  const expectedOpen = Number((await db.query(`select count(*) as n from public.alerts a left join public.alert_assignments aa on aa.alert_id=a.id
    where a.status='ACTIVE' and (aa.alert_id is null or aa.team_id=$1)`, [teamA])).rows[0].n);
  assert.equal(activity.overview.open_alerts, expectedOpen); // Reviewed alerts are excluded; unclaimed alerts remain visible.
  assert.ok(activity.activity.some(event => event.action === 'ALERT_REVIEWED'));
  const adminTeam = (await db.query('select public.get_team_activity($1,$2) as value', [teamUsers.admin, teamA])).rows[0].value;
  assert.equal(adminTeam.overview.open_alerts, expectedOpen);
  await assert.rejects(db.query('select public.get_team_activity($1,$2)', [teamUsers.supervisorA, teamB]), /Cross-team activity denied/);
  await assert.rejects(db.query('select public.list_scoped_review_records($1,\'ALERT\',$2,1,25)', [teamUsers.auditorB, teamAlertA]), /Alert review scope denied/);
  const grants = (await db.query(`select
    has_function_privilege('anon','public.record_alert_assignment(uuid,text,text,uuid,text)','execute') as anon_write,
    has_function_privilege('service_role','public.list_accessible_alerts(uuid,integer,integer,text)','execute') as service_list,
    has_function_privilege('authenticated','public.list_audit_teams(uuid)','execute') as auth_list`)).rows[0];
  assert.deepEqual(grants, { anon_write: false, service_list: true, auth_list: false });
});

test('notifications persist once per recipient, follow approved scopes, and enforce private read state', async () => {
  await prepareTeams();
  const alertNotifications = async userId => (await db.query(
    "select type,resource_id from public.user_notifications where recipient_id=$1 and resource_type='ALERT' and resource_id=$2 order by type",
    [userId, teamAlertA])).rows;

  assert.deepEqual(await alertNotifications(teamUsers.admin), [{ type: 'HIGH_RISK_ALERT', resource_id: teamAlertA }]);
  assert.deepEqual(await alertNotifications(teamUsers.supervisorA), [
    { type: 'ALERT_ASSIGNED', resource_id: teamAlertA },
    { type: 'HIGH_RISK_ALERT', resource_id: teamAlertA },
  ]);
  assert.deepEqual(await alertNotifications(teamUsers.auditorA), [
    { type: 'ALERT_ASSIGNED', resource_id: teamAlertA },
  ]);
  assert.deepEqual(await alertNotifications(teamUsers.auditorB), []);

  const adminId = teamUsers.admin;
  const applicantId = '00000000-0000-4000-8000-000000000021';
  await db.query('insert into auth.users(id,email) values($1,\'phase17-applicant@example.test\')', [applicantId]);
  const accessRequestId = (await db.query(`insert into public.access_requests(email,full_name,department,reason)
    values('phase17-applicant@example.test','Phase 17 Applicant','Audit','Needs access') returning id`)).rows[0].id;
  assert.equal(Number((await db.query(`select count(*) as n from public.user_notifications
    where recipient_id=$1 and type='ACCESS_REQUEST_SUBMITTED' and resource_id=$2`, [adminId, accessRequestId])).rows[0].n), 1);
  assert.equal(Number((await db.query(`select count(*) as n from public.audit_events
    where action='ACCESS_REQUEST_SUBMITTED' and resource_id=$1`, [accessRequestId])).rows[0].n), 1);
  await db.query("select public.decide_access_request($1,$2,true,$3,'AUDITOR','Approved')", [adminId, accessRequestId, applicantId]);
  assert.equal(Number((await db.query(`select count(*) as n from public.user_notifications
    where recipient_id=$1 and type='ACCESS_REQUEST_APPROVED' and resource_id=$2`, [applicantId, accessRequestId])).rows[0].n), 1);
  assert.ok(Number((await db.query(`select count(*) as n from public.audit_events
    where action='ACCESS_REQUEST_APPROVED' and resource_id=$1`, [applicantId])).rows[0].n) >= 1);

  const rejectedRequestId = (await db.query(`insert into public.access_requests(email,full_name,department,reason)
    values('phase17-rejected@example.test','Rejected Applicant','Audit','Needs access') returning id`)).rows[0].id;
  await db.query("select public.decide_access_request($1,$2,false,null,null,'Request rejected by Admin')", [adminId, rejectedRequestId]);
  const rejectedRequest = (await db.query('select status,decision_reason from public.access_requests where id=$1', [rejectedRequestId])).rows[0];
  assert.deepEqual(rejectedRequest, { status: 'REJECTED', decision_reason: 'Request rejected by Admin' });
  assert.equal(Number((await db.query(`select count(*) as n from public.user_notifications
    where type='ACCESS_REQUEST_REJECTED' and resource_id=$1`, [rejectedRequestId])).rows[0].n), 0);
  assert.equal(Number((await db.query(`select count(*) as n from public.audit_events e
    join public.login_history h on h.id=e.source_login_history_id
    where h.actor_id=$1 and h.action='ACCESS_REQUEST' and h.outcome='REJECTED'
      and e.action='ACCESS_REQUEST_REJECTED' and e.resource_type='ACCESS_REQUEST'`, [adminId])).rows[0].n), 1);

  const lockedId = '00000000-0000-4000-8000-000000000022';
  await db.query('insert into auth.users(id,email) values($1,\'phase17-locked@example.test\')', [lockedId]);
  await db.query("update public.user_profiles set account_status='ACTIVE' where id=$1", [lockedId]);
  for (let attempt = 0; attempt < 3; attempt += 1) await db.query("select public.record_login('phase17-locked@example.test',false)");
  const lockNotice = (await db.query(`select id,type,read_at from public.user_notifications
    where recipient_id=$1 and type='ACCOUNT_LOCKED' order by created_at desc limit 1`, [lockedId])).rows[0];
  assert.ok(lockNotice);
  assert.equal(lockNotice.read_at, null);
  await db.query("select public.request_account_unlock('phase17-locked@example.test')");
  const unlockRequestId = (await db.query("select id from public.account_unlock_requests where user_id=$1 and status='PENDING'", [lockedId])).rows[0].id;
  await db.query("select public.decide_account_unlock($1,$2,true,'Identity verified')", [adminId, unlockRequestId]);
  assert.equal((await db.query('select account_status from public.user_profiles where id=$1', [lockedId])).rows[0].account_status, 'ACTIVE');
  await db.query('select public.mark_user_notification_read($1,$2)', [lockedId, lockNotice.id]);
  const readAt = (await db.query('select read_at from public.user_notifications where id=$1', [lockNotice.id])).rows[0].read_at;
  await db.query('select public.mark_user_notification_read($1,$2)', [lockedId, lockNotice.id]);
  assert.equal((await db.query('select read_at from public.user_notifications where id=$1', [lockNotice.id])).rows[0].read_at.toISOString(), readAt.toISOString());
  await assert.rejects(db.query('select public.mark_user_notification_read($1,$2)', [teamUsers.auditorA, lockNotice.id]), /Notification not found/);
  const auditorNotifications = (await db.query('select public.list_user_notifications($1,1,100,false) as value', [teamUsers.auditorA])).rows[0].value;
  assert.ok(auditorNotifications.items.every(item => item.resourceId !== lockedId));

  const grants = (await db.query(`select
    has_table_privilege('anon','public.user_notifications','select') as anon_read,
    has_table_privilege('authenticated','public.user_notifications','select') as auth_read,
    has_table_privilege('service_role','public.user_notifications','update') as service_write,
    has_function_privilege('anon','public.list_user_notifications(uuid,integer,integer,boolean)','execute') as anon_list,
    has_function_privilege('service_role','public.list_user_notifications(uuid,integer,integer,boolean)','execute') as service_list`)).rows[0];
  assert.deepEqual(grants, { anon_read: false, auth_read: false, service_write: false, anon_list: false, service_list: true });
  const restored = new PGlite({ loadDataDir: await db.dumpDataDir(), extensions: { pgcrypto } });
  try {
    assert.equal(Number((await restored.query('select count(*) as n from public.user_notifications where id=$1', [lockNotice.id])).rows[0].n), 1);
  } finally { await restored.close(); }
});

test('cases enforce team scope, immutable discussion, closure approval, clean evidence, and retry-safe SLA escalation', async () => {
  await prepareTeams();
  const created = (await db.query(`select public.create_case($1,'ALERT',$2,'Case review','Investigate the alert','HIGH','Audit',null) as value`,
    [teamUsers.auditorA, teamAlertA])).rows[0].value;
  const caseId = created.id;
  assert.equal(created.case_reference, 'CASE-000001');
  assert.equal(created.sla_target_hours, 24);
  assert.equal((await db.query('select public.can_access_case($1,$2) as value', [teamUsers.auditorA, caseId])).rows[0].value, true);
  assert.equal((await db.query('select public.can_access_case($1,$2) as value', [teamUsers.supervisorA, caseId])).rows[0].value, true);
  assert.equal((await db.query('select public.can_access_case($1,$2) as value', [teamUsers.supervisorB, caseId])).rows[0].value, false);
  const otherTeam = (await db.query('select public.list_cases($1,1,25,null,null,null) as value', [teamUsers.supervisorB])).rows[0].value;
  assert.equal(otherTeam.total, 0);
  const referenceSearch = (await db.query('select public.list_cases($1,1,25,null,null,$2) as value', [teamUsers.auditorA, 'CASE-000001'])).rows[0].value;
  assert.equal(referenceSearch.total, 1);
  await assert.rejects(db.query(`select public.create_case($1,'ALERT',$2,'Cross-team','Denied','HIGH',null,null)`,
    [teamUsers.supervisorA, teamAlertB]), /Source alert access denied/);

  const comment = (await db.query('select public.add_case_comment($1,$2,$3) as value', [teamUsers.auditorA, caseId, 'Evidence reviewed'])).rows[0].value;
  await assert.rejects(db.query('update public.case_comments set message=\'rewritten\' where id=$1', [comment.id]), /append-only/);
  await db.query("select public.update_case_status($1,$2,'ESCALATED',null)", [teamUsers.auditorA, caseId]);
  assert.equal((await db.query('select status from public.audit_cases where id=$1', [caseId])).rows[0].status, 'ESCALATED');
  await db.query("select public.update_case_status($1,$2,'INVESTIGATING',null)", [teamUsers.auditorA, caseId]);
  await db.query("select public.update_case_status($1,$2,'RESOLVED',null)", [teamUsers.auditorA, caseId]);
  assert.equal((await db.query('select sla_status from public.audit_cases where id=$1', [caseId])).rows[0].sla_status, 'COMPLETED');
  await db.query("select public.request_case_closure($1,$2,'ISSUE_CONFIRMED','Control failure confirmed',null)", [teamUsers.auditorA, caseId]);
  await assert.rejects(db.query(`select public.add_case_evidence($1,$2,'unsafe.pdf',10,'application/pdf','DOCUMENT',null,'case/unsafe','PENDING')`,
    [teamUsers.auditorA, caseId]), /Invalid or unscanned evidence/);
  const cleanEvidence = (await db.query(`select public.add_case_evidence($1,$2,'record.pdf',10,'application/pdf','DOCUMENT',null,$3,'CLEAN') as value`,
    [teamUsers.auditorA, caseId, `cases/${caseId}/record.pdf`])).rows[0].value;
  assert.equal(cleanEvidence.scan_status, 'CLEAN');
  assert.equal((await db.query('select public.get_case_evidence($1,$2,$3) as value', [teamUsers.auditorA, caseId, cleanEvidence.id])).rows[0].value.storage_key, `cases/${caseId}/record.pdf`);
  await assert.rejects(db.query('select public.decide_case_closure($1,$2,true,null)', [teamUsers.supervisorB, caseId]), /Cross-team closure decision denied/);
  await db.query("select public.decide_case_closure($1,$2,false,'Additional checks needed')", [teamUsers.supervisorA, caseId]);
  assert.equal((await db.query('select status,closure_decision,sla_status from public.audit_cases where id=$1', [caseId])).rows[0].status, 'INVESTIGATING');
  await db.query("select public.update_case_status($1,$2,'RESOLVED',null)", [teamUsers.auditorA, caseId]);
  await db.query("select public.request_case_closure($1,$2,'ISSUE_CONFIRMED','Control failure confirmed',null)", [teamUsers.auditorA, caseId]);
  await db.query("select public.decide_case_closure($1,$2,true,'Approved after review')", [teamUsers.admin, caseId]);
  assert.equal((await db.query('select status,closure_decision,sla_status from public.audit_cases where id=$1', [caseId])).rows[0].status, 'CLOSED');
  await assert.rejects(db.query('select public.add_case_comment($1,$2,$3)', [teamUsers.auditorA, caseId, 'After close']), /Closed case is read-only/);

  const overdue = (await db.query(`select public.create_case($1,'ALERT',$2,'Overdue case','Investigate the alert','LOW','Audit',null) as value`,
    [teamUsers.auditorA, teamAlertA])).rows[0].value;
  await db.query("update public.audit_cases set sla_due_at=now()-interval '1 minute' where id=$1", [overdue.id]);
  assert.deepEqual((await db.query('select public.escalate_overdue_cases(25) as value')).rows[0].value, { escalated: 1 });
  assert.deepEqual((await db.query('select public.escalate_overdue_cases(25) as value')).rows[0].value, { escalated: 0 });
  assert.deepEqual((await db.query('select status,sla_status,sla_target_hours from public.audit_cases where id=$1', [overdue.id])).rows[0],
    { status: 'ESCALATED', sla_status: 'OVERDUE', sla_target_hours: 72 });
  const recipients = (await db.query(`select recipient_id from public.user_notifications where type='SLA_OVERDUE' and resource_id=$1 order by recipient_id`, [overdue.id])).rows.map(row => row.recipient_id);
  const activeAdmins = (await db.query("select id from public.user_profiles where role='ADMIN' and account_status='ACTIVE'")).rows.map(row => row.id);
  assert.deepEqual(recipients, [...activeAdmins, teamUsers.auditorA, teamUsers.supervisorA].sort());
  const privileges = (await db.query(`select has_function_privilege('anon','public.create_case(uuid,text,text,text,text,text,text,uuid)','execute') as anon_create,
    has_table_privilege('authenticated','public.audit_cases','select') as auth_read,
    has_table_privilege('service_role','public.audit_cases','insert') as service_insert`)).rows[0];
  assert.deepEqual(privileges, { anon_create: false, auth_read: false, service_insert: false });
});

test('vendor watchlist/block workflows enforce role and team scope with immutable history and notifications', async () => {
  await prepareTeams();
  await db.query("insert into public.approved_vendors(vendor_id,vendor_name,source_reference) values('VM-001','Vendor One','isolated fixture')");
  await db.query("update public.transactions set vendor_id='VM-001',vendor_name='Vendor One' where id='TEAM-TX-A'");
  await db.query("insert into public.transaction_risk_scores(transaction_id,scoring_version,rule_evaluation_version,anomaly_model_version,rule_score,ai_score,risk_score,risk_level) values('TEAM-TX-A','1.0.0','1.0.0','1.0.0',80,70,76,'HIGH')");
  const vendorPage = (await db.query("select public.list_vendor_monitoring($1,1,25,null) as value", [teamUsers.admin])).rows[0].value;
  assert.ok(vendorPage.items.some(item => item.vendorId === 'VM-001'));
  const watchRequest = (await db.query("select public.request_vendor_monitoring($1,'VM-001','WATCHLIST','Repeated control exceptions') as value", [teamUsers.auditorA])).rows[0].value.request;
  await assert.rejects(db.query("select public.decide_vendor_monitoring($1,$2,true,null)", [teamUsers.supervisorB, watchRequest.id]), /Request outside supervisor team/);
  await assert.rejects(db.query("select public.request_vendor_monitoring($1,'VM-001','WATCHLIST','Duplicate')", [teamUsers.auditorA]), /Pending request exists/);
  await db.query('select public.decide_vendor_monitoring($1,$2,true,null)', [teamUsers.supervisorA, watchRequest.id]);
  assert.equal((await db.query("select monitoring_status from public.approved_vendors where vendor_id='VM-001'")).rows[0].monitoring_status, 'WATCHLISTED');
  await assert.rejects(db.query("select public.change_vendor_monitoring($1,'VM-001','REMOVE_WATCHLIST',null)", [teamUsers.supervisorB]), /outside supervisor scope/);
  const bundle = (await db.query("select public.get_vendor_monitoring_bundle($1,'VM-001') as value", [teamUsers.auditorA])).rows[0].value;
  assert.equal(bundle.transactions[0].id, 'TEAM-TX-A');
  assert.equal(bundle.risk_history[0].risk_level, 'HIGH');
  assert.equal(bundle.history.length, 2);
  const otherTeamBundle = (await db.query("select public.get_vendor_monitoring_bundle($1,'VM-001') as value", [teamUsers.supervisorB])).rows[0].value;
  assert.deepEqual(otherTeamBundle.requests, []);
  assert.deepEqual(otherTeamBundle.history, []);
  await assert.rejects(db.query("update public.vendor_monitoring_history set note='rewritten' where vendor_id=(select id from public.approved_vendors where vendor_id='VM-001')"), /append-only/);
  await db.query("select public.change_vendor_monitoring($1,'VM-001','REMOVE_WATCHLIST','Review completed')", [teamUsers.supervisorA]);
  const blockRequest = (await db.query("select public.request_vendor_monitoring($1,'VM-001','BLOCK','Material policy violation') as value", [teamUsers.supervisorA])).rows[0].value.request;
  await assert.rejects(db.query('select public.decide_vendor_monitoring($1,$2,true,null)', [teamUsers.supervisorA, blockRequest.id]), /Forbidden/);
  await db.query('select public.decide_vendor_monitoring($1,$2,true,null)', [teamUsers.admin, blockRequest.id]);
  assert.equal((await db.query("select monitoring_status from public.approved_vendors where vendor_id='VM-001'")).rows[0].monitoring_status, 'BLOCKED');
  await db.query("select public.change_vendor_monitoring($1,'VM-001','UNBLOCK','Controls remediated')", [teamUsers.admin]);
  assert.equal((await db.query("select monitoring_status from public.approved_vendors where vendor_id='VM-001'")).rows[0].monitoring_status, 'NORMAL');
  const notifications = (await db.query("select type from public.user_notifications where resource_type='VENDOR' and resource_id='VM-001' order by type")).rows.map(row => row.type);
  assert.ok(notifications.includes('VENDOR_WATCHLIST_REQUEST'));
  assert.ok(notifications.includes('VENDOR_WATCHLIST_APPROVED'));
  assert.ok(notifications.includes('VENDOR_BLOCK_REQUEST'));
  assert.ok(notifications.includes('VENDOR_BLOCKED'));
  assert.equal(Number((await db.query("select count(*) as n from public.audit_events where resource_type='VENDOR' and resource_id='VM-001' and outcome='SUCCESS'")).rows[0].n), 6);
  const privileges = (await db.query(`select has_function_privilege('anon','public.request_vendor_monitoring(uuid,text,text,text)','execute') as anon_call,
    has_function_privilege('service_role','public.request_vendor_monitoring(uuid,text,text,text)','execute') as service_call,
    has_table_privilege('authenticated','public.vendor_monitoring_history','select') as auth_read`)).rows[0];
  assert.deepEqual(privileges, { anon_call: false, service_call: true, auth_read: false });
});

test('authoritative analytics use latest evaluation snapshots, explicit denominators, UTC periods, and role-scoped alerts', async () => {
  await prepareTeams();
  const before = Number((await db.query('select count(*) as n from public.transactions')).rows[0].n);
  const transactionId = 'ANALYTICS-PHASE20';
  await create(transactionId);
  const superseded = ['segregation_of_duties', 'approval_limits', 'duplicate_payment', 'invoice_splitting', 'ghost_vendors']
    .map(rule_key => ({ rule_key, status: rule_key === 'ghost_vendors' ? 'FAILED' : 'PASSED', evidence: {} }));
  await db.query("insert into public.transaction_evaluations(transaction_id,evaluation_version,rule_status,rule_score,rule_results,evaluated_at) values($1,'0.9.0','REVIEW',20,$2::jsonb,now()-interval '2 days')", [transactionId, JSON.stringify(superseded)]);
  const results = [
    { rule_key: 'segregation_of_duties', rule_name: 'Segregation of Duties', status: 'FAILED', evidence: {} },
    { rule_key: 'approval_limits', rule_name: 'Approval Limits', status: 'PASSED', evidence: {} },
    { rule_key: 'duplicate_payment', rule_name: 'Duplicate Payments', status: 'NOT_EVALUATED', evidence: { missing_fields: ['invoice_number'] } },
    { rule_key: 'invoice_splitting', rule_name: 'Invoice Splitting', status: 'NOT_EVALUATED', evidence: { historical_context_available: false } },
    { rule_key: 'ghost_vendors', rule_name: 'Ghost Vendors', status: 'NOT_EVALUATED', evidence: { vendor_registry_available: false } },
  ];
  await db.query("insert into public.transaction_evaluations(transaction_id,evaluation_version,rule_status,rule_score,rule_results) values($1,'1.0.0','REVIEW',50,$2::jsonb)", [transactionId, JSON.stringify(results)]);
  await db.query("insert into public.transaction_risk_scores(transaction_id,scoring_version,rule_evaluation_version,anomaly_model_version,rule_score,ai_score,risk_score,risk_level) values($1,'1.0.0','1.0.0','1.0.0',80,70,76,'HIGH')", [transactionId]);
  await db.query("insert into public.alerts(transaction_id,severity,title,description,reason,risk_score,risk_scoring_version,request_received_at) values($1,'HIGH','Analytics alert','Fixture','High risk',76,'1.0.0',now())", [transactionId]);
  const alertId = (await db.query('select id from public.alerts where transaction_id=$1', [transactionId])).rows[0].id;
  await db.query("select public.record_alert_assignment($1,$2,'ASSIGNED',$3,null)", [teamUsers.supervisorA, alertId, teamUsers.auditorA]);

  const dashboard = (await db.query('select public.get_dashboard_summary($1) as value', [teamUsers.auditorA])).rows[0].value;
  assert.equal(dashboard.total_transactions, before + 1);
  assert.equal(dashboard.transactions_evaluated, dashboard.high_risk_transactions + dashboard.medium_risk_transactions + dashboard.low_risk_transactions);
  assert.ok(dashboard.transactions_evaluated >= 1);
  const scopedAlertCount = Number((await db.query("select count(*) as n from public.alerts a where a.status='ACTIVE' and public.can_access_team_alert($1,a.id)", [teamUsers.auditorA])).rows[0].n);
  assert.equal(dashboard.active_alerts, scopedAlertCount);
  const adminDashboard = (await db.query('select public.get_dashboard_summary($1) as value', [teamUsers.admin])).rows[0].value;
  const allActiveAlerts = Number((await db.query("select count(*) as n from public.alerts where status='ACTIVE'")).rows[0].n);
  assert.equal(adminDashboard.active_alerts, allActiveAlerts);
  const analytics = (await db.query('select public.get_authoritative_analytics($1,7) as value', [teamUsers.auditorA])).rows[0].value;
  assert.equal(analytics.coverage.total_transactions, before + 1);
  assert.equal(analytics.coverage.fully_evaluated + analytics.coverage.partially_evaluated + analytics.coverage.not_evaluated, before + 1);
  assert.equal(analytics.coverage.coverage_percent, Math.round(analytics.coverage.evaluated_transactions / (before + 1) * 10000) / 100);
  assert.equal(analytics.coverage.by_rule.length, 5);
  assert.ok(analytics.coverage.exclusions.some(item => item.reason === 'MISSING_REQUIRED_FIELDS'));
  assert.ok(analytics.coverage.exclusions.some(item => item.reason === 'RULE_CONTEXT_UNAVAILABLE'));
  assert.equal(analytics.risk_trends.length, 7);
  assert.equal(analytics.risk_trends[0].date, analytics.period_start);
  assert.equal(analytics.risk_trends[6].date, new Date(Date.parse(analytics.period_end) - 86400000).toISOString().slice(0, 10));
  assert.equal(analytics.rule_violation_trends.length, 35);
  assert.ok(analytics.risk_trends.some(item => item.high_risk_transactions >= 1), JSON.stringify(analytics.risk_trends));
  assert.ok(analytics.rule_violation_trends.some(item => item.rule_key === 'segregation_of_duties' && item.violations === 1));
  assert.ok(analytics.rule_violation_trends.filter(item => item.rule_key === 'ghost_vendors').every(item => item.violations === 0), 'superseded evaluation results must not appear in coverage or trends');
  for (const period of [30, 90]) {
    const extended = (await db.query('select public.get_authoritative_analytics($1,$2) as value', [teamUsers.auditorA, period])).rows[0].value;
    assert.equal(extended.risk_trends.length, period);
    assert.equal(extended.rule_violation_trends.length, period * 5);
  }
  await assert.rejects(db.query('select public.get_authoritative_analytics($1,14)', [teamUsers.auditorA]), /Unsupported analytics period/);
  await assert.rejects(db.query('select public.get_dashboard_summary($1)', ['00000000-0000-4000-8000-000000000099']), /Active account required/);
});

test('authoritative dashboard and analytics remain zero-safe with no transactions', async () => {
  await db.exec('truncate table public.transactions cascade');
  const dashboard = (await db.query('select public.get_dashboard_summary($1) as value', [teamUsers.admin])).rows[0].value;
  assert.equal(dashboard.total_transactions, 0);
  assert.equal(dashboard.transactions_evaluated, 0);
  assert.equal(dashboard.average_risk_score, 0);
  assert.equal(dashboard.active_alerts, 0);
  const analytics = (await db.query('select public.get_authoritative_analytics($1,7) as value', [teamUsers.admin])).rows[0].value;
  assert.equal(analytics.coverage.total_transactions, 0);
  assert.equal(analytics.coverage.coverage_percent, 0);
  assert.equal(analytics.coverage.fully_evaluated + analytics.coverage.partially_evaluated + analytics.coverage.not_evaluated, 0);
  assert.equal(analytics.risk_trends.length, 7);
  assert.ok(analytics.risk_trends.every(day => day.average_risk_score === null && day.high_risk_transactions === 0));
  assert.equal(analytics.rule_violation_trends.length, 35);
  assert.ok(analytics.rule_violation_trends.every(day => day.violations === 0));
});

test.after(async () => { await db.close(); });
