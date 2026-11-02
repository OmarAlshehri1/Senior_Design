-- Phase 2: isolated mapping/validation staging, never canonical transactions or audit jobs.
create table public.ingestion_mappings (
    source_id text not null references public.ingestion_sources(id),
    version text not null check (length(version) between 1 and 128),
    configuration jsonb not null check (jsonb_typeof(configuration)='object'),
    created_at timestamptz not null default now(),
    primary key(source_id,version)
);
create table public.ingestion_validations (
    receipt_id uuid primary key references public.ingestion_receipts(id),
    result jsonb not null check (
        jsonb_typeof(result)='object'
        and result->>'intake_status' in ('ACCEPTED','PARTIAL','REJECTED')
        and jsonb_typeof(result->'canonical')='object'
        and jsonb_typeof(result->'reasons')='array'
        and result->>'engine_version'='1.0.0'),
    validated_at timestamptz not null default clock_timestamp()
);
alter table public.ingestion_mappings enable row level security;
alter table public.ingestion_validations enable row level security;
revoke all on public.ingestion_mappings,public.ingestion_validations from public,anon,authenticated,service_role;

create function public.protect_ingestion_evidence()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Ingestion configuration and validation evidence are immutable'; end;
$$;
create trigger immutable_ingestion_mapping before update or delete on public.ingestion_mappings
    for each row execute function public.protect_ingestion_evidence();
create trigger immutable_ingestion_validation before update or delete on public.ingestion_validations
    for each row execute function public.protect_ingestion_evidence();
revoke all on function public.protect_ingestion_evidence() from public,anon,authenticated,service_role;

alter table public.ingestion_jobs drop constraint ingestion_jobs_status_check;
alter table public.ingestion_jobs add constraint ingestion_jobs_status_check
    check(status in ('PENDING','VALIDATING','COMPLETED','BLOCKED'));
alter table public.ingestion_jobs add column attempts integer not null default 0 check(attempts>=0);
alter table public.ingestion_jobs add column available_at timestamptz not null default now();
alter table public.ingestion_jobs add column lease_token uuid;
alter table public.ingestion_jobs add column lease_until timestamptz;
alter table public.ingestion_jobs add column last_error text;
create index ingestion_jobs_available_idx on public.ingestion_jobs(status,available_at,lease_until);

create or replace function public.ingestion_receipt_view(p_receipt public.ingestion_receipts)
returns jsonb language sql stable set search_path = '' as $$
    select jsonb_build_object(
        'receipt_id',p_receipt.id,'source_id',p_receipt.source_id,
        'event_id',p_receipt.event_id,'record_id',p_receipt.record_id,
        'schema_version',p_receipt.schema_version,'mapping_version',p_receipt.mapping_version,
        'received_at',p_receipt.received_at,
        'intake_status',coalesce(v.result->>'intake_status','PENDING_VALIDATION'),
        'validation_status',j.status,
        'processing_status',case when j.status='COMPLETED' then 'NOT_SCHEDULED'
                                 when j.status='VALIDATING' then 'VALIDATING' else j.status end,
        'transaction_id',null,'reasons',coalesce(v.result->'reasons',
            case when j.last_error is not null then jsonb_build_array(jsonb_build_object('code',j.last_error))
                 else '[]'::jsonb end),
        'validated_at',v.validated_at,'coverage',null)
    from public.ingestion_jobs j left join public.ingestion_validations v on v.receipt_id=j.receipt_id
    where j.receipt_id=p_receipt.id;
$$;

create function public.claim_ingestion_validation()
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ingestion_jobs; r public.ingestion_receipts; config jsonb;
begin
    select q.* into j from public.ingestion_jobs q
    join public.ingestion_receipts receipt on receipt.id=q.receipt_id
    join public.ingestion_sources s on s.id=receipt.source_id and s.organization_id=receipt.organization_id
    where s.active and ((q.status='PENDING' and q.available_at<=clock_timestamp())
        or (q.status='VALIDATING' and q.lease_until<=clock_timestamp()))
    order by q.available_at,q.created_at,q.receipt_id for update of q skip locked limit 1;
    if not found then return null; end if;
    -- An exhausted lease is an attempt too; crashes cannot cause unbounded reclaim.
    if j.attempts >= 6 then
        update public.ingestion_jobs set status='BLOCKED',last_error='RETRY_EXHAUSTED',
            lease_token=null,lease_until=null where receipt_id=j.receipt_id;
        return jsonb_build_object('blocked',true);
    end if;
    update public.ingestion_jobs set status='VALIDATING',attempts=attempts+1,
        lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '60 seconds',last_error=null
        where receipt_id=j.receipt_id returning * into j;
    select * into r from public.ingestion_receipts where id=j.receipt_id;
    select configuration into config from public.ingestion_mappings
        where source_id=r.source_id and version=r.mapping_version;
    return jsonb_build_object('receipt_id',r.id,'source_id',r.source_id,'mapping_version',r.mapping_version,
        'original_payload',r.original_payload,'configuration',config,'lease_token',j.lease_token);
end;
$$;

create function public.finish_ingestion_validation(p_receipt_id uuid,p_lease_token uuid,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.ingestion_jobs; r public.ingestion_receipts;
begin
    select * into j from public.ingestion_jobs where receipt_id=p_receipt_id for update;
    if not found then return jsonb_build_object('error','JOB_NOT_FOUND'); end if;
    select * into r from public.ingestion_receipts where id=p_receipt_id;
    if not exists(select 1 from public.ingestion_sources where id=r.source_id
        and organization_id=r.organization_id and active) then
        return jsonb_build_object('error','SOURCE_UNAVAILABLE'); end if;
    if j.status='COMPLETED' then return public.ingestion_receipt_view(r); end if;
    if j.status<>'VALIDATING' or j.lease_token is distinct from p_lease_token
        or j.lease_until<=clock_timestamp() then return jsonb_build_object('error','LEASE_LOST'); end if;
    if p_result is null or jsonb_typeof(p_result) is distinct from 'object'
        or coalesce(p_result->>'intake_status','') not in ('ACCEPTED','PARTIAL','REJECTED')
        or p_result->>'engine_version' is distinct from '1.0.0'
        or jsonb_typeof(p_result->'canonical') is distinct from 'object'
        or jsonb_typeof(p_result->'reasons') is distinct from 'array' then
        return jsonb_build_object('error','INVALID_RESULT'); end if;
    insert into public.ingestion_validations(receipt_id,result) values(p_receipt_id,p_result);
    update public.ingestion_jobs set status='COMPLETED',lease_token=null,lease_until=null,last_error=null
        where receipt_id=p_receipt_id;
    return public.ingestion_receipt_view(r);
end;
$$;

create function public.release_ingestion_validation(p_receipt_id uuid,p_lease_token uuid,p_code text)
returns void language plpgsql security definer set search_path='' as $$
begin
    if p_code not in ('MAPPING_NOT_CONFIGURED','MAPPING_INVALID','VALIDATION_UNAVAILABLE','SOURCE_RECORD_INVALID')
        or p_code is null then raise exception 'Unsupported safe validation code'; end if;
    update public.ingestion_jobs set
        status=case when p_code<>'VALIDATION_UNAVAILABLE' or attempts>=6 then 'BLOCKED' else 'PENDING' end,
        last_error=case when p_code='VALIDATION_UNAVAILABLE' and attempts>=6 then 'RETRY_EXHAUSTED' else p_code end,
        available_at=clock_timestamp()+ (array[5,15,60,180,300])[least(greatest(attempts,1),5)] * interval '1 second',
        lease_token=null,lease_until=null
    where receipt_id=p_receipt_id and status='VALIDATING' and lease_token=p_lease_token
        and lease_until>clock_timestamp();
end;
$$;

create function public.resume_ingestion_validation(p_receipt_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
begin
    update public.ingestion_jobs j set status='PENDING',attempts=0,available_at=clock_timestamp(),last_error=null
    from public.ingestion_receipts r,public.ingestion_sources s
    where j.receipt_id=p_receipt_id and j.status='BLOCKED' and r.id=j.receipt_id
        and s.id=r.source_id and s.organization_id=r.organization_id and s.active;
    return found;
end;
$$;

revoke all on function public.claim_ingestion_validation(),public.finish_ingestion_validation(uuid,uuid,jsonb),
    public.release_ingestion_validation(uuid,uuid,text),public.resume_ingestion_validation(uuid)
    from public,anon,authenticated,service_role;
grant execute on function public.claim_ingestion_validation(),public.finish_ingestion_validation(uuid,uuid,jsonb),
    public.release_ingestion_validation(uuid,uuid,text),public.resume_ingestion_validation(uuid) to service_role;
