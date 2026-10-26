import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { readFile, readdir } from 'node:fs/promises';

const require = createRequire(process.env.PGLITE_PACKAGE_JSON || import.meta.url);
const { PGlite } = await import(pathToFileURL(require.resolve('@electric-sql/pglite')));
const { pgcrypto } = await import(pathToFileURL(require.resolve('@electric-sql/pglite/contrib/pgcrypto')));
const db = new PGlite({ extensions: { pgcrypto } });
after(() => db.close());
await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb)");
const directory = new URL('../migrations/', import.meta.url);
for (const file of (await readdir(directory)).filter(n => n.endsWith('.sql')).sort()) {
  await db.exec(await readFile(new URL(file, directory), 'utf8'));
}
const scalar = async (sql, args=[]) => Object.values((await db.query(sql,args)).rows[0])[0];
const actors = ['10000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003'];
for (const [index,id] of actors.entries()) {
  await db.query('insert into auth.users(id,email) values($1,$2)',[id,`primary${index}@example.test`]);
  await db.query("update public.user_profiles set role=$2,account_status='ACTIVE' where id=$1",[id,['ADMIN','SUPERVISOR','AUDITOR'][index]]);
}
await db.query("insert into public.audit_teams(name,supervisor_id,created_by) values('Primary test team',$1,$2)",[actors[1],actors[0]]);
await db.exec("insert into public.transactions(id,amount,completeness_status) values('old-payment',5,'PARTIAL')");
const dataset = await scalar(`insert into public.primary_datasets(dataset_key,label,source_schema,currency,expected_rows,expected_amount,expected_vendors,
  model_version,model_sha256,model_bucket,model_object,model_threshold,scored_at,provenance)
  values('synthetic-test','Synthetic Payments','PAYMENTS_SIMULATION_WORKBOOK','USD',2,250,1,
  'payments-primary-no-calendar-1.0.0',repeat('a',64),'private-models','test.joblib',99.51,clock_timestamp(),'{"registry_basis":"SIMULATION_WORKBOOK"}') returning id`);
await db.query("insert into public.approved_vendors(dataset_id,vendor_id,vendor_name,source_reference) values($1,'V-1','Test Vendor','synthetic fixture')",[dataset]);
const rows = [
  {id:'new-a',source_row:2,amount:100,primary_rule_mask:0,primary_rule_scaled:0,primary_ai_scaled:5000,primary_risk_scaled:2000},
  {id:'new-b',source_row:3,amount:150,primary_rule_mask:6,primary_rule_scaled:4000,primary_ai_scaled:10000,primary_risk_scaled:6400},
].map(r=>({...r,transaction_timestamp:'2026-10-01T12:00:00Z',vendor_id:'V-1',vendor_name:'Test Vendor',invoice_number:'INV',currency:'USD',
  created_by:'actor-a',approved_by:'actor-b',approver_role:'SUPERVISOR',approval_limit:100,
  completeness_status:'PARTIAL',missing_fields:['category'],primary_duplicate_count:1,primary_window_count:0,
  primary_window_total:r.amount,primary_raw_severity:0.6}));

test('bounded import is replayable, immutable and invisible until activation', async () => {
  assert.deepEqual(await scalar('select public.import_primary_payment_batch($1::smallint,0,$2::jsonb)',[dataset,JSON.stringify(rows)]),{accepted:2,duplicate:false});
  assert.equal((await scalar('select public.import_primary_payment_batch($1::smallint,0,$2::jsonb)',[dataset,JSON.stringify(rows)])).duplicate,true);
  await assert.rejects(db.query('select public.import_primary_payment_batch($1::smallint,0,$2::jsonb)',[dataset,JSON.stringify([...rows].reverse())]),/Batch content changed/);
  assert.equal(await scalar('select count(*)::int from public.application_transactions'),1);
  assert.equal(await scalar("select count(*)::int from public.application_transaction_details where id='new-a'"),0);
  const summary=await scalar('select public.seal_primary_dataset($1::smallint)',[dataset]);
  assert.equal(summary.total,2);
  assert.equal(summary.medium,1);
  await assert.rejects(db.query("update public.transactions set amount=1 where id='new-a'"),/sealed/);
  assert.equal(await scalar('select public.create_primary_dataset_alerts($1::smallint)',[dataset]),1);
  assert.equal(await scalar('select count(*)::int from public.user_notifications'),0);
  assert.equal(await scalar("select latency_ms from public.alerts where transaction_id='new-b'"),null);
  await scalar('select public.activate_primary_dataset($1::smallint,0::smallint)',[dataset]);
  assert.equal(await scalar('select count(*)::int from public.application_transactions'),2);
  assert.equal(await scalar("select dataset_active from public.application_transaction_details where id='old-payment'"),false);
});

test('compact snapshots reconstruct full rules and source scoped contexts', async () => {
  const evaluations=await scalar("select jsonb_agg(to_jsonb(e)) from public.get_latest_transaction_evaluations(array['new-a','new-b'])e");
  assert.equal(evaluations.length,2);
  for(const e of evaluations) assert.equal(e.rule_results.length,5);
  assert.equal(evaluations.find(e=>e.transaction_id==='new-b').rule_score,40);
  assert.equal((await scalar("select to_jsonb(r) from public.get_latest_transaction_risk_scores(array['new-b'])r")).risk_level,'MEDIUM');
  assert.equal((await scalar('select to_jsonb(c) from public.get_evaluation_coverage()c')).coverage_percent,100);
});

test('dashboards, analytics and alerts preserve role boundaries', async () => {
  for(const actor of actors) {
    const dashboard=await scalar('select public.get_dashboard_summary($1::uuid)',[actor]);
    assert.equal(dashboard.total_transactions,2);
    assert.equal(dashboard.medium_risk_transactions,1);
    const analytics=await scalar('select public.get_authoritative_analytics($1::uuid,7)',[actor]);
    assert.equal(analytics.coverage.total_transactions,2);
    assert.equal(analytics.coverage.fully_evaluated,2);
    assert.equal(analytics.risk_trends.length,7);
    const alerts=await scalar('select public.list_accessible_alerts($1::uuid,1,25)',[actor]);
    assert.equal(alerts.total,actor===actors[2]?0:1);
  }
});

test('unprivileged database roles cannot read or activate datasets', async () => {
  for(const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query('select * from public.application_transactions'),/permission denied/);
      await assert.rejects(db.query('select public.activate_primary_dataset(0::smallint,1::smallint)'),/permission denied/);
    } finally { await db.exec('reset role'); }
  }
});

test('optimistic rollback retains both populations', async () => {
  await assert.rejects(db.query('select public.activate_primary_dataset(0::smallint,0::smallint)'),/selection changed/);
  await scalar('select public.activate_primary_dataset(0::smallint,$1::smallint)',[dataset]);
  assert.equal(await scalar('select count(*)::int from public.application_transactions'),1);
  assert.equal(await scalar('select count(*)::int from public.transactions'),3);
});
