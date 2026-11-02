-- Explicit operator-selected arrival clock for historical simulation only.
-- Default BUSINESS_EVENT_TIME is unchanged; original canonical date/time is never overwritten.
-- No hosted application/deployment is performed by this migration file.
create or replace function public.claim_feed_audit()
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.feed_audit_jobs; t public.feed_transactions; config jsonb; history jsonb; captured timestamptz; simulated boolean; evaluation_time timestamptz;
begin
    select q.* into j from public.feed_audit_jobs q join public.feed_transactions x on x.id=q.transaction_id
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
    if j.snapshot is null and (t.context_version is null or config is not null) then
        captured:=clock_timestamp();
        simulated:=coalesce(config->>'time_basis','BUSINESS_EVENT_TIME')='SIMULATED_ARRIVAL_TIME';
        evaluation_time:=case when simulated then t.received_at else t.transaction_timestamp end;
        -- Arrival-prefix scope is explicit and stable; no cross-source or cross-currency joins.
        with prior as (
            select p.* from public.feed_transactions p where p.source_id=t.source_id and p.organization_id=t.organization_id
                and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id)
        ) select jsonb_build_object(
            'captured_at',captured,'arrival_cutoff',t.received_at,'arrival_cutoff_receipt',t.receipt_id,
            'prior_count',(select count(*) from prior),
            'arrival_window_count',(select count(*) from prior where currency=t.currency
                and received_at between t.received_at-interval '24 hours' and t.received_at),
            'unprepared_prior_count',(select count(*) from public.ingestion_receipts r
                where r.source_id=t.source_id and r.organization_id=t.organization_id
                and (r.received_at,r.id)<(t.received_at,t.receipt_id)
                and not exists(select 1 from public.feed_transactions p where p.receipt_id=r.id)),
            'incomplete_duplicate_count',(select count(*) from prior where amount is null or currency is null
                or vendor_id is null or invoice_number is null
                or identity_context->>'vendor_namespace' is distinct from t.identity_context->>'vendor_namespace'),
            'incomplete_window_count',(select count(*) from prior where amount is null or currency is null
                or vendor_id is null or (not simulated and transaction_timestamp is null)
                or identity_context->>'vendor_namespace' is distinct from t.identity_context->>'vendor_namespace'),
            'duplicate_payment_count',(select count(*) from prior where amount=t.amount and currency=t.currency
                and vendor_id=t.vendor_id and invoice_number=t.invoice_number
                and identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'),
            'invoice_splitting_context',jsonb_build_object(
                'historical_transaction_count',(select count(*) from prior where vendor_id=t.vendor_id and currency=t.currency
                    and identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
                    and (case when simulated then received_at else transaction_timestamp end)
                        between evaluation_time-interval '24 hours' and evaluation_time),
                'window_total_amount',((select coalesce(sum(amount),0) from prior where vendor_id=t.vendor_id and currency=t.currency
                    and identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
                    and (case when simulated then received_at else transaction_timestamp end)
                        between evaluation_time-interval '24 hours' and evaluation_time)+t.amount)::text)
        ) into history;
        j.snapshot:=jsonb_build_object('configuration',config,'history',history,'context_version',t.context_version,
            'time_basis',case when simulated then 'SIMULATED_ARRIVAL_TIME' else 'BUSINESS_EVENT_TIME' end,
            'evaluation_time',evaluation_time);
    end if;
    update public.feed_audit_jobs set status='AUDITING',attempts=attempts+1,lease_token=gen_random_uuid(),
        lease_until=clock_timestamp()+interval '60 seconds',snapshot=j.snapshot,last_error=null
        where transaction_id=j.transaction_id returning * into j;
    return jsonb_build_object('transaction_id',t.id,'lease_token',j.lease_token,'source_id',t.source_id,
        'canonical',t.canonical,'identity_context',t.identity_context,'context_version',t.context_version,'snapshot',j.snapshot);
end;
$$;

create or replace function public.finish_feed_audit(p_transaction_id uuid,p_lease_token uuid,p_bundle jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.feed_audit_jobs; t public.feed_transactions; evaluated integer; failed integer; n integer;
    expected_rule numeric; expected_risk numeric; ai numeric; observed integer; history_incomplete boolean;
begin
    select * into j from public.feed_audit_jobs where transaction_id=p_transaction_id for update;
    if not found then return false; end if;
    select * into t from public.feed_transactions where id=p_transaction_id;
    perform 1 from public.ingestion_sources where id=t.source_id and organization_id=t.organization_id
        and active and audit_enabled for share;
    if not found then return false; end if;
    if j.status='COMPLETED' then return true; end if;
    if j.snapshot->'configuration'->>'time_basis'='SIMULATED_ARRIVAL_TIME' then
        if p_bundle->>'engine_version' is distinct from 'feed-audit-1.1.0'
            or p_bundle->>'time_basis' is distinct from 'SIMULATED_ARRIVAL_TIME'
            or (p_bundle->>'evaluation_time')::timestamptz is distinct from (j.snapshot->>'evaluation_time')::timestamptz
            or p_bundle->>'ai_score' is not null or p_bundle->>'risk_score' is not null or p_bundle->>'risk_level' is not null
            then raise exception 'Simulation clock evidence or scoring mismatch'; end if;
        -- Persist server-derived time label even if a worker omits per-rule evidence.
        p_bundle:=jsonb_set(p_bundle,'{time_basis}','"SIMULATED_ARRIVAL_TIME"'::jsonb);
        observed:=case when t.currency is null then null else (j.snapshot->'history'->>'arrival_window_count')::integer+1 end;
        history_incomplete:=coalesce((j.snapshot->'history'->>'unprepared_prior_count')::integer,0)>0;
        p_bundle:=jsonb_set(p_bundle,'{temporal_observation}',jsonb_build_object(
            'time_basis','SIMULATED_ARRIVAL_TIME','scope','SOURCE_ORGANIZATION_AND_CURRENCY',
            'currency',t.currency,'window_hours',24,'window_end',(j.snapshot->>'evaluation_time')::timestamptz,
            'window_start',(j.snapshot->>'evaluation_time')::timestamptz-interval '24 hours','includes_current',true,
            'observed_transactions',observed,'history_complete',not history_incomplete,
            'two_or_more_observed',case when observed>=2 then true when history_incomplete or observed is null then null else false end,
            'meaning','Arrival of distinct retained records in simulation; not historical payment timing or same-vendor fraud evidence'));
    end if;
    if j.status<>'AUDITING' or j.lease_token is distinct from p_lease_token or j.lease_until<=clock_timestamp() then return false; end if;
    if p_bundle->>'transaction_id' is distinct from p_transaction_id::text
        or coalesce(p_bundle->>'engine_version','') not in ('feed-audit-1.0.0','feed-audit-1.1.0')
        or jsonb_typeof(p_bundle->'rule_results') is distinct from 'array' then raise exception 'Invalid feed audit bundle'; end if;
    select count(*),count(*) filter(where value->>'status' in ('PASSED','FAILED')),
        count(*) filter(where value->>'status'='FAILED') into n,evaluated,failed from jsonb_array_elements(p_bundle->'rule_results');
    if n<>5 or (select count(distinct value->>'rule_key') from jsonb_array_elements(p_bundle->'rule_results')
        where value->>'rule_key' in ('segregation_of_duties','approval_limits','duplicate_payment','invoice_splitting','ghost_vendors'))<>5
        or exists(select 1 from jsonb_array_elements(p_bundle->'rule_results') where coalesce(value->>'status','') not in ('PASSED','FAILED','NOT_EVALUATED'))
        then raise exception 'Invalid feed rule results'; end if;
    expected_rule:=case when evaluated=0 then null else round(failed::numeric/evaluated*100,2) end;
    if (p_bundle->>'rule_score')::numeric is distinct from expected_rule then raise exception 'Feed rule score mismatch'; end if;
    ai:=(p_bundle->>'ai_score')::numeric;
    if ai is not null and (ai<0 or ai>100 or ai='NaN'::numeric
        or j.snapshot->'configuration'->'model_approval' is null
        or j.snapshot->'configuration'->'model_approval'='null'::jsonb
        or evaluated<>5) then raise exception 'Feed model is not eligible'; end if;
    if ai is not null and (p_bundle->'anomaly'->>'status' is distinct from 'SCORED'
        or p_bundle->'anomaly'->>'model_version' is distinct from j.snapshot->'configuration'->'model_approval'->>'model_version'
        or p_bundle->'anomaly'->>'artifact_sha256' is distinct from j.snapshot->'configuration'->'model_approval'->>'artifact_sha256'
        or not exists(select 1 from jsonb_array_elements_text(j.snapshot->'configuration'->'model_approval'->'supported_currencies') c
            where c.value=t.currency)) then raise exception 'Feed model approval mismatch'; end if;
    expected_risk:=case when expected_rule is null or ai is null then null else round(0.60*expected_rule+0.40*ai,2) end;
    if (p_bundle->>'risk_score')::numeric is distinct from expected_risk
        or p_bundle->>'risk_level' is distinct from (case when expected_risk is null then null
            when expected_risk<50 then 'LOW' when expected_risk<75 then 'MEDIUM' else 'HIGH' end)
        then raise exception 'Feed risk policy mismatch'; end if;
    p_bundle:=jsonb_set(p_bundle,'{coverage}',jsonb_build_object('total',5,'evaluated',evaluated,'failed',failed,'not_evaluated',5-evaluated));
    insert into public.feed_audit_results(transaction_id,bundle) values(p_transaction_id,p_bundle);
    if p_bundle->>'risk_level'='HIGH' then
        insert into public.feed_audit_alerts(transaction_id,risk_score) values(p_transaction_id,expected_risk);
    end if;
    update public.feed_audit_jobs set status='COMPLETED',last_error=null,lease_token=null,lease_until=null
        where transaction_id=p_transaction_id;
    return true;
end;
$$;

create or replace function public.ingestion_receipt_view(p_receipt public.ingestion_receipts)
returns jsonb language sql stable set search_path='' as $$
    select jsonb_build_object('receipt_id',p_receipt.id,'source_id',p_receipt.source_id,'event_id',p_receipt.event_id,
        'record_id',p_receipt.record_id,'schema_version',p_receipt.schema_version,'mapping_version',p_receipt.mapping_version,
        'received_at',p_receipt.received_at,'intake_status',coalesce(v.result->>'intake_status','PENDING_VALIDATION'),
        'validation_status',j.status,'processing_status',coalesce(a.status,case when j.status='COMPLETED' then 'NOT_SCHEDULED'
            when j.status='VALIDATING' then 'VALIDATING' else j.status end),
        'transaction_id',t.id,'reasons',coalesce(v.result->'reasons',case when j.last_error is not null
            then jsonb_build_array(jsonb_build_object('code',j.last_error)) else '[]'::jsonb end),
        'validated_at',v.validated_at,'coverage',b.bundle->'coverage','audit_error',a.last_error,
        'rule_score',b.bundle->'rule_score','ai_score',b.bundle->'ai_score','risk_score',b.bundle->'risk_score',
        'risk_level',b.bundle->>'risk_level','unscored_reason',b.bundle->'anomaly'->>'reason',
        'audit_time_basis',b.bundle->>'time_basis','temporal_observation',b.bundle->'temporal_observation')
    from public.ingestion_jobs j left join public.ingestion_validations v on v.receipt_id=j.receipt_id
    left join public.feed_transactions t on t.receipt_id=j.receipt_id
    left join public.feed_audit_jobs a on a.transaction_id=t.id
    left join public.feed_audit_results b on b.transaction_id=t.id where j.receipt_id=p_receipt.id;
$$;
