-- Isolated feed canonicalization/auditing. No writes to legacy transactions or reports.
alter table public.ingestion_sources add column audit_enabled boolean not null default false;
alter table public.ingestion_sources add column audit_context_version text;
create table public.feed_audit_contexts (
    source_id text not null references public.ingestion_sources(id),
    version text not null check(length(version) between 1 and 128),
    configuration jsonb not null check(jsonb_typeof(configuration)='object'),
    created_at timestamptz not null default now(),
    primary key(source_id,version)
);
create table public.feed_transactions (
    id uuid primary key default gen_random_uuid(),
    receipt_id uuid not null unique references public.ingestion_validations(receipt_id),
    source_id text not null references public.ingestion_sources(id),
    organization_id uuid not null,
    record_id text not null,
    mapping_version text not null,
    context_version text,
    canonical jsonb not null,
    identity_context jsonb not null,
    amount numeric,
    currency text,
    vendor_id text,
    invoice_number text,
    transaction_timestamp timestamptz,
    received_at timestamptz not null,
    created_at timestamptz not null default clock_timestamp(),
    unique(source_id,record_id)
);
create index feed_history_idx on public.feed_transactions(organization_id,source_id,received_at,id);
create table public.feed_audit_jobs (
    transaction_id uuid primary key references public.feed_transactions(id),
    status text not null default 'PENDING' check(status in ('PENDING','AUDITING','COMPLETED','BLOCKED')),
    attempts integer not null default 0,
    available_at timestamptz not null default now(),
    lease_token uuid,
    lease_until timestamptz,
    snapshot jsonb,
    last_error text
);
create table public.feed_audit_results (
    transaction_id uuid primary key references public.feed_transactions(id),
    bundle jsonb not null,
    evaluated_at timestamptz not null default clock_timestamp()
);
create table public.feed_audit_alerts (
    id uuid primary key default gen_random_uuid(),
    transaction_id uuid not null unique references public.feed_audit_results(transaction_id),
    risk_score numeric not null check(risk_score between 75 and 100),
    created_at timestamptz not null default clock_timestamp()
);
alter table public.feed_audit_contexts enable row level security;
alter table public.feed_transactions enable row level security;
alter table public.feed_audit_jobs enable row level security;
alter table public.feed_audit_results enable row level security;
alter table public.feed_audit_alerts enable row level security;
revoke all on public.feed_audit_contexts,public.feed_transactions,public.feed_audit_jobs,
    public.feed_audit_results,public.feed_audit_alerts from public,anon,authenticated,service_role;
create trigger immutable_feed_context before update or delete on public.feed_audit_contexts
    for each row execute function public.protect_ingestion_evidence();
create trigger immutable_feed_transaction before update or delete on public.feed_transactions
    for each row execute function public.protect_ingestion_evidence();
create trigger immutable_feed_result before update or delete on public.feed_audit_results
    for each row execute function public.protect_ingestion_evidence();

create function public.prepare_feed_audits(p_limit integer default 25)
returns integer language plpgsql security definer set search_path='' as $$
declare r record; t_id uuid; prepared integer:=0;
begin
    for r in select receipt.*,v.result,s.audit_context_version from public.ingestion_receipts receipt
        join public.ingestion_validations v on v.receipt_id=receipt.id
        join public.ingestion_sources s on s.id=receipt.source_id and s.organization_id=receipt.organization_id
        where s.active and s.audit_enabled and v.result->>'intake_status' in ('ACCEPTED','PARTIAL')
        and not exists(select 1 from public.feed_transactions t where t.receipt_id=receipt.id)
        order by receipt.received_at,receipt.id for update of receipt skip locked limit greatest(1,least(p_limit,25))
    loop
        insert into public.feed_transactions(receipt_id,source_id,organization_id,record_id,mapping_version,
            context_version,canonical,identity_context,amount,currency,vendor_id,invoice_number,transaction_timestamp,received_at)
        values(r.id,r.source_id,r.organization_id,r.record_id,r.mapping_version,r.audit_context_version,
            jsonb_set(r.result->'canonical','{approval_limit}','null'::jsonb),r.result->'identity_context',(r.result->'canonical'->>'amount')::numeric,
            r.result->'canonical'->>'currency',r.result->'canonical'->>'vendor_id',r.result->'canonical'->>'invoice_number',
            (r.result->'canonical'->>'timestamp')::timestamptz,r.received_at) returning id into t_id;
        insert into public.feed_audit_jobs(transaction_id) values(t_id);
        prepared:=prepared+1;
    end loop;
    return prepared;
end;
$$;

create function public.claim_feed_audit()
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.feed_audit_jobs; t public.feed_transactions; config jsonb; history jsonb; captured timestamptz;
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
        -- Arrival-prefix scope is explicit and stable; no cross-source or cross-currency joins.
        with prior as (
            select p.* from public.feed_transactions p where p.source_id=t.source_id and p.organization_id=t.organization_id
                and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id)
        ) select jsonb_build_object(
            'captured_at',captured,'arrival_cutoff',t.received_at,'arrival_cutoff_receipt',t.receipt_id,
            'prior_count',(select count(*) from prior),
            'unprepared_prior_count',(select count(*) from public.ingestion_receipts r
                where r.source_id=t.source_id and r.organization_id=t.organization_id
                and (r.received_at,r.id)<(t.received_at,t.receipt_id)
                and not exists(select 1 from public.feed_transactions p where p.receipt_id=r.id)),
            'incomplete_duplicate_count',(select count(*) from prior where amount is null or currency is null
                or vendor_id is null or invoice_number is null
                or identity_context->>'vendor_namespace' is distinct from t.identity_context->>'vendor_namespace'),
            'incomplete_window_count',(select count(*) from prior where amount is null or currency is null
                or vendor_id is null or transaction_timestamp is null
                or identity_context->>'vendor_namespace' is distinct from t.identity_context->>'vendor_namespace'),
            'duplicate_payment_count',(select count(*) from prior where amount=t.amount and currency=t.currency
                and vendor_id=t.vendor_id and invoice_number=t.invoice_number
                and identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'),
            'invoice_splitting_context',jsonb_build_object(
                'historical_transaction_count',(select count(*) from prior where vendor_id=t.vendor_id and currency=t.currency
                    and identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
                    and transaction_timestamp between t.transaction_timestamp-interval '24 hours' and t.transaction_timestamp),
                'window_total_amount',((select coalesce(sum(amount),0) from prior where vendor_id=t.vendor_id and currency=t.currency
                    and identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
                    and transaction_timestamp between t.transaction_timestamp-interval '24 hours' and t.transaction_timestamp)+t.amount)::text)
        ) into history;
        j.snapshot:=jsonb_build_object('configuration',config,'history',history,'context_version',t.context_version);
    end if;
    update public.feed_audit_jobs set status='AUDITING',attempts=attempts+1,lease_token=gen_random_uuid(),
        lease_until=clock_timestamp()+interval '60 seconds',snapshot=j.snapshot,last_error=null
        where transaction_id=j.transaction_id returning * into j;
    return jsonb_build_object('transaction_id',t.id,'lease_token',j.lease_token,'source_id',t.source_id,
        'canonical',t.canonical,'identity_context',t.identity_context,'context_version',t.context_version,'snapshot',j.snapshot);
end;
$$;

create function public.finish_feed_audit(p_transaction_id uuid,p_lease_token uuid,p_bundle jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.feed_audit_jobs; t public.feed_transactions; evaluated integer; failed integer; n integer;
    expected_rule numeric; expected_risk numeric; ai numeric;
begin
    select * into j from public.feed_audit_jobs where transaction_id=p_transaction_id for update;
    if not found then return false; end if;
    select * into t from public.feed_transactions where id=p_transaction_id;
    perform 1 from public.ingestion_sources where id=t.source_id and organization_id=t.organization_id
        and active and audit_enabled for share;
    if not found then return false; end if;
    if j.status='COMPLETED' then return true; end if;
    if j.status<>'AUDITING' or j.lease_token is distinct from p_lease_token or j.lease_until<=clock_timestamp() then return false; end if;
    if p_bundle->>'transaction_id' is distinct from p_transaction_id::text
        or p_bundle->>'engine_version' is distinct from 'feed-audit-1.0.0'
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

create function public.release_feed_audit(p_transaction_id uuid,p_lease_token uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
    if p_code is null or p_code not in ('AUDIT_CONTEXT_MISSING','AUDIT_CONTEXT_INVALID','AUDIT_UNAVAILABLE','MODEL_UNAVAILABLE')
        then raise exception 'Unsupported feed audit code'; end if;
    update public.feed_audit_jobs set status=case when p_code<>'AUDIT_UNAVAILABLE' or attempts>=6 then 'BLOCKED' else 'PENDING' end,
        last_error=case when p_code='AUDIT_UNAVAILABLE' and attempts>=6 then 'RETRY_EXHAUSTED' else p_code end,
        available_at=clock_timestamp()+(array[5,15,60,180,300])[least(greatest(attempts,1),5)]*interval '1 second',
        lease_token=null,lease_until=null where transaction_id=p_transaction_id and status='AUDITING'
        and lease_token=p_lease_token and lease_until>clock_timestamp();
end;
$$;

create function public.resume_feed_audit(p_transaction_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
    update public.feed_audit_jobs j set status='PENDING',attempts=0,last_error=null,available_at=clock_timestamp()
        from public.feed_transactions t,public.ingestion_sources s where j.transaction_id=p_transaction_id
        and j.status='BLOCKED' and t.id=j.transaction_id and s.id=t.source_id and s.organization_id=t.organization_id
        and s.active and s.audit_enabled;
    return found;
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
        'risk_level',b.bundle->>'risk_level','unscored_reason',b.bundle->'anomaly'->>'reason')
    from public.ingestion_jobs j left join public.ingestion_validations v on v.receipt_id=j.receipt_id
    left join public.feed_transactions t on t.receipt_id=j.receipt_id
    left join public.feed_audit_jobs a on a.transaction_id=t.id
    left join public.feed_audit_results b on b.transaction_id=t.id where j.receipt_id=p_receipt.id;
$$;

revoke all on function public.prepare_feed_audits(integer),public.claim_feed_audit(),public.finish_feed_audit(uuid,uuid,jsonb),
    public.release_feed_audit(uuid,uuid,text),public.resume_feed_audit(uuid) from public,anon,authenticated,service_role;
grant execute on function public.prepare_feed_audits(integer),public.claim_feed_audit(),public.finish_feed_audit(uuid,uuid,jsonb),
    public.release_feed_audit(uuid,uuid,text),public.resume_feed_audit(uuid) to service_role;
