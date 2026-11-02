-- Payments source-only inference; saved results and legacy model gates remain unchanged.
create or replace function public.finish_feed_audit_before_name_window(p_transaction_id uuid,p_lease_token uuid,p_bundle jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.feed_audit_jobs; t public.feed_transactions; evaluated integer; failed integer; n integer;
    expected_rule numeric; expected_risk numeric; ai numeric; observed integer; history_incomplete boolean; approval jsonb; payments_model boolean;
begin
    select * into j from public.feed_audit_jobs where transaction_id=p_transaction_id for update;
    if not found then return false; end if;
    j.snapshot:=public.hydrate_feed_commit_snapshot(j.snapshot);
    approval:=j.snapshot->'configuration'->'model_approval';
    payments_model:=coalesce(approval->>'model_version'='payments-primary-no-calendar-1.0.0'
        and approval->>'feature_version'='payments-source-no-calendar-1.0.0'
        and approval->'supported_currencies'='["USD"]'::jsonb
        and length(approval->>'dataset_key') between 5 and 128
        and approval->>'artifact_sha256' ~ '^[0-9a-f]{64}$'
        and approval->>'model_bucket' ~ '^[a-z0-9][a-z0-9._-]{0,62}$'
        and length(approval->>'model_object') between 1 and 512
        and approval->>'model_object' !~ '(^/|(^|/)\.\.?(/|$)|//|/$)',false);
    select * into t from public.feed_transactions where id=p_transaction_id;
    perform 1 from public.ingestion_sources where id=t.source_id and organization_id=t.organization_id
        and active and audit_enabled for share;
    if not found then return false; end if;
    if j.status='COMPLETED' then return true; end if;
    if j.snapshot->'configuration'->>'time_basis'='SIMULATED_ARRIVAL_TIME' then
        if p_bundle->>'engine_version' is distinct from 'feed-audit-1.1.0'
            or p_bundle->>'time_basis' is distinct from 'SIMULATED_ARRIVAL_TIME'
            or (p_bundle->>'evaluation_time')::timestamptz is distinct from (j.snapshot->>'evaluation_time')::timestamptz
            or (not payments_model and (p_bundle->>'ai_score' is not null or p_bundle->>'risk_score' is not null or p_bundle->>'risk_level' is not null))
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
        or (evaluated<>5 and not payments_model)) then raise exception 'Feed model is not eligible'; end if;
    if ai is not null and (p_bundle->'anomaly'->>'status' is distinct from 'SCORED'
        or p_bundle->'anomaly'->>'model_version' is distinct from j.snapshot->'configuration'->'model_approval'->>'model_version'
        or p_bundle->'anomaly'->>'artifact_sha256' is distinct from j.snapshot->'configuration'->'model_approval'->>'artifact_sha256'
        or not exists(select 1 from jsonb_array_elements_text(j.snapshot->'configuration'->'model_approval'->'supported_currencies') c
            where c.value=t.currency)) then raise exception 'Feed model approval mismatch'; end if;
    if ai is not null and payments_model and (
        t.currency is distinct from 'USD' or t.amount is null or t.amount<=0
        or nullif(btrim(t.canonical->>'vendor_name'),'') is null
        or (t.transaction_timestamp is null and (coalesce(t.canonical->>'source_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
        or p_bundle->'anomaly'->>'feature_time_basis' is distinct from 'SOURCE_FIELDS'
        or p_bundle->'anomaly'->>'feature_version' is distinct from approval->>'feature_version'
        or p_bundle->'anomaly'->>'dataset_key' is distinct from approval->>'dataset_key')
        then raise exception 'Payments source feature binding mismatch'; end if;
    expected_risk:=case when expected_rule is null or ai is null or (payments_model and evaluated<>5)
        then null else round(0.60*expected_rule+0.40*ai,2) end;
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

revoke all on function public.finish_feed_audit_before_name_window(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
