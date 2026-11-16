-- Explicit assessment revisions. Original receipts, jobs and results are not rewritten.
create table public.feed_assessment_batches (
    id uuid primary key default gen_random_uuid(),
    source_id text not null references public.ingestion_sources(id),
    context_version text not null,
    actor_id uuid not null references public.user_profiles(id),
    reason text not null check(length(btrim(reason)) between 1 and 500),
    request_key uuid not null,
    request_fingerprint text not null check(request_fingerprint ~ '^[0-9a-f]{64}$'),
    created_at timestamptz not null default clock_timestamp(),
    unique(source_id,actor_id,request_key),
    unique(id,source_id,context_version),
    foreign key(source_id,context_version) references public.feed_audit_contexts(source_id,version)
);
create table public.feed_assessment_requests (
    id uuid primary key default gen_random_uuid(),
    batch_id uuid not null,
    transaction_id uuid not null references public.feed_audit_results(transaction_id),
    source_id text not null,
    context_version text not null,
    revision integer not null check(revision>0),
    created_at timestamptz not null default clock_timestamp(),
    unique(transaction_id,revision),
    unique(batch_id,transaction_id),
    foreign key(batch_id,source_id,context_version)
        references public.feed_assessment_batches(id,source_id,context_version)
);
create table public.feed_assessment_jobs (
    request_id uuid primary key references public.feed_assessment_requests(id),
    status text not null default 'PENDING' check(status in ('PENDING','AUDITING','COMPLETED','BLOCKED')),
    attempts integer not null default 0,
    available_at timestamptz not null default clock_timestamp(),
    lease_token uuid,
    lease_until timestamptz,
    snapshot jsonb,
    last_error text
);
create index feed_assessment_jobs_ready_idx on public.feed_assessment_jobs(available_at,request_id)
    where status in ('PENDING','AUDITING');
create table public.feed_assessment_results (
    request_id uuid primary key references public.feed_assessment_requests(id),
    bundle jsonb not null,
    evaluated_at timestamptz not null default clock_timestamp()
);
alter table public.feed_assessment_batches enable row level security;
alter table public.feed_assessment_requests enable row level security;
alter table public.feed_assessment_jobs enable row level security;
alter table public.feed_assessment_results enable row level security;
revoke all on public.feed_assessment_batches,public.feed_assessment_requests,
    public.feed_assessment_jobs,public.feed_assessment_results from public,anon,authenticated,service_role;
create trigger immutable_feed_assessment_batch before update or delete on public.feed_assessment_batches
    for each row execute function public.protect_ingestion_evidence();
create trigger immutable_feed_assessment_request before update or delete on public.feed_assessment_requests
    for each row execute function public.protect_ingestion_evidence();
create trigger immutable_feed_assessment_result before update or delete on public.feed_assessment_results
    for each row execute function public.protect_ingestion_evidence();

create function public.request_feed_assessments(p_actor uuid,p_source text,p_transactions uuid[],p_reason text,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare source public.ingestion_sources; existing public.feed_assessment_batches;
    fingerprint text; batch uuid; item record; request uuid; next_revision integer; matched integer;
begin
    perform public.require_company_import_source(p_actor,p_source);
    if p_request_key is null or p_transactions is null or cardinality(p_transactions) not between 1 and 100
        or p_reason is null or length(btrim(p_reason)) not between 1 and 500
        or exists(select 1 from unnest(p_transactions) x where x is null)
        or (select count(distinct x) from unnest(p_transactions) x)<>cardinality(p_transactions) then
        raise exception 'Invalid assessment request' using errcode='22023';
    end if;
    -- Serialize requests on this source; row locks on transactions are acquired in ID order.
    select * into source from public.ingestion_sources where id=p_source for update;
    fingerprint:=encode(sha256(convert_to(jsonb_build_object('reason',btrim(p_reason),
        'transactions',(select jsonb_agg(x order by x) from unnest(p_transactions) x))::text,'UTF8')),'hex');
    select * into existing from public.feed_assessment_batches
        where source_id=p_source and actor_id=p_actor and request_key=p_request_key;
    if found then
        if existing.request_fingerprint<>fingerprint then
            raise exception 'Request key reused with different input' using errcode='23505'; end if;
        return jsonb_build_object('id',existing.id,'context_version',existing.context_version,'reused',true,
            'total',(select count(*) from public.feed_assessment_requests where batch_id=existing.id));
    end if;
    if source.audit_context_version is null or not exists(select 1 from public.feed_audit_contexts
        where source_id=p_source and version=source.audit_context_version) then
        raise exception 'Current audit references are unavailable' using errcode='22023'; end if;
    select count(*) into matched from public.feed_transactions t
        join public.feed_audit_results r on r.transaction_id=t.id
        where t.id=any(p_transactions) and t.source_id=p_source and t.organization_id=source.organization_id;
    if matched<>cardinality(p_transactions) then
        raise exception 'Completed transactions outside requested source' using errcode='42501'; end if;
    insert into public.feed_assessment_batches(source_id,context_version,actor_id,reason,request_key,request_fingerprint)
        values(p_source,source.audit_context_version,p_actor,btrim(p_reason),p_request_key,fingerprint) returning id into batch;
    for item in select t.id from public.feed_transactions t where t.id=any(p_transactions) order by t.id for update loop
        select coalesce(max(revision),0)+1 into next_revision from public.feed_assessment_requests where transaction_id=item.id;
        insert into public.feed_assessment_requests(batch_id,transaction_id,source_id,context_version,revision)
            values(batch,item.id,p_source,source.audit_context_version,next_revision) returning id into request;
        insert into public.feed_assessment_jobs(request_id) values(request);
    end loop;
    return jsonb_build_object('id',batch,'context_version',source.audit_context_version,'reused',false,'total',matched);
end;
$$;

create function public.read_feed_assessment_batch(p_actor uuid,p_source text,p_batch uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
    perform public.require_company_import_source(p_actor,p_source);
    select jsonb_build_object('id',b.id,'context_version',b.context_version,'total',count(*),
        'completed',count(*) filter(where j.status='COMPLETED'),
        'pending',count(*) filter(where j.status in ('PENDING','AUDITING')),
        'blocked',count(*) filter(where j.status='BLOCKED')) into result
    from public.feed_assessment_batches b join public.feed_assessment_requests r on r.batch_id=b.id
    join public.feed_assessment_jobs j on j.request_id=r.id
    where b.id=p_batch and b.source_id=p_source and b.actor_id=p_actor
    group by b.id,b.context_version;
    if result is null then raise exception 'Assessment batch not found' using errcode='P0002'; end if;
    return result;
end;
$$;

create function public.read_feed_assessment_history(p_actor uuid,p_source text,p_transaction uuid,
    p_page integer default 1,p_page_size integer default 20)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
    if not public.can_review_feed(p_actor,p_source) or not exists(select 1 from public.feed_transactions
        where id=p_transaction and source_id=p_source) then raise exception 'Denied' using errcode='42501'; end if;
    if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
        raise exception 'Invalid assessment pagination' using errcode='22023'; end if;
    select jsonb_build_object('items',coalesce(jsonb_agg(x.item order by x.revision desc),'[]'::jsonb),
        'total',1+(select count(*) from public.feed_assessment_requests where transaction_id=p_transaction),
        'page',p_page,'page_size',p_page_size) into result from (
        select 0 revision,jsonb_build_object('revision',0,'context_version',t.context_version,'status',j.status,
            'evaluated_at',r.evaluated_at,'coverage',r.bundle->'coverage','rule_score',r.bundle->'rule_score',
            'ai_score',r.bundle->'ai_score','risk_score',r.bundle->'risk_score','time_basis',r.bundle->>'time_basis',
            'reason','Original saved assessment') item
        from public.feed_transactions t left join public.feed_audit_jobs j on j.transaction_id=t.id
        left join public.feed_audit_results r on r.transaction_id=t.id where t.id=p_transaction
        union all
        select q.revision,jsonb_build_object('id',q.id,'revision',q.revision,'context_version',q.context_version,
            'status',j.status,'requested_at',q.created_at,'evaluated_at',r.evaluated_at,'reason',b.reason,
            'coverage',r.bundle->'coverage','rule_score',r.bundle->'rule_score','ai_score',r.bundle->'ai_score',
            'risk_score',r.bundle->'risk_score','time_basis',r.bundle->>'time_basis')
        from public.feed_assessment_requests q join public.feed_assessment_batches b on b.id=q.batch_id
        join public.feed_assessment_jobs j on j.request_id=q.id
        left join public.feed_assessment_results r on r.request_id=q.id where q.transaction_id=p_transaction
        order by revision desc limit p_page_size offset ((p_page::bigint-1)*p_page_size)
    ) x;
    return result;
end;
$$;

create function public.feed_assessment_snapshot(p_request uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare request public.feed_assessment_requests; t public.feed_transactions;
    config jsonb; config_ref text; history jsonb; pinned jsonb; point timestamptz;
    simulated boolean; policies jsonb; authority numeric; n integer; total numeric;
begin
    select * into request from public.feed_assessment_requests where id=p_request;
    if not found then raise exception 'Assessment request missing'; end if;
    select * into t from public.feed_transactions where id=request.transaction_id;
    select c.configuration,r.configuration_reference into config,config_ref
        from public.feed_audit_contexts c left join public.feed_audit_context_configuration_refs r using(source_id,version)
        where c.source_id=request.source_id and c.version=request.context_version;
    if config is null then raise exception 'Assessment context missing'; end if;
    if config ? 'approval_policies' and jsonb_typeof(config->'approval_policies') is distinct from 'array' then
        raise exception 'Assessment approval policies must be an array'; end if;
    simulated:=coalesce(config->>'time_basis','BUSINESS_EVENT_TIME')='SIMULATED_ARRIVAL_TIME';
    point:=case when simulated then t.received_at else t.transaction_timestamp end;
    select (to_jsonb(h)-'split_count'-'split_total')||jsonb_build_object(
        'arrival_cutoff',t.received_at,'arrival_cutoff_receipt',t.receipt_id,
        'invoice_splitting_context',jsonb_build_object('historical_transaction_count',h.split_count,
            'window_total_amount',h.split_total::text)) into history
        from public.feed_history_counts(t.id,simulated,point) h;
    if config->>'invoice_splitting_mode'='SUBTHRESHOLD_PAYMENTS' then
        select jsonb_agg(p) into policies from jsonb_array_elements(config->'approval_policies') p
            where (case when coalesce((config->>'actor_case_insensitive')::boolean,false)
                then lower(p->>'approver_id')=lower(t.canonical->>'approved_by')
                else p->>'approver_id'=t.canonical->>'approved_by' end)
              and p->>'currency'=t.currency and (p->>'valid_from')::timestamptz<=point
              and (p->>'valid_to' is null or point<(p->>'valid_to')::timestamptz);
        if jsonb_array_length(policies)=1 then
            authority:=(policies->0->>'limit')::numeric;
            if authority>0 then
                select count(*),coalesce(sum(p.amount),0) into n,total from public.feed_transactions p
                    where p.source_id=t.source_id and p.organization_id=t.organization_id
                      and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id)
                      and p.vendor_id=t.vendor_id and p.currency=t.currency
                      and p.identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
                      and p.amount>0 and p.amount<authority
                      and (case when simulated then p.received_at else p.transaction_timestamp end)
                        between point-interval '24 hours' and point;
                history:=history||jsonb_build_object('subthreshold_invoice_splitting_context',jsonb_build_object(
                    'historical_transaction_count',n,'window_total_amount',
                    (total+case when t.amount>0 and t.amount<authority then t.amount else 0 end)::text,
                    'approval_limit',authority::text,'calculation_basis','SUBTHRESHOLD_CURRENT_APPROVAL_LIMIT'));
            end if;
        end if;
    end if;
    pinned:=jsonb_build_object('configuration_reference',config_ref,'history',history,
        'context_version',request.context_version,'time_basis',case when simulated then 'SIMULATED_ARRIVAL_TIME' else 'BUSINESS_EVENT_TIME' end,
        'evaluation_time',point);
    if config_ref is null then pinned:=(pinned-'configuration_reference')||jsonb_build_object('configuration',config); end if;
    if config->'simulation_splitting' is not null and config->'simulation_splitting'<>'null'::jsonb then
        pinned:=pinned||jsonb_build_object('simulation_name_window',public.simulated_name_window(t.id,config)); end if;
    if config->'vendor_registry'->>'registry_version' is not null then
        pinned:=pinned||jsonb_build_object('vendor_registry_membership',
            public.feed_registry_membership(t.source_id,config,t.vendor_id)); end if;
    return pinned;
end;
$$;

create function public.claim_feed_assessment() returns jsonb
language plpgsql security definer set search_path='' as $$
declare job public.feed_assessment_jobs; request public.feed_assessment_requests; t public.feed_transactions; hydrated jsonb;
begin
    select j.* into job from public.feed_assessment_jobs j
        join public.feed_assessment_requests r on r.id=j.request_id
        join public.ingestion_sources s on s.id=r.source_id
        where s.active and s.audit_enabled and (
            (j.status='PENDING' and j.available_at<=clock_timestamp())
            or (j.status='AUDITING' and j.lease_until<=clock_timestamp()))
        order by j.available_at,j.request_id for update of j skip locked limit 1;
    if not found then return null; end if;
    if job.attempts>=6 then
        update public.feed_assessment_jobs set status='BLOCKED',last_error='RETRY_EXHAUSTED',lease_token=null,lease_until=null
            where request_id=job.request_id;
        return jsonb_build_object('blocked',true);
    end if;
    select * into request from public.feed_assessment_requests where id=job.request_id;
    select * into t from public.feed_transactions where id=request.transaction_id;
    begin
        update public.feed_assessment_jobs set status='AUDITING',attempts=attempts+1,
            lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',last_error=null,
            snapshot=coalesce(snapshot,public.feed_assessment_snapshot(job.request_id))
            where request_id=job.request_id returning * into job;
        hydrated:=public.hydrate_feed_snapshot(job.snapshot);
    exception when data_exception or raise_exception then
        update public.feed_assessment_jobs set status='BLOCKED',attempts=attempts+1,
            lease_token=null,lease_until=null,last_error='AUDIT_CONTEXT_INVALID' where request_id=job.request_id;
        return jsonb_build_object('blocked',true,'assessment_id',job.request_id);
    end;
    return jsonb_build_object('assessment_id',request.id,'transaction_id',t.id,'lease_token',job.lease_token,
        'source_id',t.source_id,'canonical',t.canonical,'identity_context',t.identity_context,
        'context_version',request.context_version,'snapshot',hydrated);
end;
$$;

-- Keep the legacy claim ABI original-only, even if an application rollback occurs.
-- Revision-aware workers alternate queue preference; neither ready queue can starve.
create function public.claim_feed_work(p_prefer_assessment boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare job jsonb;
begin
    if p_prefer_assessment then
        job:=public.claim_feed_assessment();
        if job is not null then return job; end if;
        return public.claim_feed_audit_for_worker();
    end if;
    job:=public.claim_feed_audit_for_worker();
    if job is not null then return job; end if;
    return public.claim_feed_assessment();
end;
$$;

create function public.validate_feed_assessment_bundle(p_transaction uuid,p_context text,p_snapshot jsonb,p_canonical jsonb,p_bundle jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare n integer; evaluated integer; failed integer; rule_score numeric; risk numeric; ai numeric;
    config jsonb; approval jsonb; payments boolean;
begin
    config:=public.hydrate_feed_commit_snapshot(p_snapshot)->'configuration';
    approval:=config->'model_approval';
    payments:=coalesce(approval->>'model_version'='payments-primary-no-calendar-1.0.0'
        and approval->>'feature_version'='payments-source-no-calendar-1.0.0',false);
    if p_bundle is null or p_bundle->>'transaction_id' is distinct from p_transaction::text
        or p_bundle->>'context_version' is distinct from p_context
        or p_bundle->>'engine_version' is distinct from 'feed-audit-1.1.0'
        or jsonb_typeof(p_bundle->'rule_results') is distinct from 'array'
        or p_bundle->>'time_basis' is distinct from coalesce(config->>'time_basis','BUSINESS_EVENT_TIME')
        or (p_bundle->>'evaluation_time')::timestamptz is distinct from (p_snapshot->>'evaluation_time')::timestamptz then
        raise exception 'Invalid assessment bundle'; end if;
    select count(*),count(*) filter(where r->>'status' in ('PASSED','FAILED')),
        count(*) filter(where r->>'status'='FAILED') into n,evaluated,failed from jsonb_array_elements(p_bundle->'rule_results') r;
    if n<>5 or (select count(distinct r->>'rule_key') from jsonb_array_elements(p_bundle->'rule_results') r
        where r->>'rule_key' in ('segregation_of_duties','approval_limits','duplicate_payment','invoice_splitting','ghost_vendors'))<>5
        or exists(select 1 from jsonb_array_elements(p_bundle->'rule_results') r
            where coalesce(r->>'status','') not in ('PASSED','FAILED','NOT_EVALUATED')) then
        raise exception 'Invalid assessment rules'; end if;
    rule_score:=case when evaluated=0 then null else round(failed::numeric/evaluated*100,2) end;
    if (p_bundle->>'rule_score')::numeric is distinct from rule_score then raise exception 'Assessment rule score mismatch'; end if;
    ai:=(p_bundle->>'ai_score')::numeric;
    if ai is not null then
        if ai<0 or ai>100 or ai='NaN'::numeric or approval is null or approval='null'::jsonb
            or (evaluated<>5 and not payments)
            or (config->>'time_basis'='SIMULATED_ARRIVAL_TIME' and not payments)
            or p_bundle->'anomaly'->>'status' is distinct from 'SCORED'
            or p_bundle->'anomaly'->>'model_version' is distinct from approval->>'model_version'
            or p_bundle->'anomaly'->>'artifact_sha256' is distinct from approval->>'artifact_sha256'
            or not exists(select 1 from jsonb_array_elements_text(approval->'supported_currencies') c where c=p_canonical->>'currency') then
            raise exception 'Assessment model approval mismatch'; end if;
        if payments and (p_canonical->>'currency' is distinct from 'USD'
            or (p_canonical->>'amount')::numeric<=0 or nullif(btrim(p_canonical->>'vendor_name'),'') is null
            or (p_canonical->>'timestamp' is null and coalesce(p_canonical->>'source_date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')
            or p_bundle->'anomaly'->>'feature_time_basis' is distinct from 'SOURCE_FIELDS'
            or p_bundle->'anomaly'->>'feature_version' is distinct from approval->>'feature_version'
            or p_bundle->'anomaly'->>'dataset_key' is distinct from approval->>'dataset_key') then
            raise exception 'Assessment source feature binding mismatch'; end if;
    end if;
    risk:=case when evaluated<>5 or ai is null then null else round(0.60*rule_score+0.40*ai,2) end;
    if (p_bundle->>'risk_score')::numeric is distinct from risk
        or p_bundle->>'risk_level' is distinct from (case when risk is null then null when risk<50 then 'LOW' when risk<75 then 'MEDIUM' else 'HIGH' end) then
        raise exception 'Assessment combined score mismatch'; end if;
    return jsonb_set(p_bundle,'{coverage}',jsonb_build_object('total',5,'evaluated',evaluated,'failed',failed,'not_evaluated',5-evaluated));
end;
$$;

create function public.finish_feed_assessment(p_assessment uuid,p_lease_token uuid,p_bundle jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare job public.feed_assessment_jobs; request public.feed_assessment_requests; canonical jsonb;
begin
    select * into job from public.feed_assessment_jobs where request_id=p_assessment for update;
    if not found then return false; end if;
    select * into request from public.feed_assessment_requests where id=p_assessment;
    perform 1 from public.ingestion_sources where id=request.source_id and active and audit_enabled for share;
    if not found then return false; end if;
    if job.status='COMPLETED' then return true; end if;
    if job.status<>'AUDITING' or job.lease_token is distinct from p_lease_token or job.lease_until<=clock_timestamp() then return false; end if;
    select t.canonical into canonical from public.feed_transactions t where t.id=request.transaction_id;
    p_bundle:=public.validate_feed_assessment_bundle(request.transaction_id,request.context_version,job.snapshot,canonical,p_bundle);
    insert into public.feed_assessment_results(request_id,bundle) values(p_assessment,p_bundle);
    update public.feed_assessment_jobs set status='COMPLETED',lease_token=null,lease_until=null,last_error=null where request_id=p_assessment;
    return true;
end;
$$;

create function public.release_feed_assessment(p_assessment uuid,p_lease_token uuid,p_code text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
    if p_code is null or p_code not in ('AUDIT_CONTEXT_INVALID','AUDIT_CONTEXT_MISSING','MODEL_UNAVAILABLE','AUDIT_UNAVAILABLE') then
        raise exception 'Invalid assessment error'; end if;
    update public.feed_assessment_jobs set status=case when attempts>=6 then 'BLOCKED' else 'PENDING' end,
        lease_token=null,lease_until=null,last_error=p_code,available_at=clock_timestamp()+interval '2 seconds'
        where request_id=p_assessment and status='AUDITING' and lease_token=p_lease_token and lease_until>clock_timestamp();
    return found;
end;
$$;

-- Greatest completed revision wins, even when older requests finish later.
create view public.feed_effective_audit_results with (security_invoker=true) as
    select base.transaction_id,coalesce(latest.bundle,base.bundle) as bundle,
        coalesce(latest.evaluated_at,base.evaluated_at) as evaluated_at,
        coalesce(latest.bundle,base.bundle)->'simulation_indicator'->>'status' as ui_simulation_status,
        coalesce(latest.bundle,base.bundle) @> '{"rule_results":[{"rule_key":"ghost_vendors","status":"FAILED"}]}'::jsonb as ui_ghost_failed,
        coalesce(latest.revision,0) as revision,latest.id as assessment_id
    from public.feed_audit_results base left join lateral (
        select q.id,q.revision,r.bundle,r.evaluated_at from public.feed_assessment_requests q
        join public.feed_assessment_results r on r.request_id=q.id
        where q.transaction_id=base.transaction_id order by q.revision desc limit 1
    ) latest on true;
revoke all on public.feed_effective_audit_results from public,anon,authenticated,service_role;

-- Preserve existing read authorization and signatures; change only the saved-result projection.
do $upgrade$
declare item record; definition text;
begin
    for item in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname in (
            'read_review_feed','can_review_feed_exception','read_feed_exceptions','read_feed_summary_report') loop
        definition:=pg_get_functiondef(item.oid);
        if position('public.feed_audit_results' in definition)=0 then
            raise exception 'Expected result projection missing from %',item.proname; end if;
        execute replace(definition,'public.feed_audit_results','public.feed_effective_audit_results');
    end loop;
end;
$upgrade$;

revoke all on function public.request_feed_assessments(uuid,text,uuid[],text,uuid),
    public.read_feed_assessment_batch(uuid,text,uuid),public.read_feed_assessment_history(uuid,text,uuid,integer,integer),
    public.feed_assessment_snapshot(uuid),public.claim_feed_assessment(),public.claim_feed_work(boolean),
    public.validate_feed_assessment_bundle(uuid,text,jsonb,jsonb,jsonb),
    public.finish_feed_assessment(uuid,uuid,jsonb),public.release_feed_assessment(uuid,uuid,text)
    from public,anon,authenticated,service_role;
grant execute on function public.request_feed_assessments(uuid,text,uuid[],text,uuid),
    public.read_feed_assessment_batch(uuid,text,uuid),public.read_feed_assessment_history(uuid,text,uuid,integer,integer),
    public.claim_feed_work(boolean),public.finish_feed_assessment(uuid,uuid,jsonb),
    public.release_feed_assessment(uuid,uuid,text) to service_role;
