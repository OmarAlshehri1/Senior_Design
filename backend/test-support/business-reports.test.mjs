import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Fully isolated, in-memory PostgreSQL; never uses credentials or a live database.
const db = new PGlite({ extensions: { pgcrypto } });
await db.exec("create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);");
const migrations = new URL('../migrations/', import.meta.url);
for (const name of (await readdir(migrations)).filter((n) => n.endsWith('.sql')).sort()) {
  try { await db.exec(await readFile(new URL(name,migrations),'utf8')); }
  catch (error) { throw new Error(`Migration ${name}: ${error.message}`); }
}
const ids = {
  admin: '10000000-0000-4000-8000-000000000001',
  supervisorA: '10000000-0000-4000-8000-000000000002',
  supervisorB: '10000000-0000-4000-8000-000000000003',
  auditor: '10000000-0000-4000-8000-000000000004',
};
for (const [name,id] of Object.entries(ids)) {
  await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${name}@example.test`]);
  await db.query("update public.user_profiles set role=$2,name=$3,account_status='ACTIVE' where id=$1",[id,name==='admin'?'ADMIN':name==='auditor'?'AUDITOR':'SUPERVISOR',name]);
}
const team = async (name,supervisor) => (await db.query(
  'insert into public.audit_teams(name,supervisor_id,created_by) values($1,$2,$3) returning id',[name,supervisor,ids.admin])).rows[0].id;
const teamA = await team('A',ids.supervisorA);
const teamB = await team('B',ids.supervisorB);
for (const [id,date] of [['A','2026-10-03T12:00:00Z'],['B','2026-10-03T13:00:00Z'],['CASE-ONLY','2026-10-03T14:00:00Z'],['UNLINKED','2026-10-03T15:00:00Z'],['B-LATER','2026-10-04T00:00:00Z'],['UNDATED',null]]) {
  await db.query("insert into public.transactions(id,transaction_timestamp,amount,currency,completeness_status,ground_truth,metadata) values($1,$2,500,'SAR','PARTIAL','{\"secret_label\":true}','{\"private_metadata\":true}')",[id,date]);
}
for (const [tx,tid] of [['A',teamA],['B',teamB],['B-LATER',teamB],['UNDATED',teamA]]) {
  const alert = (await db.query("insert into public.alerts(transaction_id,severity,title,description,reason,risk_score,risk_scoring_version,request_received_at) values($1,'HIGH','test','test','test',100,'1.0.0',now()) returning id",[tx])).rows[0].id;
  await db.query("insert into public.alert_assignments(alert_id,team_id,assignee_id,status,updated_by) values($1,$2,$3,'ASSIGNED',$4)",[alert,tid,ids.auditor,ids.admin]);
}
await db.query("insert into public.audit_cases(title,description,priority,source_type,source_id,transaction_id,team_id,assigned_to,created_by,sla_target_hours,sla_due_at) values('Case','Test case','MEDIUM','TRANSACTION','CASE-ONLY','CASE-ONLY',$1,$2,$3,48,now()+interval '48 hours')",[teamA,ids.auditor,ids.admin]);
await db.query(`insert into public.transaction_evaluations(transaction_id,evaluation_version,rule_status,rule_score,rule_results,evaluated_at)
  values('A','old','PASSED',0,'[{"rule_key":"ghost_vendors","status":"PASSED"}]','2026-10-03'),
  ('A','1.0.0','REVIEW',100,'[{"rule_key":"ghost_vendors","status":"FAILED","evidence":{"vendor_registered":false}}]','2026-10-10')`);
await db.query(`insert into public.transaction_risk_scores(transaction_id,scoring_version,rule_evaluation_version,anomaly_model_version,rule_score,ai_score,risk_score,risk_level)
  values('A','1.0.0','1.0.0','1.0.0',100,100,100,'HIGH')`);
const rpc = async (sql,args) => (await db.query(sql,args)).rows[0].value;
const source = (actor,start='2026-10-03T00:00:00Z') => rpc('select public.get_business_report_source($1,$2) as value',[actor,start]);
const save = (actor,document) => rpc('select public.save_business_report($1,$2::jsonb) as value',[actor,JSON.stringify(document)]);
const read = (actor,id=null) => rpc('select public.read_business_reports($1,$2) as value',[actor,id]);
const document = (s) => ({...s,schema_version:'2.0.0',approval_status:'DRAFT',title:'Memo',data_context:'DEMONSTRATION',
  evidence:{transactions:s.transactions,alerts:s.alerts,cases:s.cases}});

test('source restricts cohorts, scoped workflow evidence, period boundaries and latest snapshots',async()=>{
  const a = await source(ids.supervisorA);
  assert.deepEqual(a.transactions.map(t=>t.id),['A','CASE-ONLY']);
  assert.deepEqual(a.alerts.map(t=>t.transaction_id),['A']);
  assert.deepEqual(a.cases.map(t=>t.transaction_id),['CASE-ONLY']);
  assert.equal(a.scope,'TEAM');
  assert.equal(a.team_id,teamA);
  assert.equal(a.undated_in_scope,1);
  assert.equal(a.transactions[0].evaluation_version,'1.0.0');
  assert.equal(a.transactions[0].rule_results[0].status,'FAILED');
  assert.equal(a.transactions[0].risk_score,100);
  assert.ok(!JSON.stringify(a).includes('secret_label'));
  assert.ok(!JSON.stringify(a).includes('private_metadata'));
  const admin = await source(ids.admin);
  assert.equal(admin.scope,'ORGANIZATION');
  assert.equal(admin.transactions.length,4);
  assert.equal((await source(ids.supervisorB)).transactions.length,1);
  assert.equal((await source(ids.supervisorA,null)).period_start.slice(0,10),'2026-10-03');
  assert.equal((await source(ids.admin,null)).period_start.slice(0,10),'2026-10-04');
  assert.equal((await source(ids.admin,'2026-10-06T00:00:00Z')).transactions.length,0);
  await assert.rejects(source(ids.auditor),/Report access denied/);
  await assert.rejects(source(ids.admin,'2026-10-03T01:00:00Z'),/UTC midnight/);
});

test('saved revisions are immutable, append-only and list/read enforce current scope',async()=>{
  const aDoc = document(await source(ids.supervisorA));
  const first = await save(ids.supervisorA,aDoc);
  const second = await save(ids.supervisorA,aDoc);
  assert.notEqual(first.id,second.id);
  assert.equal((await read(ids.supervisorA)).total,2);
  assert.equal((await read(ids.supervisorB)).total,0);
  assert.equal(await read(ids.supervisorB,first.id),null);
  assert.equal((await read(ids.admin,first.id)).id,first.id);
  await assert.rejects(db.query('update public.business_reports set document=\'{}\' where id=$1',[first.id]),/immutable/);
  await assert.rejects(db.query('delete from public.business_reports where id=$1',[first.id]),/immutable/);
  const org = await save(ids.admin,document(await source(ids.admin)));
  assert.equal(await read(ids.supervisorA,org.id),null);
  await assert.rejects(save(ids.supervisorA,{...aDoc,scope:'ORGANIZATION',team_id:null}),/Invalid report snapshot/);
  await assert.rejects(read(ids.auditor),/Report access denied/);
  await db.query("update public.transactions set vendor_name='Changed after generation' where id='A'");
  const after = await read(ids.supervisorA,first.id);
  assert.deepEqual(after.document,first.document);
  await db.query("update public.alert_assignments set team_id=$1 where alert_id in (select id from public.alerts where transaction_id='A')",[teamB]);
  assert.equal(await read(ids.supervisorA,first.id),null);
  assert.equal((await read(ids.supervisorA)).total,0);
  assert.ok(await read(ids.admin,first.id));
  await db.query("update public.alert_assignments set team_id=$1 where alert_id in (select id from public.alerts where transaction_id='A')",[teamA]);
  await db.query("update public.user_profiles set account_status='DISABLED' where id=$1",[ids.supervisorA]);
  await assert.rejects(read(ids.supervisorA,first.id),/Report access denied/);
  await db.query("update public.user_profiles set account_status='ACTIVE' where id=$1",[ids.supervisorA]);
  await db.query('update public.audit_teams set is_active=false where id=$1',[teamA]);
  assert.equal(await read(ids.supervisorA,first.id),null);
  await assert.rejects(source(ids.supervisorA),/Active supervising team/);
  await db.query('update public.audit_teams set is_active=true where id=$1',[teamA]);
});

test('database grants prevent direct writes and audit creation is atomic',async()=>{
  const grants = (await db.query(`select has_table_privilege('service_role','public.business_reports','insert') as direct_insert,
    has_table_privilege('authenticated','public.business_reports','select') as direct_read,
    has_function_privilege('anon','public.get_business_report_source(uuid,timestamptz)','execute') as anon_rpc,
    has_function_privilege('authenticated','public.save_business_report(uuid,jsonb)','execute') as auth_rpc,
    has_function_privilege('service_role','public.read_business_reports(uuid,uuid,integer,integer)','execute') as server_read`)).rows[0];
  assert.deepEqual(grants,{direct_insert:false,direct_read:false,anon_rpc:false,auth_rpc:false,server_read:true});
  const before = (await read(ids.admin)).total;
  await db.exec("create function public.fail_business_audit() returns trigger language plpgsql as $$ begin raise exception 'audit unavailable'; end; $$; create trigger fail_business_audit before insert on public.audit_events for each row when(new.action='BUSINESS_REPORT_CREATED') execute function public.fail_business_audit();");
  try { await assert.rejects(save(ids.admin,document(await source(ids.admin))),/audit unavailable/); }
  finally { await db.exec('drop trigger fail_business_audit on public.audit_events'); }
  assert.equal((await read(ids.admin)).total,before);
});

test('UTC day boundaries remain 24 hours when the database timezone crosses DST',async()=>{
  await db.exec("set timezone='America/New_York'");
  try {
    const s = await source(ids.admin,'2026-11-01T00:00:00Z');
    assert.equal(new Date(s.period_end)-new Date(s.period_start),86400000);
    const saved = await save(ids.admin,document(s));
    assert.equal(new Date(saved.period_end)-new Date(saved.period_start),86400000);
  } finally { await db.exec("set timezone='UTC'"); }
});
after(async()=>{await db.close();});
