-- Apply after 030. No hosted migration or automatic production rollout.
-- Keep existing immutable results/snapshots. Readiness waiting is explicit opt-in.
create index ingestion_receipts_scoped_arrival_idx
    on public.ingestion_receipts(source_id,organization_id,received_at,id);
create index feed_transactions_scoped_arrival_idx
    on public.feed_transactions(source_id,organization_id,received_at,receipt_id);
alter table public.feed_audit_jobs add column history_wait_started_at timestamptz;
alter table public.feed_audit_jobs add column history_wait_deadline timestamptz;

create or replace function public.claim_feed_audit_before_name_window()
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.feed_audit_jobs; t public.feed_transactions; config jsonb; history jsonb;
    captured timestamptz; simulated boolean; evaluation_time timestamptz;
    wait_seconds integer; scanned integer; unprepared integer; split_count integer; split_total numeric;
    selected_ready boolean:=false;
begin
    -- Skip at most 25 waiting candidates per call; never sleep while holding locks.
    for scanned in 1..25 loop
        select q.* into j from public.feed_audit_jobs q
            join public.feed_transactions x on x.id=q.transaction_id
            join public.ingestion_sources s on s.id=x.source_id and s.organization_id=x.organization_id
            where s.active and s.audit_enabled and ((q.status='PENDING' and q.available_at<=clock_timestamp())
                or (q.status='AUDITING' and q.lease_until<=clock_timestamp()))
            order by q.available_at,q.transaction_id for update of q skip locked limit 1;
        if not found then return null; end if;
        if j.attempts>=6 then
            update public.feed_audit_jobs set status='BLOCKED',last_error='RETRY_EXHAUSTED',lease_token=null,lease_until=null
                where transaction_id=j.transaction_id;
            return jsonb_build_object('blocked',true);
        end if;
        select * into t from public.feed_transactions where id=j.transaction_id;
        select configuration into config from public.feed_audit_contexts where source_id=t.source_id and version=t.context_version;
        simulated:=coalesce(config->>'time_basis','BUSINESS_EVENT_TIME')='SIMULATED_ARRIVAL_TIME';
        wait_seconds:=case when simulated and config->'simulation_splitting' is not null
            and config->'simulation_splitting'<>'null'::jsonb
            and jsonb_typeof(config->'simulation_history_wait_seconds')='number'
            and config->>'simulation_history_wait_seconds' ~ '^(0|[1-9]|[12][0-9]|30)$'
            then (config->>'simulation_history_wait_seconds')::integer else 0 end;
        if j.snapshot is null and wait_seconds>0
            and (j.history_wait_deadline is null or clock_timestamp()<j.history_wait_deadline)
            and exists(select 1 from public.ingestion_receipts r
                join public.ingestion_jobs vj on vj.receipt_id=r.id
                left join public.ingestion_validations v on v.receipt_id=r.id
                where r.source_id=t.source_id and r.organization_id=t.organization_id
                    and r.received_at>=t.received_at-interval '24 hours'
                    and (r.received_at,r.id)<(t.received_at,t.receipt_id)
                    and (vj.status in ('PENDING','VALIDATING')
                        or (vj.status='COMPLETED' and v.result->>'intake_status' in ('ACCEPTED','PARTIAL')))
                    and not exists(select 1 from public.feed_transactions p where p.receipt_id=r.id)) then
            captured:=clock_timestamp();
            update public.feed_audit_jobs set status='PENDING',lease_token=null,lease_until=null,
                history_wait_started_at=coalesce(history_wait_started_at,captured),
                history_wait_deadline=coalesce(history_wait_deadline,captured+make_interval(secs=>wait_seconds)),
                available_at=least(captured+interval '500 milliseconds',
                    coalesce(history_wait_deadline,captured+make_interval(secs=>wait_seconds))),
                last_error='HISTORY_PREPARATION_PENDING' where transaction_id=j.transaction_id;
            continue;
        end if;
        selected_ready:=true;
        exit;
    end loop;
    if not selected_ready then return null; end if;
    if j.snapshot is null and (t.context_version is null or config is not null) then
        captured:=clock_timestamp();
        evaluation_time:=case when simulated then t.received_at else t.transaction_timestamp end;
        -- One aggregate pass replaces repeated scans of the same prior-row CTE.
        select jsonb_build_object(
            'captured_at',captured,'arrival_cutoff',t.received_at,'arrival_cutoff_receipt',t.receipt_id,
            'prior_count',count(*),
            'arrival_window_count',count(*) filter(where p.currency=t.currency
                and p.received_at between t.received_at-interval '24 hours' and t.received_at),
            'incomplete_duplicate_count',count(*) filter(where p.amount is null or p.currency is null
                or p.vendor_id is null or p.invoice_number is null
                or p.identity_context->>'vendor_namespace' is distinct from t.identity_context->>'vendor_namespace'),
            'incomplete_window_count',count(*) filter(where p.amount is null or p.currency is null
                or p.vendor_id is null or (not simulated and p.transaction_timestamp is null)
                or p.identity_context->>'vendor_namespace' is distinct from t.identity_context->>'vendor_namespace'),
            'duplicate_payment_count',count(*) filter(where p.amount=t.amount and p.currency=t.currency
                and p.vendor_id=t.vendor_id and p.invoice_number=t.invoice_number
                and p.identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace')),
            count(*) filter(where p.vendor_id=t.vendor_id and p.currency=t.currency
                and p.identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
                and (case when simulated then p.received_at else p.transaction_timestamp end)
                    between evaluation_time-interval '24 hours' and evaluation_time),
            coalesce(sum(p.amount) filter(where p.vendor_id=t.vendor_id and p.currency=t.currency
                and p.identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
                and (case when simulated then p.received_at else p.transaction_timestamp end)
                    between evaluation_time-interval '24 hours' and evaluation_time),0)+t.amount
            into history,split_count,split_total
        from public.feed_transactions p where p.source_id=t.source_id and p.organization_id=t.organization_id
            and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id);
        select count(*) into unprepared from public.ingestion_receipts r
            where r.source_id=t.source_id and r.organization_id=t.organization_id
                and (r.received_at,r.id)<(t.received_at,t.receipt_id)
                and not exists(select 1 from public.feed_transactions p where p.receipt_id=r.id);
        history:=history||jsonb_build_object('unprepared_prior_count',unprepared,
            'invoice_splitting_context',jsonb_build_object('historical_transaction_count',split_count,
                'window_total_amount',split_total::text));
        j.snapshot:=jsonb_build_object('configuration',config,'history',history,'context_version',t.context_version,
            'time_basis',case when simulated then 'SIMULATED_ARRIVAL_TIME' else 'BUSINESS_EVENT_TIME' end,
            'evaluation_time',evaluation_time);
        if wait_seconds>0 then
            j.snapshot:=j.snapshot||jsonb_build_object('history_readiness',jsonb_build_object(
                'policy_seconds',wait_seconds,'wait_started_at',j.history_wait_started_at,
                'deadline',j.history_wait_deadline,'deadline_reached',
                coalesce(captured>=j.history_wait_deadline,false)));
        end if;
    end if;
    update public.feed_audit_jobs set status='AUDITING',attempts=attempts+1,lease_token=gen_random_uuid(),
        lease_until=clock_timestamp()+interval '60 seconds',snapshot=j.snapshot,last_error=null
        where transaction_id=j.transaction_id returning * into j;
    return jsonb_build_object('transaction_id',t.id,'lease_token',j.lease_token,'source_id',t.source_id,
        'canonical',t.canonical,'identity_context',t.identity_context,'context_version',t.context_version,'snapshot',j.snapshot);
end;
$$;
revoke all on function public.claim_feed_audit_before_name_window() from public,anon,authenticated,service_role;
