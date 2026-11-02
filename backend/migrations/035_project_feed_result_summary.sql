-- Derived read fields only. Saved bundles, audit decisions and timestamps stay immutable.
-- Computed atomically on INSERT; no polling cache or stale aggregate counters.
alter table public.feed_audit_results
    add column ui_simulation_status text generated always as
        (bundle->'simulation_indicator'->>'status') stored,
    add column ui_ghost_failed boolean generated always as
        (bundle @> '{"rule_results":[{"rule_key":"ghost_vendors","status":"FAILED"}]}'::jsonb) stored;
-- Existing table RLS and revoked role privileges cover these columns too.
