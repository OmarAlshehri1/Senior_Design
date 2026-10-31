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
const [admin, supervisor, auditor] = ['20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003'];
for (const [index,id] of [admin, supervisor, auditor].entries()) {
  await db.query('insert into auth.users(id,email) values($1,$2)',[id,`filters${index}@example.test`]);
  await db.query("update public.user_profiles set role=$2,account_status='ACTIVE' where id=$1",[id,['ADMIN','SUPERVISOR','AUDITOR'][index]]);
}
await db.query("insert into public.audit_teams(name,supervisor_id,created_by) values('Filter test team',$1,$2)",[supervisor,admin]);
const dataset = await scalar(`insert into public.primary_datasets(dataset_key,label,source_schema,currency,expected_rows,expected_amount,expected_vendors,
  source_sha256,model_version,model_sha256,model_bucket,model_object,model_threshold,scored_at,provenance)
  values('filter-test','Synthetic Payments','PAYMENTS_SIMULATION_WORKBOOK','USD',3,1250,2,
  repeat('b',64),'payments-primary-no-calendar-1.0.0',repeat('a',64),'private-models','test.joblib',99.51,clock_timestamp(),'{"registry_basis":"SIMULATION_WORKBOOK"}') returning id`);
await db.query("insert into public.approved_vendors(dataset_id,vendor_id,vendor_name,source_reference) values($1,'V-1','Northwind Supply','fixture'),($1,'V-2','Contoso Services','fixture')",[dataset]);
const rows = [
  {id:'low-a',source_row:2,amount:100,vendor_id:'V-1',vendor_name:'Northwind Supply',primary_rule_mask:0,primary_rule_scaled:0,primary_ai_scaled:5000,primary_risk_scaled:2000},
  {id:'medium-b',source_row:3,amount:150,vendor_id:'V-1',vendor_name:'Northwind Supply',primary_rule_mask:6,primary_rule_scaled:4000,primary_ai_scaled:10000,primary_risk_scaled:6400},
  {id:'high-c',source_row:4,amount:1000,vendor_id:'V-2',vendor_name:'Contoso Services',primary_rule_mask:30,primary_rule_scaled:8000,primary_ai_scaled:10000,primary_risk_scaled:8800},
].map(r=>({...r,transaction_timestamp:'2026-10-01T12:00:00Z',invoice_number:'INV',currency:'USD',
  created_by:'actor-a',approved_by:'actor-b',approver_role:'SUPERVISOR',approval_limit:100,
  completeness_status:'PARTIAL',missing_fields:['category'],primary_duplicate_count:1,primary_window_count:0,
  primary_window_total:r.amount,primary_raw_severity:0.6}));
await scalar('select public.import_primary_payment_batch($1::smallint,0,$2::jsonb)',[dataset,JSON.stringify(rows)]);
await scalar('select public.seal_primary_dataset($1::smallint)',[dataset]);
await scalar('select public.create_primary_dataset_alerts($1::smallint)',[dataset]);
await scalar('select public.activate_primary_dataset($1::smallint,0::smallint)',[dataset]);

const filtered = (actor, options = {}) => scalar(
  'select public.list_accessible_alerts_filtered($1::uuid,$2,$3,$4,$5,$6,$7,$8)',
  [actor, options.page ?? 1, options.pageSize ?? 25, options.status ?? null, options.severity ?? null,
    options.title ?? null, options.search ?? null, options.sort ?? 'NEWEST'],
);

test('transaction risk and rule-status filter columns exist on every application row', async () => {
  assert.equal(await scalar('select count(*)::int from public.application_transactions where primary_rule_mask is null'), 0);
  assert.equal(await scalar('select count(*)::int from public.application_transactions where primary_risk_scaled>=7500'), 1);
  assert.equal(await scalar('select count(*)::int from public.application_transactions where primary_risk_scaled>=5000 and primary_risk_scaled<7500'), 1);
  assert.equal(await scalar('select count(*)::int from public.application_transactions where primary_rule_mask=0'), 1);
  const summary = await scalar('select public.get_dashboard_summary($1::uuid)', [admin]);
  assert.equal(summary.high_risk_transactions, 1);
  assert.equal(summary.medium_risk_transactions, 1);
});

test('unfiltered alert results match the existing scoped list for every role', async () => {
  for (const actor of [admin, supervisor, auditor]) {
    const existing = await scalar('select public.list_accessible_alerts($1::uuid,1,25)', [actor]);
    const result = await filtered(actor);
    assert.equal(result.total, existing.total);
    assert.deepEqual(result.items.map((item) => item.id), existing.items.map((item) => item.id));
  }
  assert.equal((await filtered(auditor)).total, 0);
});

test('alert filters apply before paging and count', async () => {
  assert.equal((await filtered(admin)).total, 2);
  assert.equal((await filtered(admin, { severity: 'HIGH' })).total, 1);
  assert.equal((await filtered(admin, { severity: 'LOW' })).total, 0);
  assert.equal((await filtered(admin, { search: 'contoso' })).items[0].transaction_id, 'high-c');
  assert.equal((await filtered(admin, { search: 'MEDIUM-B' })).total, 1);
  assert.equal((await filtered(admin, { search: 'no such vendor' })).total, 0);
  const page = await filtered(admin, { pageSize: 1, page: 2, sort: 'HIGHEST_RISK' });
  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].transaction_id, 'medium-b');
  assert.equal(page.items[0].list_position, undefined);
  const title = (await filtered(admin)).items[0].title;
  assert.equal((await filtered(admin, { title })).total >= 1, true);
  await assert.rejects(filtered(admin, { sort: 'RANDOM' }), /Invalid alert query/);
});

test('alert options expose bounded types and scoped counts', async () => {
  const options = await scalar('select public.get_alert_filter_options($1::uuid)', [admin]);
  assert.ok(options.types.length >= 1);
  assert.equal(options.counts.total, 2);
  assert.equal(options.counts.active, 2);
  assert.equal(options.counts.active_high, 1);
  assert.equal(options.counts.active_medium, 1);
  const auditorOptions = await scalar('select public.get_alert_filter_options($1::uuid)', [auditor]);
  assert.deepEqual(auditorOptions.types, []);
  assert.equal(auditorOptions.counts.total, 0);
});

test('vendor search matches name or identifier before paging and keeps the existing projection', async () => {
  const existing = await scalar('select public.list_vendor_monitoring($1::uuid,1,25,null)', [admin]);
  const all = await scalar('select public.search_vendor_monitoring($1::uuid,1,25,null,null)', [admin]);
  assert.deepEqual(all, existing);
  const byName = await scalar("select public.search_vendor_monitoring($1::uuid,1,25,null,'northwind')", [admin]);
  assert.equal(byName.total, 1);
  assert.equal(byName.items[0].vendorId, 'V-1');
  assert.equal((await scalar("select public.search_vendor_monitoring($1::uuid,1,25,null,'v-2')", [admin])).items[0].name, 'Contoso Services');
  assert.equal((await scalar("select public.search_vendor_monitoring($1::uuid,1,25,'BLOCKED','northwind')", [admin])).total, 0);
  assert.equal((await scalar("select public.search_vendor_monitoring($1::uuid,1,25,null,'%')", [admin])).total, 0);
});

test('new list functions are not executable by unprivileged database roles', async () => {
  for (const signature of ['public.list_accessible_alerts_filtered(uuid,integer,integer,text,text,text,text,text)',
    'public.get_alert_filter_options(uuid)', 'public.search_vendor_monitoring(uuid,integer,integer,text,text)']) {
    assert.equal(await scalar(`select has_function_privilege('authenticated','${signature}','execute')`), false);
    assert.equal(await scalar(`select has_function_privilege('service_role','${signature}','execute')`), true);
  }
});

const byRule = (actor, rule, options = {}) => scalar(
  'select public.list_accessible_alerts_by_rule($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9)',
  [actor, options.page ?? 1, options.pageSize ?? 25, rule, options.status ?? null, options.severity ?? null,
    options.title ?? null, options.search ?? null, options.sort ?? 'NEWEST'],
);
const RULES = ['segregation_of_duties', 'approval_limits', 'duplicate_payment', 'invoice_splitting', 'ghost_vendors'];

test('alert rule keys are the FAILED results of the latest stored evaluation', async () => {
  for (const id of ['low-a', 'medium-b', 'high-c']) {
    const latest = await scalar('select rule_results from public.get_latest_transaction_evaluations(array[$1])', [id]);
    const expected = latest.filter((rule) => rule.status === 'FAILED').map((rule) => rule.rule_key);
    assert.deepEqual(await scalar('select public.transaction_failed_rule_keys($1)', [id]), expected);
  }
  assert.deepEqual(await scalar("select public.transaction_failed_rule_keys('high-c')"),
    ['approval_limits', 'duplicate_payment', 'invoice_splitting', 'ghost_vendors']);
  assert.deepEqual(await scalar("select public.get_transaction_failed_rule_keys(array['medium-b','missing'])"),
    { 'medium-b': ['approval_limits', 'duplicate_payment'], missing: [] });
  await assert.rejects(scalar('select public.get_transaction_failed_rule_keys($1::text[])',
    [Array.from({ length: 101 }, (_, index) => `t-${index}`)]), /Invalid rule lookup/);
});

test('non-primary rows use the latest transaction_evaluations rule_results', async () => {
  await db.query(`insert into public.transactions(id,dataset_id,completeness_status) values('legacy-rule',0,'COMPLETE')`);
  await db.query(`insert into public.transaction_evaluations(transaction_id,evaluation_version,rule_status,rule_score,rule_results,evaluated_at) values
    ('legacy-rule','1','REVIEW',20,'[{"rule_key":"ghost_vendors","status":"FAILED"}]','2026-01-01'),
    ('legacy-rule','1','REVIEW',20,'[{"rule_key":"ghost_vendors","status":"PASSED"},{"rule_key":"approval_limits","status":"FAILED"},{"rule_key":"invoice_splitting","status":"NOT_EVALUATED"}]','2026-02-01')`);
  assert.deepEqual(await scalar("select public.transaction_failed_rule_keys('legacy-rule')"), ['approval_limits']);
});

test('rule filter applies before paging and count, composes with filters, and keeps scope', async () => {
  assert.equal((await byRule(admin, 'ghost_vendors')).total, 1);
  assert.equal((await byRule(admin, 'ghost_vendors')).items[0].transaction_id, 'high-c');
  assert.equal((await byRule(admin, 'segregation_of_duties')).total, 0);
  const approval = await byRule(admin, 'approval_limits', { pageSize: 1, page: 2, sort: 'HIGHEST_RISK' });
  assert.equal(approval.total, 2);
  assert.equal(approval.items.length, 1);
  assert.equal(approval.items[0].transaction_id, 'medium-b');
  assert.deepEqual(approval.items[0].rule_keys, ['approval_limits', 'duplicate_payment']);
  assert.equal(approval.items[0].list_position, undefined);
  assert.equal((await byRule(admin, 'approval_limits', { severity: 'MEDIUM' })).total, 1);
  assert.equal((await byRule(admin, 'duplicate_payment', { search: 'contoso' })).total, 1);
  assert.equal((await byRule(admin, 'invoice_splitting', { status: 'REVIEWED' })).total, 0);
  for (const actor of [admin, supervisor, auditor]) {
    const all = (await filtered(actor)).items;
    for (const rule of RULES) {
      const result = await byRule(actor, rule);
      const expected = [];
      for (const item of all) {
        if ((await scalar('select public.transaction_failed_rule_keys($1)', [item.transaction_id])).includes(rule)) expected.push(item.id);
      }
      assert.equal(result.total, expected.length);
      assert.deepEqual(result.items.map((item) => item.id), expected);
    }
  }
  assert.equal((await byRule(auditor, 'approval_limits')).total, 0);
  await assert.rejects(byRule(admin, 'unknown_rule'), /Invalid alert query/);
  await assert.rejects(byRule(admin, null), /Invalid alert query/);
});

test('rule filter functions are not executable by unprivileged database roles', async () => {
  for (const signature of ['public.list_accessible_alerts_by_rule(uuid,integer,integer,text,text,text,text,text,text)',
    'public.transaction_failed_rule_keys(text)', 'public.get_transaction_failed_rule_keys(text[])']) {
    assert.equal(await scalar(`select has_function_privilege('authenticated','${signature}','execute')`), false);
    assert.equal(await scalar(`select has_function_privilege('anon','${signature}','execute')`), false);
    assert.equal(await scalar(`select has_function_privilege('service_role','${signature}','execute')`), true);
  }
});
