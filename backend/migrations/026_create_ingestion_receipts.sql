-- Phase 1 only: isolated intake. No canonical transactions, scoring or alerts.
-- Apply to an isolated test database first; never auto-apply at application startup.
create table public.ingestion_sources (
    id text primary key check (length(id) between 1 and 128),
    organization_id uuid not null,
    credential_hash text not null unique check (credential_hash ~ '^[0-9a-f]{64}$'),
    active boolean not null default false,
    mapping_version text not null check (length(mapping_version) between 1 and 128),
    tokens numeric not null default 20 check (tokens between 0 and 20),
    rate_updated_at timestamptz not null default clock_timestamp(),
    created_at timestamptz not null default now()
);
create table public.ingestion_receipts (
    id uuid primary key default gen_random_uuid(),
    source_id text not null references public.ingestion_sources(id),
    organization_id uuid not null,
    event_id text not null check (length(event_id) between 1 and 128),
    record_id text not null check (length(record_id) between 1 and 128),
    schema_version text not null check (schema_version = '1.0'),
    event_type text not null check (event_type = 'transaction.created'),
    mapping_version text not null,
    fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
    original_payload text not null,
    envelope jsonb not null check (jsonb_typeof(envelope) = 'object'),
    received_at timestamptz not null default clock_timestamp(),
    unique(source_id,event_id),
    unique(source_id,record_id)
);
create table public.ingestion_jobs (
    receipt_id uuid primary key references public.ingestion_receipts(id),
    status text not null default 'PENDING' check (status = 'PENDING'),
    created_at timestamptz not null default now()
);
-- Jobs intentionally remain pending until the separately implemented validation worker.
alter table public.ingestion_sources enable row level security;
alter table public.ingestion_receipts enable row level security;
alter table public.ingestion_jobs enable row level security;
revoke all on public.ingestion_sources, public.ingestion_receipts, public.ingestion_jobs
    from public, anon, authenticated, service_role;

create function public.ingestion_source(p_credential_hash text)
returns jsonb language sql security definer set search_path = '' as $$
    select jsonb_build_object('source_id',s.id) from public.ingestion_sources s
    where s.credential_hash=p_credential_hash and s.active;
$$;

create function public.ingestion_receipt_view(p_receipt public.ingestion_receipts)
returns jsonb language sql immutable set search_path = '' as $$
    select jsonb_build_object(
        'receipt_id',p_receipt.id,'source_id',p_receipt.source_id,
        'event_id',p_receipt.event_id,'record_id',p_receipt.record_id,
        'schema_version',p_receipt.schema_version,'mapping_version',p_receipt.mapping_version,
        'received_at',p_receipt.received_at,'intake_status','PENDING_VALIDATION',
        'processing_status','PENDING','transaction_id',null,'reasons','[]'::jsonb,'coverage',null);
$$;

create function public.submit_ingestion_event(p_credential_hash text,p_payload_text text,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.ingestion_sources; r public.ingestion_receipts;
    available numeric; checked_at timestamptz;
    p_envelope jsonb;
begin
    -- Serialize same-source requests, including concurrent conflicting first deliveries.
    select * into s from public.ingestion_sources
    where credential_hash=p_credential_hash and active for update;
    if not found then return jsonb_build_object('error','UNAUTHORIZED'); end if;
    checked_at := clock_timestamp();
    if p_payload_text is null or octet_length(p_payload_text) > 262144 then
        return jsonb_build_object('error','INVALID_ENVELOPE'); end if;
    p_envelope := p_payload_text::jsonb;
    if p_envelope->>'source_id' is distinct from s.id then
        return jsonb_build_object('error','SOURCE_MISMATCH'); end if;
    if p_envelope->>'schema_version' is distinct from '1.0'
       or p_envelope->>'event_type' is distinct from 'transaction.created'
       or jsonb_typeof(p_envelope->'original_record') is distinct from 'object'
       or coalesce(length(p_envelope->>'event_id'),0) not between 1 and 128
       or coalesce(length(p_envelope->>'record_id'),0) not between 1 and 128
       or p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then
        return jsonb_build_object('error','INVALID_ENVELOPE'); end if;
    available := least(20, s.tokens + greatest(0,extract(epoch from checked_at-s.rate_updated_at))*10);
    update public.ingestion_sources set tokens=case when available < 1 then available else available-1 end,
        rate_updated_at=checked_at where id=s.id;
    if available < 1 then return jsonb_build_object('error','RATE_LIMITED'); end if;
    select * into r from public.ingestion_receipts
        where source_id=s.id and event_id=p_envelope->>'event_id';
    if found then
        if r.envelope is distinct from p_envelope or r.fingerprint is distinct from p_fingerprint
           or r.organization_id is distinct from s.organization_id then
            return jsonb_build_object('error','EVENT_CONFLICT'); end if;
        return public.ingestion_receipt_view(r) || jsonb_build_object('duplicate',true);
    end if;
    if exists(select 1 from public.ingestion_receipts
        where source_id=s.id and record_id=p_envelope->>'record_id') then
        return jsonb_build_object('error','RECORD_CONFLICT'); end if;
    insert into public.ingestion_receipts(source_id,organization_id,event_id,record_id,
        schema_version,event_type,mapping_version,fingerprint,envelope,original_payload)
    values(s.id,s.organization_id,p_envelope->>'event_id',p_envelope->>'record_id',
        '1.0','transaction.created',s.mapping_version,p_fingerprint,p_envelope,p_payload_text) returning * into r;
    insert into public.ingestion_jobs(receipt_id) values(r.id);
    return public.ingestion_receipt_view(r) || jsonb_build_object('duplicate',false);
end;
$$;

create function public.read_ingestion_receipts(p_credential_hash text,p_receipt_id uuid default null,
    p_event_id text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare s public.ingestion_sources; r public.ingestion_receipts;
begin
    select * into s from public.ingestion_sources where credential_hash=p_credential_hash and active;
    if not found then return jsonb_build_object('error','UNAUTHORIZED'); end if;
    if (p_receipt_id is null) = (p_event_id is null) then
        return jsonb_build_object('error','INVALID_LOOKUP'); end if;
    select * into r from public.ingestion_receipts where source_id=s.id
        and organization_id=s.organization_id
        and ((p_receipt_id is not null and id=p_receipt_id)
          or (p_event_id is not null and event_id=p_event_id));
    if not found then return null; end if;
    return public.ingestion_receipt_view(r);
end;
$$;

revoke all on function public.ingestion_source(text),
    public.ingestion_receipt_view(public.ingestion_receipts),
    public.submit_ingestion_event(text,text,text),public.read_ingestion_receipts(text,uuid,text)
    from public,anon,authenticated,service_role;
grant execute on function public.ingestion_source(text),public.submit_ingestion_event(text,text,text),
    public.read_ingestion_receipts(text,uuid,text) to service_role;
