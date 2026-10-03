-- Apply only after explicit approval on a live database.
-- Runtime source creation and its recovery job share one database transaction.
create table public.transaction_processing_jobs (
    transaction_id text primary key references public.transactions(id),
    input jsonb not null,
    request_received_at timestamptz not null,
    status text not null default 'PENDING' check (status in ('PENDING', 'PROCESSING', 'COMPLETED')),
    attempts integer not null default 0,
    available_at timestamptz not null default now(),
    lease_token uuid,
    lease_until timestamptz,
    result jsonb,
    alert_event jsonb,
    event_pending boolean not null default false,
    created_at timestamptz not null default now(),
    completed_at timestamptz
);
create index transaction_processing_pending_idx on public.transaction_processing_jobs(status, available_at, lease_until);
alter table public.transaction_processing_jobs enable row level security;
revoke all on public.transaction_processing_jobs from anon, authenticated;
grant select, insert, update on public.transaction_processing_jobs to service_role;

create function public.create_transaction_with_job(p_input jsonb, p_received_at timestamptz)
returns void language plpgsql security invoker set search_path = '' as $$
begin
    insert into public.transactions (
        id, transaction_timestamp, vendor_id, vendor_name, invoice_number, category,
        amount, currency, created_by, approved_by, approver_role, approval_limit,
        completeness_status, missing_fields
    ) values (
        p_input->>'id', (p_input->>'timestamp')::timestamptz,
        p_input->>'vendor_id', p_input->>'vendor_name', p_input->>'invoice_number',
        p_input->>'category', (p_input->>'amount')::numeric, p_input->>'currency',
        p_input->>'created_by', p_input->>'approved_by', p_input->>'approver_role',
        (p_input->>'approval_limit')::numeric, p_input->>'data_quality_status',
        coalesce(p_input->'missing_fields', '[]'::jsonb)
    );
    insert into public.transaction_processing_jobs(transaction_id, input, request_received_at)
    values (p_input->>'id', p_input, p_received_at);
end;
$$;

create function public.claim_transaction_job(p_id text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.transaction_processing_jobs;
begin
    select * into j from public.transaction_processing_jobs where transaction_id = p_id for update;
    if not found then raise exception 'Processing job missing'; end if;
    if j.status = 'COMPLETED' then return to_jsonb(j); end if;
    if j.status = 'PENDING' and j.available_at > clock_timestamp() then return null; end if;
    if j.status = 'PROCESSING' and j.lease_until > clock_timestamp() then return null; end if;
    update public.transaction_processing_jobs set status = 'PROCESSING',
        lease_token = gen_random_uuid(), lease_until = clock_timestamp() + interval '5 minutes',
        attempts = attempts + 1 where transaction_id = p_id returning * into j;
    return to_jsonb(j);
end;
$$;

create function public.finish_transaction_job(p_id text, p_token uuid, p_bundle jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare j public.transaction_processing_jobs; r jsonb; a jsonb; alert_record public.alerts;
begin
    select * into j from public.transaction_processing_jobs where transaction_id = p_id for update;
    if not found then raise exception 'Processing job missing'; end if;
    -- Lost HTTP responses can safely replay the committed result.
    if j.status = 'COMPLETED' then return to_jsonb(j); end if;
    if j.status <> 'PROCESSING' or j.lease_token is distinct from p_token
       or j.lease_until <= clock_timestamp() then raise exception 'Processing lease expired'; end if;
    r := p_bundle->'result'; a := p_bundle->'anomaly';
    if r->>'id' is distinct from p_id then raise exception 'Result identity mismatch'; end if;
    if (r->>'risk_score')::numeric is distinct from
       round(0.60 * (r->>'rule_score')::numeric + 0.40 * (r->>'ai_score')::numeric, 2)
       then raise exception 'Risk policy mismatch'; end if;
    insert into public.transaction_evaluations(transaction_id, evaluation_version, rule_status, rule_score, rule_results)
    values (p_id, p_bundle->>'rule_version', r->>'rule_status', (r->>'rule_score')::numeric, r->'rule_results');
    insert into public.transaction_anomaly_scores(transaction_id, model_version, ai_score, threshold, is_anomalous)
    values (p_id, p_bundle->>'model_version', (r->>'ai_score')::numeric, (a->>'threshold')::numeric, (a->>'is_anomalous')::boolean);
    if r->>'risk_score' is not null then
        insert into public.transaction_risk_scores(transaction_id, scoring_version, rule_evaluation_version, anomaly_model_version, rule_score, ai_score, risk_score, risk_level)
        values (p_id, p_bundle->>'risk_version', p_bundle->>'rule_version', p_bundle->>'model_version',
            (r->>'rule_score')::numeric, (r->>'ai_score')::numeric, (r->>'risk_score')::numeric, r->>'risk_level');
    end if;
    if r->>'risk_level' = 'HIGH' then
        insert into public.alerts(transaction_id, severity, title, description, reason, risk_score, risk_scoring_version, request_received_at)
        values (p_id, 'HIGH', 'High-risk transaction detected', 'The transaction requires auditor review.',
            'Rule and anomaly results exceeded the high-risk threshold.', (r->>'risk_score')::numeric,
            p_bundle->>'risk_version', j.request_received_at) returning * into alert_record;
    end if;
    update public.transaction_processing_jobs set status = 'COMPLETED', result = r,
        alert_event = case when alert_record.id is not null then to_jsonb(alert_record) else null end,
        event_pending = alert_record.id is not null, completed_at = clock_timestamp(),
        lease_token = null, lease_until = null where transaction_id = p_id returning * into j;
    return to_jsonb(j);
end;
$$;

-- Recover old leases after a crash; release only the caller's current lease.
create function public.release_transaction_job(p_id text, p_token uuid)
returns void language sql security invoker set search_path = '' as $$
    update public.transaction_processing_jobs set status = 'PENDING', lease_token = null, lease_until = null,
        available_at = clock_timestamp() + least(attempts * 30, 300) * interval '1 second'
    where transaction_id = p_id and status = 'PROCESSING' and lease_token = p_token;
$$;

create function public.get_pending_transaction_jobs(p_limit integer default 25)
returns table(transaction_id text) language sql security invoker set search_path = '' as $$
    select j.transaction_id from public.transaction_processing_jobs j
    where (j.status = 'PENDING' and j.available_at <= clock_timestamp())
       or (j.status = 'PROCESSING' and j.lease_until <= clock_timestamp())
    order by j.available_at, j.created_at, j.transaction_id
    limit greatest(1, least(p_limit, 100));
$$;

create function public.get_transaction_processing_statuses(p_ids text[])
returns table(transaction_id text, status text) language sql stable security invoker set search_path = '' as $$
    select j.transaction_id, j.status from public.transaction_processing_jobs j
    where j.transaction_id = any(p_ids);
$$;

revoke all on function public.get_transaction_processing_statuses(text[]) from public, anon, authenticated;
grant execute on function public.get_transaction_processing_statuses(text[]) to service_role;

revoke all on function public.create_transaction_with_job(jsonb, timestamptz),
    public.claim_transaction_job(text), public.finish_transaction_job(text, uuid, jsonb),
    public.release_transaction_job(text, uuid), public.get_pending_transaction_jobs(integer) from public, anon, authenticated;
grant execute on function public.create_transaction_with_job(jsonb, timestamptz),
    public.claim_transaction_job(text), public.finish_transaction_job(text, uuid, jsonb),
    public.release_transaction_job(text, uuid), public.get_pending_transaction_jobs(integer) to service_role;
