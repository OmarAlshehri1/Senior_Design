-- Requires feed migrations 026-039. Local/staging first; no automatic activation.
create table public.company_import_batches (
    id uuid primary key default gen_random_uuid(),
    source_id text not null references public.ingestion_sources(id),
    actor_id uuid not null references public.user_profiles(id),
    document jsonb not null,
    preview jsonb,
    confirmed_at timestamptz,
    receipts jsonb,
    created_at timestamptz not null default clock_timestamp(),
    expires_at timestamptz not null default clock_timestamp()+interval '24 hours',
    check(jsonb_typeof(document)='object'),
    check(jsonb_array_length(document->'records') between 1 and 50000)
);
create index company_import_batches_source_recent on public.company_import_batches(source_id,created_at desc);
create table public.company_import_profiles (
    source_id text not null references public.ingestion_sources(id),
    name text not null check(length(name) between 1 and 80),
    mapping jsonb not null,
    identity_column text not null,
    saved_by uuid not null references public.user_profiles(id),
    saved_at timestamptz not null default clock_timestamp(),
    primary key(source_id,name)
);
alter table public.company_import_batches enable row level security;
alter table public.company_import_profiles enable row level security;
revoke all on public.company_import_batches,public.company_import_profiles from public,anon,authenticated,service_role;

-- Role alone never grants cross-company import authority. Direct assignment required.
create function public.require_company_import_source(p_actor uuid,p_source text)
returns void language plpgsql security definer set search_path='' as $$
begin
    if not exists(select 1 from public.user_profiles u
        join public.feed_review_users g on g.user_id=u.id
        join public.ingestion_sources s on s.id=g.source_id
        where u.id=p_actor and u.role='ADMIN' and u.account_status='ACTIVE'
          and s.id=p_source and s.active and s.audit_enabled) then
        raise exception 'FORBIDDEN' using errcode='42501';
    end if;
end;
$$;
revoke all on function public.require_company_import_source(uuid,text) from public,anon,authenticated,service_role;

create function public.list_company_import_sources(p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
    select coalesce(jsonb_agg(jsonb_build_object('id',s.id) order by s.id),'[]'::jsonb)
    from public.ingestion_sources s join public.feed_review_users g on g.source_id=s.id
    join public.user_profiles u on u.id=g.user_id
    where u.id=p_actor and u.role='ADMIN' and u.account_status='ACTIVE' and s.active and s.audit_enabled;
$$;

create function public.store_company_import(p_actor uuid,p_source text,p_document jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
    perform public.require_company_import_source(p_actor,p_source);
    if octet_length(p_document::text)>100663296 or jsonb_typeof(p_document->'records') is distinct from 'array'
        or jsonb_array_length(p_document->'records') not between 1 and 50000 then
        raise exception 'INVALID_UPLOAD' using errcode='22023';
    end if;
    insert into public.company_import_batches(source_id,actor_id,document)
    values(p_source,p_actor,p_document) returning id into result;
    return result;
end;
$$;

-- Internal server read; HTTP routes deliberately omit original-record payloads.
create function public.get_company_import(p_actor uuid,p_source text,p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.company_import_batches;
begin
    perform public.require_company_import_source(p_actor,p_source);
    select * into b from public.company_import_batches where id=p_id and source_id=p_source and actor_id=p_actor;
    if not found or (b.confirmed_at is null and b.expires_at<=clock_timestamp()) then
        raise exception 'NOT_FOUND' using errcode='P0002';
    end if;
    return to_jsonb(b);
end;
$$;

create function public.preview_company_import(p_actor uuid,p_source text,p_id uuid,p_preview jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare duplicates integer; conflicts integer; conflict_rows jsonb;
begin
    perform public.require_company_import_source(p_actor,p_source);
    perform 1 from public.company_import_batches where id=p_id and source_id=p_source and actor_id=p_actor
        and confirmed_at is null and expires_at>clock_timestamp() for update;
    if not found then raise exception 'IMPORT_NOT_EDITABLE' using errcode='22023'; end if;
    select count(*) filter(where r.envelope->'original_record'=x.value->'original_record' and m.configuration=p_preview->'mapping'),
        count(*) filter(where r.envelope->'original_record' is distinct from x.value->'original_record' or m.configuration is distinct from p_preview->'mapping'),
        coalesce(jsonb_agg(x.value->'row') filter(where r.envelope->'original_record' is distinct from x.value->'original_record'
            or m.configuration is distinct from p_preview->'mapping'),'[]'::jsonb)
        into duplicates,conflicts,conflict_rows
    from jsonb_array_elements(p_preview->'rows') x
    join public.ingestion_receipts r on r.source_id=p_source and r.record_id=x.value->>'record_id'
    left join public.ingestion_mappings m on m.source_id=r.source_id and m.version=r.mapping_version;
    p_preview:=p_preview||jsonb_build_object('existing_duplicates',duplicates,'conflicts',conflicts,'conflict_rows',conflict_rows);
    update public.company_import_batches set preview=p_preview where id=p_id;
    return p_preview-'rows'-'mapping';
end;
$$;

create function public.confirm_company_import(p_actor uuid,p_source text,p_id uuid,p_revision text,p_profile text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.company_import_batches; s public.ingestion_sources; mapping_version text;
    saved jsonb:='[]'::jsonb; inserted integer:=0; reused integer:=0;
begin
    perform public.require_company_import_source(p_actor,p_source);
    -- Serialize with producer writes, then with other confirmations for this batch.
    select * into s from public.ingestion_sources where id=p_source for update;
    if not s.active or not s.audit_enabled then raise exception 'FORBIDDEN' using errcode='42501'; end if;
    select * into b from public.company_import_batches where id=p_id and source_id=p_source and actor_id=p_actor for update;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    if b.preview is null or b.preview->>'revision' is distinct from p_revision then
        raise exception 'PREVIEW_CHANGED' using errcode='22023';
    end if;
    if b.confirmed_at is not null then return b.receipts; end if;
    if b.expires_at<=clock_timestamp() or (b.preview->'counts'->>'REJECTED')::integer<>0 then
        raise exception 'IMPORT_NOT_READY' using errcode='22023';
    end if;
    if p_profile is not null and (length(trim(p_profile)) not between 1 and 80) then
        raise exception 'INVALID_PROFILE' using errcode='22023';
    end if;
    mapping_version:='upload-'||p_revision;
    insert into public.ingestion_mappings(source_id,version,configuration)
        values(p_source,mapping_version,b.preview->'mapping') on conflict do nothing;
    if not exists(select 1 from public.ingestion_mappings where source_id=p_source and version=mapping_version
        and configuration=b.preview->'mapping') then raise exception 'MAPPING_CONFLICT' using errcode='23505'; end if;
    if exists(select 1 from jsonb_array_elements(b.preview->'rows') x
        join public.ingestion_receipts r on r.source_id=p_source and r.record_id=x.value->>'record_id'
        left join public.ingestion_mappings m on m.source_id=r.source_id and m.version=r.mapping_version
        where r.envelope->'original_record' is distinct from x.value->'original_record'
           or m.configuration is distinct from b.preview->'mapping') then
        raise exception 'IMPORT_CONFLICT' using errcode='23505';
    end if;
    -- Bulk insertion avoids per-row RPC/SQL loops and repeated growing JSON arrays.
    -- Receipts and jobs remain one transaction, protected by the same source lock.
    with envelopes as materialized (
        select (x.value->>'row')::integer as file_row,
            jsonb_build_object('schema_version','1.0','source_id',p_source,
                'event_id','upload:'||encode(sha256(convert_to(x.value->>'record_id','UTF8')),'hex'),
                'record_id',x.value->>'record_id','event_type','transaction.created',
                'original_record',x.value->'original_record') as env
        from jsonb_array_elements(b.preview->'rows') x
    ), new_receipts as (
        insert into public.ingestion_receipts(source_id,organization_id,event_id,record_id,
            schema_version,event_type,mapping_version,fingerprint,original_payload,envelope)
        select p_source,s.organization_id,env->>'event_id',env->>'record_id','1.0','transaction.created',
            mapping_version,encode(sha256(convert_to(env::text,'UTF8')),'hex'),env::text,env
        from envelopes order by file_row
        on conflict(source_id,record_id) do nothing returning id,received_at
    )
    insert into public.ingestion_jobs(receipt_id,created_at,available_at)
        select id,received_at,received_at from new_receipts;
    get diagnostics inserted = row_count;
    select coalesce(jsonb_agg(jsonb_build_object('row',x.value->'row','receipt_id',r.id)
        order by (x.value->>'row')::integer),'[]'::jsonb) into saved
    from jsonb_array_elements(b.preview->'rows') x
    join public.ingestion_receipts r on r.source_id=p_source and r.record_id=x.value->>'record_id';
    reused:=jsonb_array_length(b.preview->'rows')-inserted;
    if p_profile is not null then
        insert into public.company_import_profiles(source_id,name,mapping,identity_column,saved_by)
        values(p_source,trim(p_profile),b.preview->'mapping',b.preview->>'identity_column',p_actor)
        on conflict(source_id,name) do update set mapping=excluded.mapping,identity_column=excluded.identity_column,
            saved_by=excluded.saved_by,saved_at=clock_timestamp();
    end if;
    update public.company_import_batches set confirmed_at=clock_timestamp(),
        receipts=jsonb_build_object('inserted',inserted,'duplicates',reused,'items',saved) where id=p_id;
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
        values(p_actor,(select name from public.user_profiles where id=p_actor),'ADMIN','TRANSACTIONS_IMPORTED','IMPORT',p_id::text,'SUCCESS',
            jsonb_build_object('source_id',p_source,'inserted',inserted,'duplicates',reused));
    return jsonb_build_object('inserted',inserted,'duplicates',reused,'items',saved);
end;
$$;

create function public.company_import_history(p_actor uuid,p_source text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
    perform public.require_company_import_source(p_actor,p_source);
    select jsonb_build_object('profiles',coalesce((select jsonb_agg(jsonb_build_object('name',p.name,
        'mapping',p.mapping,'identity_column',p.identity_column)) from public.company_import_profiles p where source_id=p_source),'[]'::jsonb),
        'items',coalesce((select jsonb_agg(x) from (select id,document->>'filename' as filename,
        created_at,confirmed_at,receipts->'inserted' as inserted,receipts->'duplicates' as duplicates
        from public.company_import_batches where source_id=p_source and actor_id=p_actor
        and (confirmed_at is not null or expires_at>clock_timestamp()) order by created_at desc limit 20) x),'[]'::jsonb)) into result;
    return result;
end;
$$;

create function public.company_import_progress(p_actor uuid,p_source text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b public.company_import_batches; result jsonb;
begin
    perform public.require_company_import_source(p_actor,p_source);
    select * into b from public.company_import_batches where id=p_id and source_id=p_source and actor_id=p_actor;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    select jsonb_build_object('id',b.id,'confirmed',b.confirmed_at is not null,
        'inserted',b.receipts->'inserted','duplicates',b.receipts->'duplicates','total',count(*),
        'completed',count(*) filter(where a.status='COMPLETED'),
        'rejected',count(*) filter(where v.result->>'intake_status' in ('REJECTED','CONFLICT')),
        'blocked',count(*) filter(where j.status='BLOCKED' or a.status='BLOCKED'),
        'pending',count(*) filter(where coalesce(a.status,'')<>'COMPLETED'
            and coalesce(v.result->>'intake_status','') not in ('REJECTED','CONFLICT')
            and j.status<>'BLOCKED' and coalesce(a.status,'')<>'BLOCKED')) into result
    from jsonb_array_elements(coalesce(b.receipts->'items','[]'::jsonb)) x
    join public.ingestion_receipts r on r.id=(x->>'receipt_id')::uuid and r.source_id=p_source
    join public.ingestion_jobs j on j.receipt_id=r.id
    left join public.ingestion_validations v on v.receipt_id=r.id
    left join public.feed_transactions t on t.receipt_id=r.id
    left join public.feed_audit_jobs a on a.transaction_id=t.id;
    return result;
end;
$$;

revoke all on function public.list_company_import_sources(uuid),public.store_company_import(uuid,text,jsonb),
    public.get_company_import(uuid,text,uuid),public.preview_company_import(uuid,text,uuid,jsonb),
    public.confirm_company_import(uuid,text,uuid,text,text),public.company_import_history(uuid,text),
    public.company_import_progress(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.list_company_import_sources(uuid),public.store_company_import(uuid,text,jsonb),
    public.get_company_import(uuid,text,uuid),public.preview_company_import(uuid,text,uuid,jsonb),
    public.confirm_company_import(uuid,text,uuid,text,text),public.company_import_history(uuid,text),
    public.company_import_progress(uuid,text,uuid) to service_role;
