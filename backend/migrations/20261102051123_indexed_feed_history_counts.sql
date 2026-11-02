-- Enforce the immutable one-to-one receipt projection used by prefix subtraction.
create unique index ingestion_receipts_projection_key
    on public.ingestion_receipts(id,source_id,organization_id,received_at);
alter table public.feed_transactions add constraint feed_transactions_receipt_projection_fk
    foreign key(receipt_id,source_id,organization_id,received_at)
    references public.ingestion_receipts(id,source_id,organization_id,received_at) not valid;
alter table public.feed_transactions validate constraint feed_transactions_receipt_projection_fk;

create index feed_history_currency_arrival_idx
    on public.feed_transactions(source_id,organization_id,currency,received_at,receipt_id);
create index feed_history_complete_fields_idx
    on public.feed_transactions(source_id,organization_id,(identity_context->>'vendor_namespace'),received_at,receipt_id)
    include(invoice_number,transaction_timestamp,identity_context)
    where amount is not null and currency is not null and vendor_id is not null;
create index feed_history_vendor_arrival_idx
    on public.feed_transactions(source_id,organization_id,vendor_id,currency,(identity_context->>'vendor_namespace'),received_at,receipt_id)
    include(amount,invoice_number,transaction_timestamp,identity_context)
    where vendor_id is not null and currency is not null;

create function public.feed_history_counts(p_id uuid,p_simulated boolean,p_evaluation timestamptz)
returns table(prior_count bigint,arrival_window_count bigint,incomplete_duplicate_count bigint,
    incomplete_window_count bigint,duplicate_payment_count bigint,split_count bigint,
    split_total numeric,unprepared_prior_count bigint)
language plpgsql stable security invoker set search_path='' as $$
declare t public.feed_transactions; ns text; complete_duplicates bigint; complete_window bigint; raw_prior bigint;
begin
    select * into t from public.feed_transactions where id=p_id;
    if not found then raise exception 'History transaction missing' using errcode='P0002'; end if;
    if p_simulated is null then raise exception 'Clock required' using errcode='22023'; end if;
    ns:=t.identity_context->>'vendor_namespace';
    select count(*) into prior_count from public.feed_transactions p
        where p.source_id=t.source_id and p.organization_id=t.organization_id
          and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id);
    select count(*) into arrival_window_count from public.feed_transactions p
        where p.source_id=t.source_id and p.organization_id=t.organization_id and p.currency=t.currency
          and p.received_at between t.received_at-interval '24 hours' and t.received_at
          and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id);
    select count(*) filter(where p.invoice_number is not null),
        count(*) filter(where p_simulated or p.transaction_timestamp is not null)
        into complete_duplicates,complete_window
        from public.feed_transactions p
        where p.source_id=t.source_id and p.organization_id=t.organization_id
          and p.amount is not null and p.currency is not null and p.vendor_id is not null
          and (p.identity_context->>'vendor_namespace') is not distinct from ns
          and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id);
    incomplete_duplicate_count:=prior_count-complete_duplicates;
    incomplete_window_count:=prior_count-complete_window;
    duplicate_payment_count:=0;split_count:=0;split_total:=t.amount;
    if t.vendor_id is not null and t.currency is not null and ns is not null then
        select count(*) filter(where p.amount=t.amount and p.invoice_number=t.invoice_number),
            count(*) filter(where (case when p_simulated then p.received_at else p.transaction_timestamp end)
                between p_evaluation-interval '24 hours' and p_evaluation),
            coalesce(sum(p.amount) filter(where (case when p_simulated then p.received_at else p.transaction_timestamp end)
                between p_evaluation-interval '24 hours' and p_evaluation),0)+t.amount
            into duplicate_payment_count,split_count,split_total
        from public.feed_transactions p
        where p.source_id=t.source_id and p.organization_id=t.organization_id
          and p.vendor_id=t.vendor_id and p.currency=t.currency
          and p.identity_context->>'vendor_namespace'=ns
          and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id);
    end if;
    select count(*) into raw_prior from public.ingestion_receipts r
        where r.source_id=t.source_id and r.organization_id=t.organization_id
          and (r.received_at,r.id)<(t.received_at,t.receipt_id);
    unprepared_prior_count:=raw_prior-prior_count;
    if unprepared_prior_count<0 then raise exception 'Receipt projection mismatch'; end if;
    return next;
end;
$$;
revoke all on function public.feed_history_counts(uuid,boolean,timestamptz)
    from public,anon,authenticated,service_role;

create or replace function public.claim_feed_audit_before_name_window()
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.feed_audit_jobs; t public.feed_transactions; config jsonb; history jsonb;
    captured timestamptz; simulated boolean; evaluation_time timestamptz;
    config_ref text; wait_seconds integer; scanned integer; unprepared integer; split_count integer; split_total numeric;
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
        select c.configuration,r.configuration_reference into config,config_ref from public.feed_audit_contexts c join public.feed_audit_context_configuration_refs r using(source_id,version) where c.source_id=t.source_id and c.version=t.context_version;
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
        select jsonb_build_object(
            'captured_at',captured,'arrival_cutoff',t.received_at,'arrival_cutoff_receipt',t.receipt_id,
            'prior_count',h.prior_count,'arrival_window_count',h.arrival_window_count,
            'incomplete_duplicate_count',h.incomplete_duplicate_count,
            'incomplete_window_count',h.incomplete_window_count,
            'duplicate_payment_count',h.duplicate_payment_count),
            h.split_count,h.split_total,h.unprepared_prior_count
        into history,split_count,split_total,unprepared
        from public.feed_history_counts(t.id,simulated,evaluation_time) h;
        history:=history||jsonb_build_object('unprepared_prior_count',unprepared,
            'invoice_splitting_context',jsonb_build_object('historical_transaction_count',split_count,
                'window_total_amount',split_total::text));
        j.snapshot:=jsonb_build_object('configuration_reference',config_ref,'history',history,'context_version',t.context_version,
            'time_basis',case when simulated then 'SIMULATED_ARRIVAL_TIME' else 'BUSINESS_EVENT_TIME' end,
            'evaluation_time',evaluation_time);
        if config_ref is null then j.snapshot:=(j.snapshot-'configuration_reference')||jsonb_build_object('configuration',config); end if;
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
analyze public.feed_transactions;
notify pgrst, 'reload schema';
