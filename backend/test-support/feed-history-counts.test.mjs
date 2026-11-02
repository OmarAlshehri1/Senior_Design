import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReviewFixture } from './feed-review-fixture.mjs';

test('indexed history exactly matches the original aggregate for clocks, ties, missing fields and scope', async () => {
  const { db, add } = await createReviewFixture();
  try {
    const canonical = { vendor_id:'V1',invoice_number:'INV1',timestamp:'2026-10-24T10:07:00Z' };
    await add(6,{amount:'10.10',canonical:{...canonical,timestamp:'2020-01-01T00:00:00Z'},identityContext:{vendor_namespace:'REF'},receivedAt:'2026-10-24T10:06:00Z'});
    await add(7,{amount:'10.10',canonical,identityContext:{vendor_namespace:'REF'},receivedAt:'2026-10-24T10:06:00Z'});
    await add(8,{amount:'20.20',canonical,identityContext:{vendor_namespace:'OTHER'}});
    await add(9,{amount:'10.10',currency:'EUR',canonical,identityContext:{vendor_namespace:'REF'}});
    await add(10,{canonical:{...canonical,vendor_id:null,timestamp:null},identityContext:{vendor_namespace:'REF'}});
    await add(11,{canonical,identityContext:{vendor_namespace:null}});
    await add(12,{currency:null,canonical:{...canonical,invoice_number:null},identityContext:{vendor_namespace:'REF'}});
    await add(13,{amount:null,canonical,identityContext:{vendor_namespace:'REF'}});
    await add(14,{source:'SYNTHETIC-B',amount:'10.10',canonical,identityContext:{vendor_namespace:'REF'}});
    for(const source of ['SYNTHETIC-A','SYNTHETIC-B']) await db.query(`insert into ingestion_receipts(
      source_id,organization_id,event_id,record_id,schema_version,event_type,mapping_version,fingerprint,original_payload,envelope,received_at)
      values($1,'30000000-0000-4000-8000-000000000001','UNPREPARED','UNPREPARED','1.0','transaction.created','v1',repeat('c',64),'{}','{}','2026-10-24T09:00:00Z')`,[source]);
    const rows=(await db.query('select id,received_at,transaction_timestamp from feed_transactions')).rows;
    const original = `with current as (select * from feed_transactions where id=$1)
      select count(*) as prior_count,
        count(*) filter(where p.currency=t.currency and p.received_at between t.received_at-interval '24 hours' and t.received_at) as arrival_window_count,
        count(*) filter(where p.amount is null or p.currency is null or p.vendor_id is null or p.invoice_number is null
          or p.identity_context->>'vendor_namespace' is distinct from t.identity_context->>'vendor_namespace') as incomplete_duplicate_count,
        count(*) filter(where p.amount is null or p.currency is null or p.vendor_id is null or (not $2 and p.transaction_timestamp is null)
          or p.identity_context->>'vendor_namespace' is distinct from t.identity_context->>'vendor_namespace') as incomplete_window_count,
        count(*) filter(where p.amount=t.amount and p.currency=t.currency and p.vendor_id=t.vendor_id and p.invoice_number=t.invoice_number
          and p.identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace') as duplicate_payment_count,
        count(*) filter(where p.vendor_id=t.vendor_id and p.currency=t.currency and p.identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
          and (case when $2 then p.received_at else p.transaction_timestamp end) between $3::timestamptz-interval '24 hours' and $3) as split_count,
        coalesce(sum(p.amount) filter(where p.vendor_id=t.vendor_id and p.currency=t.currency and p.identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
          and (case when $2 then p.received_at else p.transaction_timestamp end) between $3::timestamptz-interval '24 hours' and $3),0)+(select amount from current) as split_total,
        (select count(*) from ingestion_receipts r join current c on r.source_id=c.source_id and r.organization_id=c.organization_id
          and (r.received_at,r.id)<(c.received_at,c.receipt_id)
          where not exists(select 1 from feed_transactions f where f.receipt_id=r.id)) as unprepared_prior_count
      from feed_transactions p cross join current t where p.source_id=t.source_id and p.organization_id=t.organization_id
        and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id)`;
    for(const row of rows) for(const simulated of [false,true]) {
      const params=[row.id,simulated,simulated?row.received_at:row.transaction_timestamp];
      const expected=(await db.query(original,params)).rows[0];
      const actual=(await db.query('select * from feed_history_counts($1,$2,$3)',params)).rows[0];
      assert.deepEqual(actual,expected);
    }
    await assert.rejects(db.query("update feed_transactions set received_at=received_at+interval '1 second' where id=$1",[rows[0].id]),/immutable|foreign key/);
    assert.equal((await db.query("select convalidated from pg_constraint where conname='feed_transactions_receipt_projection_fk'")).rows[0].convalidated,true);
    for(const role of ['anon','authenticated','service_role']) {
      await db.exec(`set role ${role}`);
      try {await assert.rejects(db.query('select * from feed_history_counts($1,true,$2)',[rows[0].id,rows[0].received_at]),/permission denied/);}
      finally {await db.exec('reset role');}
    }
    await db.exec('set role service_role');
    try {
      const claim=(await db.query('select claim_feed_audit() value')).rows[0].value;
      assert(claim?.snapshot?.history); assert(claim.lease_token);
    } finally {await db.exec('reset role');}
  } finally {await db.close();}
});
