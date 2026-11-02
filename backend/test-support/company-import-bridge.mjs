// Test-only in-memory SQL bridge. No network listener, credentials or hosted DB.
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const db = new PGlite({ extensions: { pgcrypto } });
await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb)");
const dir = new URL('../migrations/', import.meta.url);
for (const file of (await readdir(dir)).filter((n) => n.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file, dir), 'utf8'));
const admin = '10000000-0000-4000-8000-000000000001';
await db.query('insert into auth.users(id,email) values($1,$2)', [admin, 'fixture-admin@example.test']);
await db.query("update user_profiles set role='ADMIN',account_status='ACTIVE' where id=$1", [admin]);
const fields = Object.fromEntries(['amount', 'currency', 'timestamp', 'vendor_id', 'vendor_name', 'invoice_number', 'created_by', 'approved_by', 'category', 'approver_role'].map((key) => [key, { path: [key], ...(key === 'timestamp' ? { time: { precision: 'instant', format: 'iso8601' } } : {}) }]));
const mapping = { schema_version: '1.0', fields, supported_currencies: ['SAR'], actor_namespace: 'fixture-actors', vendor_namespace: 'fixture-vendors' };
const window = { reference: 'Synthetic conformance fixture only', valid_from: '2020-01-01T00:00:00Z' };
const context = { schema_version: '1.0', actor_namespace: 'fixture-actors', actor_case_insensitive: true,
  history: { ...window, authoritative: true, vendor_namespace: 'fixture-vendors' },
  approval_policies: [{ ...window, approver_id: 'ACTOR-1', currency: 'SAR', limit: '1000' }],
  vendor_registry: { ...window, authoritative: true, vendor_namespace: 'fixture-vendors', entries: [{ id: 'V-APPROVED', active: true }] },
  model_approval: { model_version: '1.0.0', feature_version: '1.0.0', artifact_sha256: process.env.IMPORT_FIXTURE_MODEL_HASH,
    validation_reference: 'Synthetic retail conformance fixture; not production company approval',
    population_reference: 'Synthetic test rows', supported_currencies: ['SAR'] } };
for (const [source, org] of [['fixture-company', 1], ['unapproved-company', 2]]) {
  await db.query("insert into ingestion_sources(id,organization_id,credential_hash,mapping_version,active,audit_enabled,audit_context_version) values($1,$2,$3,'v1',true,true,'v1')",
    [source, `20000000-0000-4000-8000-00000000000${org}`, createHash('sha256').update(source === 'fixture-company' ? 'j'.repeat(43) : 'k'.repeat(43)).digest('hex')]);
  await db.query('insert into ingestion_mappings(source_id,version,configuration) values($1,$2,$3)', [source, 'v1', JSON.stringify(mapping)]);
  await db.query('insert into feed_audit_contexts(source_id,version,configuration) values($1,$2,$3)', [source, 'v1', JSON.stringify(source === 'fixture-company' ? context : {})]);
  await db.query('insert into feed_review_users(source_id,user_id) values($1,$2)', [source, admin]);
}
const allowed = new Set(['list_company_import_sources', 'company_import_history', 'store_company_import', 'get_company_import',
  'preview_company_import', 'confirm_company_import', 'company_import_progress', 'claim_ingestion_validation', 'finish_ingestion_validation',
  'release_ingestion_validation', 'prepare_feed_audits', 'claim_feed_audit', 'finish_feed_audit', 'release_feed_audit',
  'list_review_feed_sources', 'read_review_feed', 'read_feed_summary_report', 'read_feed_exceptions',
  'ingestion_source', 'submit_ingestion_event', 'read_ingestion_receipts']);
console.log(JSON.stringify({ ready: true, mapping, admin }));
let sequence = Promise.resolve();
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  sequence = sequence.then(async () => {
    try {
      const request = JSON.parse(line);
      if (request.name === 'fixture_alert_summary') {
        const result = await db.query(`select count(*)::int as alerts,
          max(extract(epoch from (a.created_at-r.received_at))*1000)::numeric(14,3) as maximum_receipt_to_alert_ms
          from feed_audit_alerts a join feed_transactions t on t.id=a.transaction_id
          join ingestion_receipts r on r.id=t.receipt_id where t.source_id=$1`, [request.payload.p_source]);
        console.log(JSON.stringify({ result: result.rows[0] }));
        return;
      }
      if (!allowed.has(request.name)) throw new Error('Operation not allowed');
      const entries = Object.entries(request.payload);
      if (entries.some(([key]) => !/^p_[a-z_]+$/.test(key))) throw new Error('Invalid parameter');
      const sql = `select public.${request.name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')}) as value`;
      const values = entries.map(([, value]) => typeof value === 'object' && value !== null ? JSON.stringify(value) : value);
      const result = await db.query(sql, values);
      console.log(JSON.stringify({ result: result.rows[0].value }));
    } catch (error) { console.log(JSON.stringify({ error: error.message, code: error.code })); }
  });
});
input.on('close', async () => { await sequence; await db.close(); });
