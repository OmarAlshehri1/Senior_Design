-- Select the bounded preparation frontier without rescanning validation documents.
alter table public.feed_audit_preparations add column received_at timestamptz;
update public.feed_audit_preparations q set received_at=r.received_at
    from public.ingestion_receipts r where r.id=q.receipt_id;
alter table public.feed_audit_preparations alter column received_at set not null;
create index feed_audit_preparations_arrival_idx
    on public.feed_audit_preparations(received_at,receipt_id);

create or replace function public.enqueue_feed_preparation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
    if new.result->>'intake_status' in ('ACCEPTED','PARTIAL')
        and not exists(select 1 from public.feed_transactions where receipt_id=new.receipt_id) then
        insert into public.feed_audit_preparations(receipt_id,received_at)
            select new.receipt_id,r.received_at from public.ingestion_receipts r where r.id=new.receipt_id
            on conflict do nothing;
    end if;
    return new;
end;
$$;

create or replace function public.prepare_feed_audits(p_limit integer default 25)
returns integer language plpgsql security definer set search_path='' as $$
declare r record; t_id uuid; prepared integer:=0;
begin
    if not pg_try_advisory_xact_lock(14722,1) then return 0; end if;
    if not exists(select 1 from public.feed_audit_preparations) then return 0; end if;
    for r in with candidates as materialized (
        select q.receipt_id from public.feed_audit_preparations q
        join public.ingestion_receipts receipt on receipt.id=q.receipt_id
        join public.ingestion_sources s on s.id=receipt.source_id and s.organization_id=receipt.organization_id
        where s.active and s.audit_enabled
          and not exists(select 1 from public.feed_transactions t where t.receipt_id=receipt.id)
        order by q.received_at,q.receipt_id for update of q skip locked
        limit greatest(1,least(p_limit,25))
    )
    select receipt.*,v.result,s.audit_context_version from candidates c
        join public.ingestion_receipts receipt on receipt.id=c.receipt_id
        join public.ingestion_validations v on v.receipt_id=receipt.id
        join public.ingestion_sources s on s.id=receipt.source_id and s.organization_id=receipt.organization_id
        order by receipt.received_at,receipt.id
    loop
        if coalesce(r.result->>'intake_status','') not in ('ACCEPTED','PARTIAL') then
            -- A defensive repair of derived queue metadata only; validation evidence is retained.
            delete from public.feed_audit_preparations where receipt_id=r.id;
            continue;
        end if;
        t_id:=null;
        insert into public.feed_transactions(receipt_id,source_id,organization_id,record_id,mapping_version,
            context_version,canonical,identity_context,amount,currency,vendor_id,invoice_number,transaction_timestamp,received_at)
        values(r.id,r.source_id,r.organization_id,r.record_id,r.mapping_version,r.audit_context_version,
            jsonb_set(r.result->'canonical','{approval_limit}','null'::jsonb),r.result->'identity_context',(r.result->'canonical'->>'amount')::numeric,
            r.result->'canonical'->>'currency',r.result->'canonical'->>'vendor_id',r.result->'canonical'->>'invoice_number',
            (r.result->'canonical'->>'timestamp')::timestamptz,r.received_at) on conflict(receipt_id) do nothing returning id into t_id;
        if t_id is not null then
            insert into public.feed_audit_jobs(transaction_id) values(t_id) on conflict(transaction_id) do nothing;
            prepared:=prepared+1;
        end if;
    end loop;
    return prepared;
end;
$$;
analyze public.feed_audit_preparations;
notify pgrst, 'reload schema';
