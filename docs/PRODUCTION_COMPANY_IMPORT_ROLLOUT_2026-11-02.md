# Company import release: production rollout checklist

Current activation update: the user approved a separate remaining-Payments source
and its first 100-row import. Import/intake/validation/audit/review are now enabled;
AI remains off. Import and report checks passed, but all five rules are unavailable
until reference context is configured. Existing Payments counts/checksums are unchanged.
See [the first import and its limits](REMAINING_PAYMENTS_FIRST_IMPORT_2026-11-02.md).
The rollout status below records the earlier deployment checkpoint.

**Status update:** the owner approved the schema-only step, and all 26 reviewed
migrations have now been applied once and verified. Do not repeat section 3.
See [the schema execution record](PRODUCTION_SCHEMA_ROLLOUT_2026-11-02.md).
The approved backend application deployment is also complete: PR #40 merged and
`39011d8` is live with new features held off. Do not repeat that merge/deployment.
The owner-published frontend passed [production verification](PRODUCTION_FRONTEND_VERIFICATION_2026-11-02.md).
Source onboarding/activation remain pending. See [the application rollout record](PRODUCTION_APPLICATION_ROLLOUT_2026-11-02.md)
and [frontend handoff](FRONTEND_PRODUCTION_HANDOFF_2026-11-02.md). Use remaining
activation steps only after their approval and the conditions in
[the readiness review](PRODUCTION_READINESS_2026-11-02.md).

## 1. Pin the release and rollback points

- Recheck main and the candidate; resolve any new upstream changes in an isolated
  checkout and repeat affected checks before approval. Reviewed main was
  `71ca4a0d5d12e1082ca3f415d5de7e99ca8f056f`; reviewed application candidate was
  `b1ca6416d32454ae0218ed446bc0cda09b087331`.
- Record Render's currently live production deployment. At review it was
  `dep-dbjjrpqvcj2c73f28qjg`, application commit
  `f4f4a7ab4522d10010a39e7bf94b48dbcab5dacd`, service
  `srv-db14j6m0tbcc739gavig`. Do not substitute main's latest SHA for the actual
  rollback deployment.
- Have the frontend owner record the live Vercel production deployment and its
  rollback method. Verify that its API base URL targets the production backend.
- Confirm the production project's normal recovery/backup arrangements with its
  owner. No database reset, reimport, seed replay or existing-record rewrite is
  part of this release.

## 2. Verify the production boundary and prerequisites

- Target Supabase project `sqiqspqfpbotmwrerbsi`; staging is
  `gunvsnvxipetxavpajjv`. Verify the target before each operator action.
- Run [the read-only preflight](sql/production_company_import_readiness_preflight.sql).
  Identity, application sessions, audit teams/memberships and pgcrypto were
  present at review. The private Payments-model bucket exists; the new feed and
  company-import schemas were absent.
- Check the migration history and current object definitions. The existing
  history has timestamped Payments/dashboard/filter entries; it does not prove
  that numbered baseline migrations 001-025 should be replayed.
- Verify production secrets stay in the backend and existing production
  configuration remains intact. Do not pull or publish secret values as evidence.

## 3. Apply only the reviewed schema delta

- Use the established production migration process to apply the **26 files in
  [this ordered manifest](evidence/production_release_migration_manifest_2026-11-02.json)**.
  Its hashes cover Git blob contents at the reviewed source commit, avoiding
  Windows checkout line-ending differences. Obtain each exact reviewed file.
- Apply each once, in order, and record its actual production migration version,
  name, checksum and result. Skip a file only after proving the corresponding
  change is already applied and matches the reviewed definition.
- Do not run an unfiltered migration-directory replay or reset to reconcile the
  historical numbering. Stop on the first migration error, retain its state and
  investigate before continuing. Do not enable imports on a partial schema.
- Recheck RLS and service-only function privileges with the same source/role
  denial cases. Run advisors after the schema change and compare with the
  recorded baseline; explain informational private-table/no-policy notices.
- No production source registrations, simulated policies, model-context inserts,
  test-user activations or dataset loading are embedded in this migration step.

## 4. Deploy compatible code with new features held off

- Verify these new flags are false before code deployment/activation:
  `COMPANY_IMPORTS_ENABLED`, `INGESTION_ENABLED`,
  `INGESTION_VALIDATION_ENABLED`, `INGESTION_AUDIT_ENABLED`,
  `FEED_REVIEW_ENABLED`, `INGESTION_FEED_ANOMALY_ENABLED` and
  `INGESTION_TIMING_ENABLED`. Record actual values without exposing secrets.
- Leave `INGESTION_PREWARM_PAYMENTS_BINDING` unset unless a production-specific
  trusted binding has been verified. Do not copy its staging JSON blindly.
- Merge/deploy only after explicit release approval. Render automatically deploys
  backend changes on main; coordinate the teammate-owned frontend deployment.
  A main push also triggers the repository's existing Telegram workflow.
- Check the production health endpoint and existing Payments dashboard,
  categories, filters, permissions and Business Reports with the new modules
  disabled. Verify no data population or model selection changed.

## 5. Onboard and activate a production source separately

- Obtain a company-approved source identity, stable record IDs, field mapping,
  organizational ownership and named Admin assignment. CSV/XLSX import access
  requires direct source assignment, not merely the Admin role.
- Verify currencies, identity namespaces, vendor/approval references, history
  coverage and time basis. Missing fields must remain unavailable. Staging's
  fictional simulation context, including its expiry, is not company evidence.
- Verify source-compatible model provenance, private object/hash and required
  fields before approving AI. The existing Payments model does not validate an
  unrelated company's data. Keep AI unavailable when no suitable model is approved.
- Approve confirmed-data/backup retention and, separately, draft cleanup policy.
  The optional [cleanup activation script](sql/activate_company_import_cleanup.sql)
  schedules deletion of expired unconfirmed drafts; it was not run in production.
- Enable only the approved source and required feature flags. Start with an
  explicitly authorized controlled import; do not replay the existing Payments
  dataset. Record receipt IDs and processing completion.

## 6. Verify the actual production flow

- Check real Admin upload -> preview -> confirmation -> durable processing ->
  source-scoped Feed Review -> department summary -> PDF/XLSX download.
- Verify Supervisor/Auditor import denial, unauthenticated denial, and denial
  for an unassigned source. Check replay, conflicting records, invalid rows and
  recovery after reloading the page.
- Verify exact totals, separate currencies, department labels, export scope,
  spreadsheet text safety and the intended report population. Imported feed
  records remain separate from the active Payments dashboard population.
- Record client upload-to-confirmation and database processing intervals with
  their distinct boundaries. Preserve failures. S4 is partial; do not advertise
  an unconditional five-second or notification-delivery guarantee.
- Disable test-only sources, log out test sessions, and confirm no credentials,
  sensitive records or private artifacts enter public verification logs.

## Rollback

Disable the new import/feed/scoring flags and source intake first. Restore the
previous backend build and have the frontend owner restore its recorded compatible
deployment. Retain additive schema, receipts, source contexts, saved results and
audit history. If a cleanup cron was separately activated, disable only that job;
do not remove shared scheduler extensions. Investigate partial migrations or
pending durable jobs before resuming. Existing records are not deleted or replayed
as part of rollback.
