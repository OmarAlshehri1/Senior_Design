// Synthetic saved-read fixtures, not real Payments records or a new audit replay.
import {readFile,readdir} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';

export async function createReviewFixture() {
  const db=new PGlite({extensions:{pgcrypto}});
  await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb)");
  const directory=new URL('../migrations/',import.meta.url);
  for(const name of (await readdir(directory)).filter(n=>n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(name,directory),'utf8'));
  const users={};
  for(const [index,name,role] of [[1,'admin','ADMIN'],[2,'supervisor','SUPERVISOR'],[3,'auditor','AUDITOR'],[4,'otherSupervisor','SUPERVISOR']]) {
    const id=`10000000-0000-4000-8000-${String(index).padStart(12,'0')}`;users[name]=id;
    await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${name.toLowerCase()}@example.test`]);
    await db.query("update user_profiles set name=$2,role=$3,account_status='ACTIVE' where id=$1",[id,'SYNTHETIC '+name,role]);
  }
  const teams={};
  for(const [i,name,supervisor] of [[1,'A',users.supervisor],[2,'B',users.otherSupervisor]]) {
    const id=`20000000-0000-4000-8000-${String(i).padStart(12,'0')}`;teams[name]=id;
    await db.query('insert into audit_teams(id,name,supervisor_id,created_by) values($1,$2,$3,$4)',[id,'SYNTHETIC Team '+name,supervisor,users.admin]);
  }
  await db.query('insert into audit_team_memberships(user_id,team_id,added_by) values($1,$2,$3)',[users.auditor,teams.A,users.admin]);
  for(const [source,hash] of [['SYNTHETIC-A','a'],['SYNTHETIC-B','b']]) await db.query(`insert into ingestion_sources(id,organization_id,credential_hash,mapping_version,active,audit_enabled)
    values($1,'30000000-0000-4000-8000-000000000001',$2,'v1',true,true)`,[source,hash.repeat(64)]);
  await db.query("insert into feed_review_users values('SYNTHETIC-A',$1)",[users.admin]);
  for(const team of Object.values(teams)) await db.query("insert into feed_review_teams values('SYNTHETIC-A',$1)",[team]);
  const keys=['segregation_of_duties','approval_limits','duplicate_payment','invoice_splitting','ghost_vendors'];
  async function add(i,{source='SYNTHETIC-A',amount='10.00',currency='USD',category=null,failure=null,pending=false,blocked=false,canonical={},identityContext={},receivedAt=null}={}) {
    const received=receivedAt||new Date(Date.UTC(2026,9,24,10,i)).toISOString();
    const receipt=(await db.query(`insert into ingestion_receipts(source_id,organization_id,event_id,record_id,schema_version,event_type,
      mapping_version,fingerprint,original_payload,envelope,received_at) values($1,'30000000-0000-4000-8000-000000000001',
      $2,$2,'1.0','transaction.created','v1',repeat('d',64),'{}','{}',$3) returning id`,[source,`SYNTHETIC-row-${i}`,received])).rows[0].id;
    await db.query('insert into ingestion_validations(receipt_id,result) values($1,$2)',[receipt,JSON.stringify({engine_version:'1.0.0',intake_status:'ACCEPTED',reasons:[],identity_context:identityContext,
      canonical:{amount,currency,category,vendor_id:'SYNTHETIC-VENDOR',vendor_name:'SYNTHETIC Vendor',invoice_number:`SYNTHETIC-invoice-${i}`,source_date:'2022-01-03',...canonical}})]);
    await db.query('select prepare_feed_audits(25)');
    const id=(await db.query('select id from feed_transactions where receipt_id=$1',[receipt])).rows[0].id;
    if(!pending&&!blocked) {
      const rules=keys.map(rule_key=>({rule_key,status:rule_key===failure?'FAILED':i===1&&rule_key==='invoice_splitting'?'NOT_EVALUATED':'PASSED',
        detail:'SYNTHETIC saved rule evidence',evidence:{gate_reasons:[],vendor_registered:failure!=='ghost_vendors'}}));
      const failed=rules.filter(r=>r.status==='FAILED').length, notEvaluated=rules.filter(r=>r.status==='NOT_EVALUATED').length;
      await db.query('insert into feed_audit_results(transaction_id,bundle) values($1,$2)',[id,JSON.stringify({time_basis:'SIMULATED_ARRIVAL_TIME',rule_results:rules,
        coverage:{total:5,evaluated:5-notEvaluated,failed,not_evaluated:notEvaluated},risk_score:null,risk_level:null,
        anomaly:{status:'NOT_EVALUATED',reason:'MODEL_SOURCE_NOT_APPROVED'},private_fixture_marker:'DO_NOT_EXPORT_CONFIGURATION'})]);
      await db.query("update feed_audit_jobs set status='COMPLETED' where transaction_id=$1",[id]);
    } else if(blocked) await db.query("update feed_audit_jobs set status='BLOCKED' where transaction_id=$1",[id]);
    return id;
  }
  const transactions=[];
  transactions.push(await add(0,{amount:'10.10',failure:'ghost_vendors'}));
  transactions.push(await add(1,{amount:'20.20'}));
  transactions.push(await add(2,{amount:'30.30',currency:'EUR',failure:'approval_limits'}));
  transactions.push(await add(3,{amount:'40.40',pending:true}));
  transactions.push(await add(4,{amount:null,currency:null,blocked:true}));
  transactions.push(await add(5,{source:'SYNTHETIC-B',amount:'999.99',failure:'ghost_vendors'}));
  for(const [i,team] of [[0,teams.A],[2,teams.B]]) await db.query("select act_on_feed_exception($1,'SYNTHETIC-A',$2,'ASSIGN',0,'SYNTHETIC initial assignment',$3,null)",[users.admin,transactions[i],team]);
  return {db,users,teams,transactions,add};
}
