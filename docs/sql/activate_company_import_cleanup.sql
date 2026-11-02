-- Explicit operator configuration for the selected environment only.
-- Apply the portable company_import_draft_cleanup migration and verify retention first.
-- This file is not an automatically replayed application migration.
create extension if not exists pg_cron;

select cron.schedule(
    'company-import-expired-drafts',
    '*/15 * * * *',
    $job$set statement_timeout='20s'; select public.cleanup_expired_company_imports(100);$job$
);

-- Verify: exactly one active job with this name and the schedule above.
-- Disable only this job with cron.alter_job(jobid, active := false).
-- Do not drop pg_cron: other jobs can share the extension.
