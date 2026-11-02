-- Durable candidate metadata, not new payment data. No hosted rollout is automatic.
create index feed_audit_jobs_open_queue_idx
    on public.feed_audit_jobs(available_at,transaction_id)
    where status in ('PENDING','AUDITING');

create table public.feed_audit_preparations (
    receipt_id uuid primary key references public.ingestion_validations(receipt_id)
);
alter table public.feed_audit_preparations enable row level security;
revoke all on public.feed_audit_preparations from public,anon,authenticated,service_role;

create function public.enqueue_feed_preparation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
    if new.result->>'intake_status' in ('ACCEPTED','PARTIAL')
        and not exists(select 1 from public.feed_transactions where receipt_id=new.receipt_id) then
        insert into public.feed_audit_preparations(receipt_id) values(new.receipt_id) on conflict do nothing;
    end if;
    return new;
end;
$$;
create trigger enqueue_feed_preparation after insert on public.ingestion_validations
    for each row execute function public.enqueue_feed_preparation();

create function public.complete_feed_preparation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
    delete from public.feed_audit_preparations where receipt_id=new.receipt_id;
    return new;
end;
$$;
create trigger complete_feed_preparation after insert on public.feed_transactions
    for each row execute function public.complete_feed_preparation();
revoke all on function public.enqueue_feed_preparation(),public.complete_feed_preparation()
    from public,anon,authenticated,service_role;

-- Includes temporarily inactive/disabled sources so later activation loses no work.
insert into public.feed_audit_preparations(receipt_id)
    select v.receipt_id from public.ingestion_validations v
    where v.result->>'intake_status' in ('ACCEPTED','PARTIAL')
        and not exists(select 1 from public.feed_transactions t where t.receipt_id=v.receipt_id)
    on conflict do nothing;

create or replace function public.prepare_feed_audits(p_limit integer default 25)
returns integer language plpgsql security definer set search_path='' as $$
declare r record; t_id uuid; prepared integer:=0;
begin
    if not exists(select 1 from public.feed_audit_preparations) then return 0; end if;
    for r in select receipt.*,v.result,s.audit_context_version from public.feed_audit_preparations q
        join public.ingestion_receipts receipt on receipt.id=q.receipt_id
        join public.ingestion_validations v on v.receipt_id=receipt.id
        join public.ingestion_sources s on s.id=receipt.source_id and s.organization_id=receipt.organization_id
        where s.active and s.audit_enabled and v.result->>'intake_status' in ('ACCEPTED','PARTIAL')
        and not exists(select 1 from public.feed_transactions t where t.receipt_id=receipt.id)
        order by receipt.received_at,receipt.id for update of receipt skip locked
        limit greatest(1,least(p_limit,25))
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
-- CREATE OR REPLACE preserves the existing service_role-only function ACL.
