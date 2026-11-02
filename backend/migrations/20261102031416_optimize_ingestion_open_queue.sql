-- Match the claim worker's exact ORDER BY so LIMIT 1 need not sort the backlog.
-- Keep completed/blocked evidence outside this hot queue index.
set local lock_timeout = '2s';
create index ingestion_jobs_open_order_idx
    on public.ingestion_jobs(available_at,created_at,receipt_id)
    where status in ('PENDING','VALIDATING');
analyze public.ingestion_jobs;
analyze public.ingestion_receipts;
