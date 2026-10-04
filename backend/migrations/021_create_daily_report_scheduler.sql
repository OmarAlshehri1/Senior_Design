create table public.daily_report_schedule_state (
    singleton boolean primary key default true check (singleton),
    next_period_start date not null,
    attempt_count integer not null default 0 check (attempt_count >= 0),
    available_at timestamptz not null default clock_timestamp(),
    lease_token uuid,
    lease_until timestamptz,
    active_run_id uuid,
    updated_at timestamptz not null default clock_timestamp(),
    check ((lease_token is null) = (lease_until is null)),
    check ((lease_token is null) = (active_run_id is null))
);

create table public.daily_report_runs (
    id uuid primary key default gen_random_uuid(),
    period_start date not null,
    period_end date not null,
    attempt_number integer not null check (attempt_number > 0),
    status text not null check (status in ('RUNNING', 'COMPLETED', 'FAILED')),
    started_at timestamptz not null default clock_timestamp(),
    completed_at timestamptz,
    report_id text references public.audit_reports(id) on delete set null,
    error_code text,
    unique (period_start, attempt_number),
    check (period_end = period_start + 1),
    check (
        (status = 'RUNNING' and completed_at is null and report_id is null and error_code is null)
        or (status = 'COMPLETED' and completed_at is not null and report_id is not null and error_code is null)
        or (status = 'FAILED' and completed_at is not null and report_id is null and error_code is not null)
    )
);

create index daily_report_runs_recent_idx on public.daily_report_runs (started_at desc);
alter table public.daily_report_schedule_state enable row level security;
alter table public.daily_report_runs enable row level security;
revoke all on public.daily_report_schedule_state, public.daily_report_runs from public, anon, authenticated, service_role;

insert into public.daily_report_schedule_state(singleton, next_period_start)
values (
    true,
    coalesce(
        (select (max(period_start) at time zone 'UTC')::date + 1
         from public.audit_reports where status = 'COMPLETED'),
        (timezone('UTC', clock_timestamp())::date - 1)
    )
);

create or replace function public.claim_daily_audit_report()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    state_row public.daily_report_schedule_state;
    run_key uuid;
    token uuid;
    attempt integer;
    due_through date := timezone('UTC', clock_timestamp())::date - 1;
begin
    select * into state_row from public.daily_report_schedule_state where singleton = true for update;
    if not found or state_row.next_period_start > due_through or state_row.available_at > clock_timestamp() then
        return null;
    end if;
    if state_row.lease_token is not null and state_row.lease_until > clock_timestamp() then
        return null;
    end if;
    if state_row.active_run_id is not null then
        update public.daily_report_runs
           set status = 'FAILED', completed_at = clock_timestamp(), error_code = 'WORKER_LEASE_EXPIRED'
         where id = state_row.active_run_id and status = 'RUNNING';
    end if;

    attempt := state_row.attempt_count + 1;
    token := gen_random_uuid();
    insert into public.daily_report_runs(period_start, period_end, attempt_number, status)
    values (state_row.next_period_start, state_row.next_period_start + 1, attempt, 'RUNNING')
    returning id into run_key;

    update public.daily_report_schedule_state
       set attempt_count = attempt, available_at = clock_timestamp(), lease_token = token,
           lease_until = clock_timestamp() + interval '10 minutes', active_run_id = run_key,
           updated_at = clock_timestamp()
     where singleton = true;

    return jsonb_build_object(
        'run_id', run_key, 'lease_token', token, 'attempt_number', attempt,
        'period_start', state_row.next_period_start::timestamp at time zone 'UTC',
        'period_end', (state_row.next_period_start + 1)::timestamp at time zone 'UTC'
    );
end;
$$;

create or replace function public.complete_daily_audit_report(
    p_run_id uuid, p_lease_token uuid, p_summary jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    state_row public.daily_report_schedule_state;
    run_row public.daily_report_runs;
    stored_report_id text;
    period_start_utc timestamptz;
    period_end_utc timestamptz;
begin
    select * into state_row from public.daily_report_schedule_state where singleton = true for update;
    if p_run_id is null or p_lease_token is null or p_summary is null
       or state_row.active_run_id is distinct from p_run_id
       or state_row.lease_token is distinct from p_lease_token
       or state_row.lease_until <= clock_timestamp() then
        raise exception 'Daily report lease is no longer valid' using errcode = '40001';
    end if;
    select * into run_row from public.daily_report_runs where id = p_run_id and status = 'RUNNING' for update;
    if not found or jsonb_typeof(p_summary) is distinct from 'object' then
        raise exception 'Daily report completion payload is invalid' using errcode = '22023';
    end if;

    period_start_utc := run_row.period_start::timestamp at time zone 'UTC';
    period_end_utc := run_row.period_end::timestamp at time zone 'UTC';
    stored_report_id := 'RPT-' || run_row.period_start::text;
    insert into public.audit_reports(id, report_type, status, period_start, period_end, summary, completed_at)
    values (stored_report_id, 'DAILY', 'COMPLETED', period_start_utc, period_end_utc,
            p_summary || jsonb_build_object('report_version', '1.0.0'), clock_timestamp())
    on conflict (period_start, period_end) do nothing;
    if not found then
        select id into stored_report_id from public.audit_reports
         where period_start = period_start_utc and period_end = period_end_utc and status = 'COMPLETED';
        if stored_report_id is null then
            raise exception 'Existing daily report is not complete' using errcode = '23514';
        end if;
    end if;

    update public.daily_report_runs
       set status = 'COMPLETED', completed_at = clock_timestamp(), report_id = stored_report_id
     where id = p_run_id;
    update public.daily_report_schedule_state
       set next_period_start = run_row.period_end, attempt_count = 0, available_at = clock_timestamp(),
           lease_token = null, lease_until = null, active_run_id = null, updated_at = clock_timestamp()
     where singleton = true;

    return jsonb_build_object('report_id', stored_report_id, 'period_start', period_start_utc, 'period_end', period_end_utc);
end;
$$;

create or replace function public.fail_daily_audit_report(
    p_run_id uuid, p_lease_token uuid, p_error_code text
)
returns boolean language plpgsql security definer set search_path = '' as $$
declare state_row public.daily_report_schedule_state; run_row public.daily_report_runs;
begin
    select * into state_row from public.daily_report_schedule_state where singleton = true for update;
    if not found or state_row.active_run_id is distinct from p_run_id or state_row.lease_token is distinct from p_lease_token then
        return false;
    end if;
    select * into run_row from public.daily_report_runs where id = p_run_id and status = 'RUNNING' for update;
    if not found then return false; end if;

    update public.daily_report_runs
       set status = 'FAILED', completed_at = clock_timestamp(),
           error_code = left(coalesce(nullif(p_error_code, ''), 'REPORT_GENERATION_FAILED'), 80)
     where id = p_run_id;
    update public.daily_report_schedule_state
       set available_at = clock_timestamp() + make_interval(secs => least(3600, 30 * power(2, least(run_row.attempt_number - 1, 7)))::integer),
           lease_token = null, lease_until = null, active_run_id = null, updated_at = clock_timestamp()
     where singleton = true;
    return true;
end;
$$;

create or replace function public.get_daily_report_schedule_status(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.user_profiles; state_row public.daily_report_schedule_state;
begin
    select * into actor from public.user_profiles where id = p_actor and account_status = 'ACTIVE';
    if not found or actor.role <> 'ADMIN' then
        raise exception 'Report schedule access denied' using errcode = '42501';
    end if;
    select * into state_row from public.daily_report_schedule_state where singleton = true;
    return jsonb_build_object(
        'next_period_start', state_row.next_period_start,
        'runs', coalesce((select jsonb_agg(jsonb_build_object(
            'id', r.id, 'period_start', r.period_start, 'period_end', r.period_end,
            'attempt_number', r.attempt_number, 'status', r.status, 'started_at', r.started_at,
            'completed_at', r.completed_at, 'report_id', r.report_id, 'error_code', r.error_code
        ) order by r.started_at desc) from (
            select * from public.daily_report_runs order by started_at desc limit 50
        ) r), '[]'::jsonb)
    );
end;
$$;

revoke all on function public.claim_daily_audit_report(),
    public.complete_daily_audit_report(uuid, uuid, jsonb),
    public.fail_daily_audit_report(uuid, uuid, text),
    public.get_daily_report_schedule_status(uuid) from public, anon, authenticated, service_role;
grant execute on function public.claim_daily_audit_report(),
    public.complete_daily_audit_report(uuid, uuid, jsonb),
    public.fail_daily_audit_report(uuid, uuid, text) to service_role;
grant execute on function public.get_daily_report_schedule_status(uuid) to service_role;
