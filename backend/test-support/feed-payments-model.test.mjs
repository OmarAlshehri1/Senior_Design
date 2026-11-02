import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createReviewFixture} from './feed-review-fixture.mjs';

test('Payments source scoring preserves clock, model binding, partial coverage and alert idempotency', async()=>{
  const {db,add,users}=await createReviewFixture();
  try {
    await db.exec("update feed_audit_jobs set status='BLOCKED' where status='PENDING'");
    const approval={model_version:'payments-primary-no-calendar-1.0.0',feature_version:'payments-source-no-calendar-1.0.0',
      artifact_sha256:'a'.repeat(64),validation_reference:'SYNTHETIC independent runtime verification',
      population_reference:'SYNTHETIC Payments source',supported_currencies:['USD'],dataset_key:'synthetic-payments-v1',
      model_bucket:'private-models',model_object:'payments/model.joblib'};
    await db.query(`insert into ingestion_sources(id,organization_id,credential_hash,mapping_version,active,audit_enabled,audit_context_version)
      values('AI-TEST','30000000-0000-4000-8000-000000000001',repeat('f',64),'v1',true,true,'ai-v1')`);
    await db.query("insert into feed_audit_contexts(source_id,version,configuration) values('AI-TEST','ai-v1',$1)",
      [JSON.stringify({time_basis:'SIMULATED_ARRIVAL_TIME',model_approval:approval})]);
    const keys=['segregation_of_duties','approval_limits','duplicate_payment','invoice_splitting','ghost_vendors'];
    async function claim(i,canonical={}) {
      await add(i,{source:'AI-TEST',pending:true,canonical:{timestamp:null,source_date:'2026-01-01',vendor_name:'SYNTHETIC original',...canonical}});
      return (await db.query('select claim_feed_audit() value')).rows[0].value;
    }
    function bundle(job,evaluated=5,failed=5) {
      const ruleScore=evaluated?Math.round(10000*failed/evaluated)/100:null;
      const risk=evaluated===5?Math.round((.6*ruleScore+.4*80)*100)/100:null;
      return {transaction_id:job.transaction_id,engine_version:'feed-audit-1.1.0',time_basis:'SIMULATED_ARRIVAL_TIME',
        evaluation_time:job.snapshot.evaluation_time,rule_score:ruleScore,ai_score:80,risk_score:risk,
        risk_level:risk===null?null:risk>=75?'HIGH':risk>=50?'MEDIUM':'LOW',
        rule_results:keys.map((rule_key,i)=>({rule_key,status:i>=evaluated?'NOT_EVALUATED':i<failed?'FAILED':'PASSED',evidence:{}})),
        anomaly:{status:'SCORED',model_version:approval.model_version,artifact_sha256:approval.artifact_sha256,
          feature_version:approval.feature_version,feature_time_basis:'SOURCE_FIELDS',dataset_key:approval.dataset_key}};
    }
    async function finish(j,b) {
      return (await db.query('select finish_feed_audit($1,$2,$3) value',[j.transaction_id,j.lease_token,JSON.stringify(b)])).rows[0].value;
    }
    const first=await claim(1000);
    const good=bundle(first);
    for(const mutate of [
      b=>b.anomaly.dataset_key='different-source',b=>b.anomaly.feature_time_basis='SIMULATED_ARRIVAL_TIME',
      b=>b.anomaly.artifact_sha256='b'.repeat(64),b=>b.anomaly.feature_version='wrong',
      b=>b.evaluation_time='2020-01-01T00:00:00Z',b=>b.risk_score=100]) {
      const bad=structuredClone(good);mutate(bad);await assert.rejects(finish(first,bad));
    }
    assert.equal(await finish(first,good),true);
    assert.equal(await finish(first,good),true);
    assert.equal((await db.query('select count(*)::int n from feed_audit_alerts where transaction_id=$1',[first.transaction_id])).rows[0].n,1);
    const partial=await claim(1001);
    const partialBundle=bundle(partial,3,1);
    await assert.rejects(finish(partial,{...partialBundle,risk_score:52,risk_level:'MEDIUM'}),/risk policy/);
    assert.equal(await finish(partial,partialBundle),true);
    const saved=(await db.query('select bundle from feed_audit_results where transaction_id=$1',[partial.transaction_id])).rows[0].bundle;
    assert.equal(saved.ai_score,80);assert.equal(saved.risk_score,null);assert.equal(saved.coverage.evaluated,3);
    await db.query("insert into feed_review_users(source_id,user_id) values('AI-TEST',$1)",[users.admin]);
    const detail=(await db.query('select read_review_feed($1,$2,1,25,$3) value',[users.admin,'AI-TEST',partial.transaction_id])).rows[0].value.items[0];
    assert.equal(detail.ai_score,80);assert.equal(detail.risk_score,null);
    assert.ok(!JSON.stringify(detail).includes('private-models'));
    await assert.rejects(db.query('select read_review_feed($1,$2,1,25,$3)',[users.otherSupervisor,'AI-TEST',partial.transaction_id]),/access denied/);
    const missing=await claim(1002,{vendor_name:null});
    await assert.rejects(finish(missing,bundle(missing)),/source feature/);
    await db.query("update feed_audit_jobs set status='BLOCKED' where transaction_id=$1",[missing.transaction_id]);
    const otherCurrency=await claim(1003,{currency:'EUR'});
    await assert.rejects(finish(otherCurrency,bundle(otherCurrency)),/approval mismatch/);
    for(const role of ['anon','authenticated','service_role']) {
      assert.equal((await db.query("select has_function_privilege($1,'finish_feed_audit_before_name_window(uuid,uuid,jsonb)','EXECUTE') allowed",[role])).rows[0].allowed,false);
    }
  } finally {await db.close();}
});
