-- Complete immutable registries, indexed by source/version/vendor. No hosted activation.
create table public.feed_vendor_registry_versions (
    source_id text not null references public.ingestion_sources(id),
    version text not null check(length(version) between 1 and 128),
    vendor_namespace text not null check(length(vendor_namespace) between 1 and 128),
    reference text not null check(length(reference) between 5 and 200),
    provenance text not null check(provenance in ('SIMULATED','COMPANY_VERIFIED')),
    valid_from timestamptz not null,
    valid_to timestamptz,
    expected_entries integer not null check(expected_entries between 0 and 1000000),
    expected_sha256 text not null check(expected_sha256 ~ '^[0-9a-f]{64}$'),
    sealed_at timestamptz,
    created_at timestamptz not null default clock_timestamp(),
    primary key(source_id,version),
    check(valid_to is null or valid_to>valid_from)
);
create table public.feed_vendor_registry_entries (
    source_id text not null,
    registry_version text not null,
    vendor_id text not null check(length(vendor_id) between 1 and 50
        and position(chr(9) in vendor_id)=0 and position(chr(10) in vendor_id)=0
        and position(chr(13) in vendor_id)=0),
    active boolean not null,
    primary key(source_id,registry_version,vendor_id),
    foreign key(source_id,registry_version)
        references public.feed_vendor_registry_versions(source_id,version)
);
alter table public.feed_vendor_registry_versions enable row level security;
alter table public.feed_vendor_registry_entries enable row level security;
revoke all on public.feed_vendor_registry_versions,public.feed_vendor_registry_entries
    from public,anon,authenticated,service_role;

create function public.protect_feed_registry_version() returns trigger
language plpgsql set search_path='' as $$
declare actual_count bigint; actual_digest text;
begin
    if tg_op='DELETE' then raise exception 'Registry evidence is immutable'; end if;
    if tg_op='INSERT' then
        if new.sealed_at is not null then raise exception 'Load and verify entries before sealing'; end if;
        return new;
    end if;
    if old.sealed_at is not null or new.sealed_at is null
        or (to_jsonb(new)-'sealed_at') is distinct from (to_jsonb(old)-'sealed_at') then
        raise exception 'Registry evidence is immutable';
    end if;
    select count(*),encode(sha256(convert_to(coalesce(string_agg(
        vendor_id||chr(9)||case when active then '1' else '0' end||chr(10),''
        order by vendor_id collate "C"),''),'UTF8')),'hex')
    into actual_count,actual_digest from public.feed_vendor_registry_entries
        where source_id=new.source_id and registry_version=new.version;
    if actual_count<>new.expected_entries or actual_digest<>new.expected_sha256 then
        raise exception 'Complete registry count or digest mismatch';
    end if;
    return new;
end;
$$;
create trigger protect_feed_registry_version before insert or update or delete
    on public.feed_vendor_registry_versions for each row
    execute function public.protect_feed_registry_version();

create function public.protect_feed_registry_entry() returns trigger
language plpgsql set search_path='' as $$
declare sealed timestamptz;
begin
    if tg_op<>'INSERT' then raise exception 'Registry entries are immutable'; end if;
    select sealed_at into sealed from public.feed_vendor_registry_versions
        where source_id=new.source_id and version=new.registry_version for share;
    if not found or sealed is not null then raise exception 'Registry is missing or already sealed'; end if;
    return new;
end;
$$;
create trigger protect_feed_registry_entry before insert or update or delete
    on public.feed_vendor_registry_entries for each row
    execute function public.protect_feed_registry_entry();

-- Owner-only: browser sessions and the application service cannot create authority.
create function public.seal_feed_vendor_registry(p_source text,p_version text)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
    update public.feed_vendor_registry_versions set sealed_at=clock_timestamp()
        where source_id=p_source and version=p_version and sealed_at is null;
    return found;
end;
$$;

create function public.feed_registry_membership(p_source text,p_configuration jsonb,p_vendor text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare config jsonb; registry public.feed_vendor_registry_versions; present boolean; active_vendor boolean;
begin
    config:=p_configuration->'vendor_registry';
    if nullif(config->>'registry_version','') is null then return null; end if;
    select * into registry from public.feed_vendor_registry_versions
        where source_id=p_source and version=config->>'registry_version'
          and sealed_at is not null and vendor_namespace=config->>'vendor_namespace'
          and expected_sha256=config->>'registry_sha256' and reference=config->>'reference'
          and (config->>'valid_from')::timestamptz>=valid_from
          and (valid_to is null or (config->>'valid_to')::timestamptz<=valid_to);
    if not found then return jsonb_build_object('sealed',false); end if;
    select active into active_vendor from public.feed_vendor_registry_entries
        where source_id=p_source and registry_version=registry.version and vendor_id=p_vendor;
    present:=found;
    return jsonb_build_object('source_id',p_source,'registry_version',registry.version,
        'registry_sha256',registry.expected_sha256,'vendor_namespace',registry.vendor_namespace,
        'vendor_id',p_vendor,'sealed',true,'found',present,'active',active_vendor,
        'provenance',registry.provenance);
end;
$$;

-- Registry membership is frozen with the worker's first snapshot, including retries.
alter function public.claim_feed_audit() rename to claim_feed_audit_before_registry;
create function public.claim_feed_audit() returns jsonb
language plpgsql security definer set search_path='' as $$
declare job jsonb; pinned jsonb; hydrated jsonb; membership jsonb;
begin
    job:=public.claim_feed_audit_before_registry();
    if job is null or job->>'blocked'='true' or job->'snapshot' is null
        or job->'snapshot'='null'::jsonb then return job; end if;
    pinned:=job->'snapshot';
    begin
    if not (pinned ? 'vendor_registry_membership') then
        hydrated:=public.hydrate_feed_commit_snapshot(pinned);
        membership:=public.feed_registry_membership(job->>'source_id',
            hydrated->'configuration',job->'canonical'->>'vendor_id');
        if membership is not null then
            pinned:=pinned||jsonb_build_object('vendor_registry_membership',membership);
            update public.feed_audit_jobs set snapshot=pinned
                where transaction_id=(job->>'transaction_id')::uuid
                  and lease_token=(job->>'lease_token')::uuid;
            job:=jsonb_set(job,'{snapshot}',pinned);
        end if;
    end if;
    exception when data_exception or raise_exception then
        update public.feed_audit_jobs set status='BLOCKED',last_error='AUDIT_CONTEXT_INVALID',
            lease_token=null,lease_until=null
            where transaction_id=(job->>'transaction_id')::uuid
              and lease_token=(job->>'lease_token')::uuid;
        return jsonb_build_object('blocked',true);
    end;
    return job;
end;
$$;
revoke all on function public.protect_feed_registry_version(),public.protect_feed_registry_entry(),
    public.seal_feed_vendor_registry(text,text),public.feed_registry_membership(text,jsonb,text),
    public.claim_feed_audit_before_registry(),public.claim_feed_audit()
    from public,anon,authenticated,service_role;
grant execute on function public.claim_feed_audit() to service_role;

-- Old binaries cannot parse registry-version references. Leave those original
-- jobs untouched for a capable worker, rather than exhausting them on rollback.
do $compatibility$
declare definition text; marker text := 'where s.active and s.audit_enabled and (';
begin
    definition:=pg_get_functiondef('public.claim_feed_audit_before_name_window()'::regprocedure);
    if position(marker in definition)=0 then raise exception 'Original claim selector changed'; end if;
    execute replace(definition,marker,$selector$where s.active and s.audit_enabled
        and (coalesce(current_setting('app.feed_registry_worker',true),'')='1'
            or not exists(select 1 from public.feed_audit_contexts compatibility
                where compatibility.source_id=x.source_id and compatibility.version=x.context_version
                  and compatibility.configuration->'vendor_registry'->>'registry_version' is not null))
        and ($selector$);
end;
$compatibility$;

create function public.claim_feed_audit_for_worker() returns jsonb
language plpgsql security definer set search_path='' as $$
declare previous text; job jsonb;
begin
    previous:=coalesce(current_setting('app.feed_registry_worker',true),'');
    perform set_config('app.feed_registry_worker','1',true);
    job:=public.claim_feed_audit();
    perform set_config('app.feed_registry_worker',previous,true);
    return job;
end;
$$;
revoke all on function public.claim_feed_audit_for_worker() from public,anon,authenticated,service_role;
