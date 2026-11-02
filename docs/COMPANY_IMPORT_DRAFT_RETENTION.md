# Automatic cleanup of abandoned uploads

Unconfirmed uploads retain the existing 24-hour access expiry. Automatic cleanup
physically deletes a draft only when all of these are true:

- It was created at least 24 hours ago.
- Its recorded expiry has passed.
- It has never been confirmed.
- It has no saved receipt references.

Confirmed imports, receipts, validation results, audit jobs/results, saved mapping
profiles and active Payments transactions are outside the cleanup operation.
An inconsistent receipt-bearing draft is retained for operator review. Missing
or changed source grants do not prevent eventual cleanup of abandoned raw drafts.

The database job runs every 15 minutes, deleting at most 100 eligible drafts in
expiry order per run. Backlogs or locked drafts can take additional runs. Row
locks skip in-progress work; an advisory lock prevents overlapping cleanup runs.
Confirmation and cleanup use the same draft-row locking boundary. Every delete
rechecks the retention predicates, so a confirmed or receipt-bearing row is kept.

The function is owner-only, uses invoker privileges and a fixed search path, and
is not executable by anon, authenticated or service_role. No user-facing cleanup
endpoint is added. The private RLS-enabled run log contains only run IDs, times,
limits and deletion counts; it stores no filenames, source records or row payloads.

Portable schema migration:
`backend/migrations/20261102041731_company_import_draft_cleanup.sql`.
It creates the index, guarded function and aggregate log without activating a
schedule. The separate operator script
`docs/sql/activate_company_import_cleanup.sql` enables Supabase Cron in a selected
environment and upserts one named job. Production activation is a separate step.
The scheduler runs in the database independently of Render, the local monitoring
computer and application restarts. No HTTP credentials or extra hosting service
are required. A 20-second top-level timeout bounds each scheduled cleanup.

Inspect `cron.job` and `cron.job_run_details` for configuration and scheduler
status, and `public.company_import_cleanup_runs` for deleted-draft counts.
Disable this job with `cron.alter_job(jobid, active := false)`; do not drop the
shared cron extension. Disabling cleanup does not restore already expired/deleted
drafts. Database backup/WAL retention remains a separate provider policy.

Local acceptance covers expired, fresh, extended-expiry, confirmed and
receipt-bearing drafts, minimum age, invalid limits, bounded/idempotent passes,
API-role denial and unchanged receipt/audit evidence. Hosted acceptance must
verify an actual scheduled run against a clearly marked synthetic expired draft,
then restore the final 15-minute schedule. Existing confirmed imports and the
running load-test batch must remain unchanged.
