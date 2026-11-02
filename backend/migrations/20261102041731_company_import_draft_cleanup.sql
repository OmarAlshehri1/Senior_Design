-- Portable, owner-only draft retention. Scheduling is an explicit platform step.
create index company_import_batches_expired_drafts_idx
    on public.company_import_batches(expires_at,id)
    where confirmed_at is null and receipts is null;

create table public.company_import_cleanup_runs (
    id uuid primary key default gen_random_uuid(),
    started_at timestamptz not null,
    completed_at timestamptz not null,
    deleted_batches integer not null check(deleted_batches>=0),
    batch_limit integer not null check(batch_limit between 1 and 100)
);
alter table public.company_import_cleanup_runs enable row level security;
revoke all on public.company_import_cleanup_runs from public,anon,authenticated,service_role;

create function public.cleanup_expired_company_imports(p_limit integer default 100)
returns jsonb language plpgsql security invoker set search_path=''
set statement_timeout='20s' set lock_timeout='1s' as $$
declare cutoff timestamptz:=clock_timestamp(); deleted_count integer; run_id uuid;
begin
    if p_limit is null or p_limit not between 1 and 100 then
        raise exception 'Cleanup limit must be between 1 and 100' using errcode='22023';
    end if;
    if not pg_try_advisory_xact_lock(14721,1) then
        return jsonb_build_object('deleted_batches',0,'skipped_busy',true);
    end if;
    with candidates as materialized (
        select b.id from public.company_import_batches b
        where b.confirmed_at is null and b.receipts is null and b.expires_at<=cutoff
          and b.created_at<=cutoff-interval '24 hours'
        order by b.expires_at,b.id for update skip locked limit p_limit
    ), removed as (
        delete from public.company_import_batches b using candidates c where b.id=c.id
          and b.confirmed_at is null and b.receipts is null and b.expires_at<=cutoff
          and b.created_at<=cutoff-interval '24 hours' returning b.id
    ) select count(*) into deleted_count from removed;
    insert into public.company_import_cleanup_runs(started_at,completed_at,deleted_batches,batch_limit)
        values(cutoff,clock_timestamp(),deleted_count,p_limit) returning id into run_id;
    return jsonb_build_object('run_id',run_id,'deleted_batches',deleted_count,'skipped_busy',false);
end;
$$;
revoke all on function public.cleanup_expired_company_imports(integer) from public,anon,authenticated,service_role;
