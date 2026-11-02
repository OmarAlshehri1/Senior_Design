-- Per-source intake cap. Existing sources retain 10/sec and burst capacity 20.
-- No automatic hosted migration or production rate increase.
alter table public.ingestion_sources add column requests_per_second integer not null default 10
    check (requests_per_second between 1 and 100);

create or replace function public.submit_ingestion_event(p_credential_hash text,p_payload_text text,p_fingerprint text)
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
    available := least(20, s.tokens + greatest(0,extract(epoch from checked_at-s.rate_updated_at))*s.requests_per_second);
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
