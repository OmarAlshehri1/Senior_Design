import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

test('company imports atomically pin mappings, enforce scope, deduplicate and expose durable progress', async () => {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb)");
    const dir = new URL('../migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) {
      try { await db.exec(await readFile(new URL(file, dir), 'utf8')); }
      catch (e) { throw new Error(`${file}: ${e.message}`); }
    }
    const admin = '10000000-0000-4000-8000-000000000001';
    const other = '10000000-0000-4000-8000-000000000002';
    const auditor = '10000000-0000-4000-8000-000000000003';
    for (const [id, role] of [[admin, 'ADMIN'], [other, 'ADMIN'], [auditor, 'AUDITOR']]) {
      await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${role}${id.slice(-1)}@example.test`]);
      await db.query("update user_profiles set role=$2,account_status='ACTIVE' where id=$1", [id, role]);
    }
    for (const [source, hash, org] of [['A', 'a', 1], ['B', 'b', 2]]) {
      await db.query("insert into ingestion_sources(id,organization_id,credential_hash,mapping_version,active,audit_enabled) values($1,$2,$3,'v1',true,true)",
        [source, `20000000-0000-4000-8000-00000000000${org}`, hash.repeat(64)]);
    }
    for (const id of [admin, auditor]) await db.query("insert into feed_review_users(source_id,user_id) values('A',$1)", [id]);
    const rpc = async (name, args) => (await db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args)).rows[0].value;
    const mapping = { schema_version: '1.0', fields: { amount: { path: ['Value'] } }, supported_currencies: [] };
    const revision = 'c'.repeat(64);
    const row = (id, value) => ({ row: 2, record_id: id, original_record: { ID: id, Value: value } });
    const draft = async (rows, rejected = 0) => {
      const id = await rpc('store_company_import', [admin, 'A', JSON.stringify({ filename: 'demo.csv', records: rows })]);
      await rpc('preview_company_import', [admin, 'A', id, JSON.stringify({ revision, mapping, identity_column: 'ID',
        counts: { ACCEPTED: 0, PARTIAL: rows.length - rejected, REJECTED: rejected }, rows })]);
      return id;
    };
    assert.deepEqual(await rpc('list_company_import_sources', [admin]), [{ id: 'A' }]);
    for (const id of [other, auditor]) {
      assert.deepEqual(await rpc('list_company_import_sources', [id]), []);
      await assert.rejects(rpc('store_company_import', [id, 'A', '{}']), /FORBIDDEN/);
    }
    await assert.rejects(rpc('company_import_history', [admin, 'B']), /FORBIDDEN/);
    const first = await draft([row('TX-1', '60.01'), row('TX-2', '60.01')]);
    assert.equal((await db.query('select count(*)::int n from ingestion_receipts')).rows[0].n, 0);
    await assert.rejects(rpc('confirm_company_import', [admin, 'A', first, 'd'.repeat(64), null]), /PREVIEW_CHANGED/);
    const saved = await rpc('confirm_company_import', [admin, 'A', first, revision, 'Company export']);
    assert.equal(saved.inserted, 2);
    assert.equal(saved.duplicates, 0);
    assert.deepEqual(await rpc('confirm_company_import', [admin, 'A', first, revision, null]), saved);
    assert.equal((await db.query('select count(*)::int n from ingestion_jobs')).rows[0].n, 2);
    assert.equal((await db.query("select count(*)::int n from audit_events where action='TRANSACTIONS_IMPORTED'")).rows[0].n, 1);
    assert.equal((await rpc('company_import_history', [admin, 'A'])).profiles[0].name, 'Company export');
    const duplicate = await draft([row('TX-1', '60.01')]);
    const duplicateState = await rpc('get_company_import', [admin, 'A', duplicate]);
    assert.equal(duplicateState.preview.existing_duplicates, 1);
    assert.equal(duplicateState.preview.conflicts, 0);
    assert.equal((await rpc('confirm_company_import', [admin, 'A', duplicate, revision, null])).duplicates, 1);
    const conflict = await draft([row('TX-NEW', '99.99'), row('TX-1', '999.00')]);
    assert.equal((await rpc('get_company_import', [admin, 'A', conflict])).preview.conflicts, 1);
    await assert.rejects(rpc('confirm_company_import', [admin, 'A', conflict, revision, null]), /IMPORT_CONFLICT/);
    assert.equal((await db.query("select count(*)::int n from ingestion_receipts where record_id='TX-NEW'")).rows[0].n, 0);
    const invalid = await draft([row('TX-BAD', 'wrong')], 1);
    await assert.rejects(rpc('confirm_company_import', [admin, 'A', invalid, revision, null]), /IMPORT_NOT_READY/);
    const expired = await draft([row('TX-OLD', '1')]);
    await db.query("update company_import_batches set expires_at=clock_timestamp()-interval '1 hour' where id=$1", [expired]);
    await assert.rejects(rpc('confirm_company_import', [admin, 'A', expired, revision, null]), /IMPORT_NOT_READY/);
    const progress = await rpc('company_import_progress', [admin, 'A', first]);
    assert.equal(progress.total, 2); assert.equal(progress.pending, 2); assert.equal(progress.completed, 0);
    const job = await rpc('claim_ingestion_validation', []);
    assert.equal(job.configuration.fields.amount.path[0], 'Value');
    assert.ok(['TX-1', 'TX-2'].includes(JSON.parse(job.original_payload).record_id));
    await rpc('finish_ingestion_validation', [job.receipt_id, job.lease_token, JSON.stringify({
      engine_version: '1.0.0', intake_status: 'REJECTED', canonical: {}, reasons: [{ code: 'TEST_REJECTION' }],
    })]);
    assert.equal((await rpc('company_import_progress', [admin, 'A', first])).rejected, 1);
    for (const role of ['anon', 'authenticated']) {
      const checks = await db.query("select has_function_privilege($1,'public.confirm_company_import(uuid,text,uuid,text,text)','EXECUTE') allowed", [role]);
      assert.equal(checks.rows[0].allowed, false);
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select * from company_import_batches'), /permission denied/);
      await db.exec('reset role');
    }
    const bulkRows = Array.from({ length: 50000 }, (_, index) => ({ row: index + 2,
      record_id: `BULK-${index}`, original_record: { ID: `BULK-${index}`, Value: '100.01' } }));
    const bulk = await draft(bulkRows);
    const started = performance.now();
    const bulkResult = await rpc('confirm_company_import', [admin, 'A', bulk, revision, null]);
    const confirmationSeconds = (performance.now() - started) / 1000;
    assert.equal(bulkResult.inserted, 50000);
    assert.equal(bulkResult.duplicates, 0);
    assert.equal(bulkResult.items.length, 50000);
    const bulkProgress = await rpc('company_import_progress', [admin, 'A', bulk]);
    assert.equal(bulkProgress.total, 50000); assert.equal(bulkProgress.pending, 50000);
    assert.equal((await rpc('confirm_company_import', [admin, 'A', bulk, revision, null])).inserted, 50000);
    const jobs = await db.query('select count(*)::int n from ingestion_jobs');
    assert.equal(jobs.rows[0].n, 50002);
    console.log(JSON.stringify({ check: 'bulk_atomic_import', rows: 50000,
      confirmation_seconds: confirmationSeconds, engine: 'local in-memory PGlite',
      note: 'Queue acceptance only; not hosted throughput or completion of 50,000 audit jobs.' }));
    await db.query("update user_profiles set account_status='DISABLED' where id=$1", [admin]);
    await assert.rejects(rpc('company_import_progress', [admin, 'A', first]), /FORBIDDEN/);
  } finally { await db.close(); }
});
