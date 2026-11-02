-- Share immutable configuration bytes. Preserve full worker snapshots and legacy rows.
-- No automatic hosted rollout or rewriting of old snapshots.
create table public.feed_audit_configuration_blobs (
    id text primary key check(id ~ '^[0-9a-f]{64}$'),
    configuration jsonb not null check(jsonb_typeof(configuration)='object'),
    check(id=encode(sha256(convert_to(configuration::text,'UTF8')),'hex'))
);
alter table public.feed_audit_configuration_blobs enable row level security;
revoke all on public.feed_audit_configuration_blobs from public,anon,authenticated,service_role;

create function public.reject_feed_configuration_change()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Pinned feed configuration is immutable'; end;
$$;
create trigger immutable_feed_configuration before update or delete on public.feed_audit_configuration_blobs
    for each row execute function public.reject_feed_configuration_change();

create table public.feed_audit_context_configuration_refs (
    source_id text not null,
    version text not null,
    configuration_reference text not null references public.feed_audit_configuration_blobs(id),
    primary key(source_id,version),
    foreign key(source_id,version) references public.feed_audit_contexts(source_id,version)
);
alter table public.feed_audit_context_configuration_refs enable row level security;
revoke all on public.feed_audit_context_configuration_refs from public,anon,authenticated,service_role;
create trigger immutable_feed_configuration_reference before update or delete on public.feed_audit_context_configuration_refs
    for each row execute function public.reject_feed_configuration_change();
-- Append references without updating existing immutable contexts or snapshots.
insert into public.feed_audit_configuration_blobs(id,configuration)
    select encode(sha256(convert_to(configuration::text,'UTF8')),'hex'),configuration from public.feed_audit_contexts on conflict(id) do nothing;
insert into public.feed_audit_context_configuration_refs(source_id,version,configuration_reference)
    select source_id,version,encode(sha256(convert_to(configuration::text,'UTF8')),'hex') from public.feed_audit_contexts;
create function public.pin_feed_source_configuration()
returns trigger language plpgsql security definer set search_path='' as $$
declare reference text;
begin
    reference:=encode(sha256(convert_to(new.configuration::text,'UTF8')),'hex');
    insert into public.feed_audit_configuration_blobs(id,configuration)
        values(reference,new.configuration) on conflict(id) do nothing;
    if not exists(select 1 from public.feed_audit_configuration_blobs
        where id=reference and configuration=new.configuration) then raise exception 'Pinned configuration digest collision'; end if;
    insert into public.feed_audit_context_configuration_refs(source_id,version,configuration_reference)
        values(new.source_id,new.version,reference);
    return new;
end;
$$;
create trigger pin_feed_source_configuration after insert on public.feed_audit_contexts
    for each row execute function public.pin_feed_source_configuration();
revoke all on function public.pin_feed_source_configuration() from public,anon,authenticated,service_role;

create function public.hydrate_feed_snapshot(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare config jsonb; reference text;
begin
    if p_snapshot is null or not(p_snapshot ? 'configuration_reference') then return p_snapshot; end if;
    reference:=p_snapshot->>'configuration_reference';
    if reference is null or reference !~ '^[0-9a-f]{64}$' then raise exception 'Invalid pinned configuration reference'; end if;
    select configuration into config from public.feed_audit_configuration_blobs where id=reference;
    if not found then raise exception 'Pinned configuration missing'; end if;
    return (p_snapshot-'configuration_reference')||jsonb_build_object('configuration',config);
end;
$$;

create function public.compact_feed_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
declare config jsonb; reference text; existing jsonb;
begin
    if new.snapshot is null then
        if tg_op='UPDATE' and old.snapshot ? 'configuration_reference' then raise exception 'Pinned configuration changed'; end if;
        return new;
    end if;
    -- Preserve snapshots captured before this migration.
    if tg_op='UPDATE' and old.snapshot is not null and not(old.snapshot ? 'configuration_reference') then return new; end if;
    config:=new.snapshot->'configuration';
    if config is null then
        if new.snapshot ? 'configuration_reference' and not exists(select 1 from public.feed_audit_configuration_blobs where id=new.snapshot->>'configuration_reference') then raise exception 'Pinned configuration missing'; end if;
        if tg_op='UPDATE' and old.snapshot ? 'configuration_reference'
            and new.snapshot->>'configuration_reference' is distinct from old.snapshot->>'configuration_reference'
            then raise exception 'Pinned configuration changed'; end if;
        return new;
    end if;
    if config='null'::jsonb then
        if tg_op='UPDATE' and old.snapshot ? 'configuration_reference' then raise exception 'Pinned configuration changed'; end if;
        return new;
    end if;
    reference:=encode(sha256(convert_to(config::text,'UTF8')),'hex');
    if tg_op='UPDATE' and old.snapshot ? 'configuration_reference'
        and reference is distinct from old.snapshot->>'configuration_reference'
        then raise exception 'Pinned configuration changed'; end if;
    insert into public.feed_audit_configuration_blobs(id,configuration) values(reference,config) on conflict(id) do nothing;
    select configuration into existing from public.feed_audit_configuration_blobs where id=reference;
    if existing is distinct from config then raise exception 'Pinned configuration digest collision'; end if;
    new.snapshot:=(new.snapshot-'configuration')||jsonb_build_object('configuration_reference',reference);
    return new;
end;
$$;
create trigger compact_pinned_feed_snapshot before insert or update of snapshot on public.feed_audit_jobs
    for each row execute function public.compact_feed_snapshot();
revoke all on function public.reject_feed_configuration_change(),public.hydrate_feed_snapshot(jsonb),
    public.compact_feed_snapshot() from public,anon,authenticated,service_role;


create function public.feed_snapshot_sql_configuration(p_snapshot jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare config jsonb;
begin
    if not(p_snapshot ? 'configuration_reference') then return p_snapshot->'configuration'; end if;
    select configuration-'vendor_registry' into config from public.feed_audit_configuration_blobs
        where id=p_snapshot->>'configuration_reference';
    if not found then raise exception 'Pinned configuration missing'; end if;
    return config;
end;
$$;
create function public.hydrate_feed_commit_snapshot(p_snapshot jsonb)
returns jsonb language sql security definer set search_path='' as $$
    select case when p_snapshot ? 'configuration_reference'
        then (p_snapshot-'configuration_reference')||jsonb_build_object('configuration',public.feed_snapshot_sql_configuration(p_snapshot))
        else p_snapshot end;
$$;
revoke all on function public.feed_snapshot_sql_configuration(jsonb),public.hydrate_feed_commit_snapshot(jsonb)
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

create or replace function public.claim_feed_audit_before_subthreshold()
returns jsonb language plpgsql security definer set search_path='' as $$
declare job jsonb; pinned_snapshot jsonb; indicator jsonb; config jsonb;
begin
    job:=public.claim_feed_audit_before_name_window();
    if job is null or job->>'blocked'='true' or job->'snapshot' is null or job->'snapshot'='null'::jsonb then return job; end if;
    pinned_snapshot:=job->'snapshot';config:=public.feed_snapshot_sql_configuration(pinned_snapshot);
    if config->'simulation_splitting' is not null
        and config->'simulation_splitting'<>'null'::jsonb then
        if pinned_snapshot->'simulation_name_window' is null then
            indicator:=public.simulated_name_window((job->>'transaction_id')::uuid,config);
            pinned_snapshot:=jsonb_set(pinned_snapshot,'{simulation_name_window}',indicator);
            update public.feed_audit_jobs set snapshot=pinned_snapshot
                where transaction_id=(job->>'transaction_id')::uuid and lease_token=(job->>'lease_token')::uuid;
            job:=jsonb_set(job,'{snapshot}',pinned_snapshot);
        end if;
    end if;
    return job;
end;
$$;

create function public.claim_feed_audit_compact()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; t public.feed_transactions; config jsonb; pinned jsonb;
    point timestamptz; policies jsonb; policy jsonb; authority numeric; n integer; total numeric;
begin
    result:=public.claim_feed_audit_before_subthreshold();
    if result is null or coalesce((result->>'blocked')::boolean,false) then return result; end if;
    pinned:=result->'snapshot';config:=public.feed_snapshot_sql_configuration(pinned);
    if config->>'invoice_splitting_mode' is distinct from 'SUBTHRESHOLD_PAYMENTS'
        or pinned->'history'->'subthreshold_invoice_splitting_context' is not null then return result; end if;
    -- Only enrich a freshly captured snapshot, never a historical pinned retry.
    if (select attempts from public.feed_audit_jobs where transaction_id=(result->>'transaction_id')::uuid)<>1 then return result; end if;
    select * into t from public.feed_transactions where id=(result->>'transaction_id')::uuid;
    point:=(pinned->>'evaluation_time')::timestamptz;
    select jsonb_agg(p) into policies from jsonb_array_elements(coalesce(config->'approval_policies','[]'::jsonb)) p
        where config->>'actor_namespace'=t.identity_context->>'actor_namespace'
        and (case when coalesce((config->>'actor_case_insensitive')::boolean,false)
            then lower(p->>'approver_id')=lower(t.canonical->>'approved_by')
            else p->>'approver_id'=t.canonical->>'approved_by' end)
        and p->>'currency'=t.currency and (p->>'valid_from')::timestamptz<=point
        and (p->>'valid_to' is null or point<(p->>'valid_to')::timestamptz);
    if policies is null or jsonb_array_length(policies)<>1 then return result; end if;
    policy:=policies->0;authority:=(policy->>'limit')::numeric;
    if authority<=0 then return result; end if;
    select count(*)::integer,coalesce(sum(p.amount),0) into n,total from public.feed_transactions p
        where p.source_id=t.source_id and p.organization_id=t.organization_id
        and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id)
        and p.vendor_id=t.vendor_id and p.currency=t.currency
        and p.identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
        and p.amount>0 and p.amount<authority
        and (case when config->>'time_basis'='SIMULATED_ARRIVAL_TIME' then p.received_at else p.transaction_timestamp end)
            between point-interval '24 hours' and point;
    total:=total+case when t.amount>0 and t.amount<authority then t.amount else 0 end;
    pinned:=jsonb_set(pinned,'{history,subthreshold_invoice_splitting_context}',jsonb_build_object(
        'historical_transaction_count',n,'window_total_amount',total::text,'approval_limit',authority::text,
        'calculation_basis','SUBTHRESHOLD_CURRENT_APPROVAL_LIMIT'));
    update public.feed_audit_jobs set snapshot=pinned where transaction_id=t.id
        and lease_token=(result->>'lease_token')::uuid;
    return jsonb_set(result,'{snapshot}',pinned);
end;
$$;

create or replace function public.claim_feed_audit()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
    result:=public.claim_feed_audit_compact();
    if result is null or coalesce((result->>'blocked')::boolean,false) then return result; end if;
    return jsonb_set(result,'{snapshot}',coalesce(public.hydrate_feed_snapshot(result->'snapshot'),'null'::jsonb));
end;
$$;
revoke all on function public.claim_feed_audit_compact() from public,anon,authenticated,service_role;

create or replace function public.finish_feed_audit_before_name_window(p_transaction_id uuid,p_lease_token uuid,p_bundle jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.feed_audit_jobs; t public.feed_transactions; evaluated integer; failed integer; n integer;
    expected_rule numeric; expected_risk numeric; ai numeric; observed integer; history_incomplete boolean;
begin
    select * into j from public.feed_audit_jobs where transaction_id=p_transaction_id for update;
    if not found then return false; end if;
    j.snapshot:=public.hydrate_feed_commit_snapshot(j.snapshot);
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

create or replace function public.finish_feed_audit(p_transaction_id uuid,p_lease_token uuid,p_bundle jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.feed_audit_jobs;
begin
    select * into j from public.feed_audit_jobs where transaction_id=p_transaction_id for update;
    if not found then return false; end if;
    j.snapshot:=public.hydrate_feed_commit_snapshot(j.snapshot);
    if j.snapshot->'configuration'->'simulation_splitting' is not null
        and j.snapshot->'configuration'->'simulation_splitting'<>'null'::jsonb then
        if j.snapshot->'simulation_name_window' is null then raise exception 'Pinned simulation indicator missing'; end if;
        p_bundle:=jsonb_set(p_bundle,'{simulation_indicator}',j.snapshot->'simulation_name_window');
    else
        p_bundle:=p_bundle-'simulation_indicator';
    end if;
    return public.finish_feed_audit_before_name_window(p_transaction_id,p_lease_token,p_bundle);
end;
$$;
