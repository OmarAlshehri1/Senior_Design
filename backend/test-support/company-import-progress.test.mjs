import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewFixture } from './feed-review-fixture.mjs';

test('custom-planned progress preserves batch/source/actor boundaries and mixed processing outcomes', async () => {
  const { db, users } = await createReviewFixture();
  try {
    const receipts = (await db.query("select id from ingestion_receipts where source_id='SYNTHETIC-A' order by record_id")).rows;
    for (const row of receipts) await db.query("insert into ingestion_jobs(receipt_id,status) values($1,'COMPLETED')", [row.id]);
    const rejected = (await db.query(`insert into ingestion_receipts(source_id,organization_id,event_id,record_id,schema_version,event_type,mapping_version,fingerprint,original_payload,envelope)
      values('SYNTHETIC-A','30000000-0000-4000-8000-000000000001','REJECTED-1','REJECTED-1','1.0','transaction.created','v1',repeat('a',64),'{}','{}') returning id`)).rows[0].id;
    await db.query("insert into ingestion_jobs(receipt_id,status) values($1,'COMPLETED')", [rejected]);
    await db.query('insert into ingestion_validations(receipt_id,result) values($1,$2)', [rejected, JSON.stringify({ engine_version:'1.0.0',intake_status:'REJECTED',canonical:{},reasons:[] })]);
    const other = (await db.query("select id from ingestion_receipts where source_id='SYNTHETIC-B' limit 1")).rows[0].id;
    const items = [...receipts.map(r => ({ receipt_id:r.id })), { receipt_id:rejected }, { receipt_id:other }];
    const document = { filename:'SYNTHETIC.csv',records:[{row:2,record:{reference:'SYNTHETIC'}}] };
    const batch = (await db.query(`insert into company_import_batches(source_id,actor_id,document,confirmed_at,receipts)
      values('SYNTHETIC-A',$1,$2,clock_timestamp(),$3) returning id`, [users.admin,JSON.stringify(document),JSON.stringify({inserted:6,duplicates:0,items})])).rows[0].id;
    const progress = async (actor=users.admin,source='SYNTHETIC-A',id=batch) => {
      await db.exec('set role service_role');
      try {return (await db.query('select company_import_progress($1,$2,$3) value',[actor,source,id])).rows[0].value;}
      finally {await db.exec('reset role');}
    };
    assert.deepEqual(await progress(), {id:batch,confirmed:true,inserted:6,duplicates:0,total:6,completed:3,pending:1,blocked:1,rejected:1});
    await assert.rejects(progress(users.auditor), /FORBIDDEN/);
    await assert.rejects(progress(users.admin,'SYNTHETIC-B'), /FORBIDDEN/);
    await db.query("update user_profiles set role='ADMIN' where id=$1",[users.otherSupervisor]);
    await db.query("insert into feed_review_users(source_id,user_id) values('SYNTHETIC-A',$1)",[users.otherSupervisor]);
    await assert.rejects(progress(users.otherSupervisor), /NOT_FOUND/);
    const draft = (await db.query("insert into company_import_batches(source_id,actor_id,document) values('SYNTHETIC-A',$1,$2) returning id",[users.admin,JSON.stringify(document)])).rows[0].id;
    const empty = await progress(users.admin,'SYNTHETIC-A',draft);
    assert.equal(empty.confirmed,false); assert.equal(empty.total,0); assert.equal(empty.inserted,null);
    assert.equal(empty.completed+empty.pending+empty.blocked+empty.rejected,0);
    // A corrupted derived queue marker must never promote rejected evidence.
    await db.query('insert into feed_audit_preparations(receipt_id,received_at) select id,received_at from ingestion_receipts where id=$1', [rejected]);
    assert.equal((await db.query('select prepare_feed_audits(25) value')).rows[0].value,0);
    assert.equal((await db.query('select count(*)::int n from feed_audit_preparations where receipt_id=$1', [rejected])).rows[0].n,0);
    assert.equal((await db.query("select result->>'intake_status' state from ingestion_validations where receipt_id=$1", [rejected])).rows[0].state,'REJECTED');
    assert.equal((await db.query("select count(*)::int n from feed_transactions where source_id='SYNTHETIC-A'")).rows[0].n,5);
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      try {await assert.rejects(db.query('select company_import_progress($1,$2,$3)',[users.admin,'SYNTHETIC-A',batch]),/permission denied/);}
      finally {await db.exec('reset role');}
    }
  } finally {await db.close();}
});
