-- Preserve source/actor authorization, lease semantics and audit calculations.
-- Serialize preparation only, not validation or audit execution.
create or replace function public.prepare_feed_audits(p_limit integer default 25)
returns integer language plpgsql security definer set search_path='' as $$
declare r record; t_id uuid; prepared integer:=0;
begin
    if not pg_try_advisory_xact_lock(14722,1) then return 0; end if;
    if not exists(select 1 from public.feed_audit_preparations) then return 0; end if;
    for r in select receipt.*,v.result,s.audit_context_version from public.feed_audit_preparations q
        join public.ingestion_receipts receipt on receipt.id=q.receipt_id
        join public.ingestion_validations v on v.receipt_id=receipt.id
        join public.ingestion_sources s on s.id=receipt.source_id and s.organization_id=receipt.organization_id
        where s.active and s.audit_enabled and v.result->>'intake_status' in ('ACCEPTED','PARTIAL')
        and not exists(select 1 from public.feed_transactions t where t.receipt_id=receipt.id)
        order by receipt.received_at,receipt.id for update of q skip locked
        limit greatest(1,least(p_limit,25))
    loop
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

create or replace function public.company_import_progress(p_actor uuid,p_source text,p_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
set statement_timeout='50s' as $$
declare b record; receipt_ids uuid[]; result jsonb;
begin
    perform public.require_company_import_source(p_actor,p_source);
    select id,confirmed_at,receipts into b from public.company_import_batches
        where id=p_id and source_id=p_source and actor_id=p_actor;
    if not found then raise exception 'NOT_FOUND' using errcode='P0002'; end if;
    select coalesce(array_agg((x->>'receipt_id')::uuid),'{}'::uuid[]) into receipt_ids
        from jsonb_array_elements(coalesce(b.receipts->'items','[]'::jsonb)) x;
    -- Force a custom plan for the actual batch cardinality. A cached 100-row
    -- JSON-expansion estimate caused 50,000-row batches to use expensive joins.
    -- SQL text is fixed: IDs and source remain bound parameters, never concatenated.
    execute $query$
        select jsonb_build_object('total',count(*),
            'completed',count(*) filter(where a.status='COMPLETED'),
            'rejected',count(*) filter(where v.result->>'intake_status' in ('REJECTED','CONFLICT')),
            'blocked',count(*) filter(where j.status='BLOCKED' or a.status='BLOCKED'),
            'pending',count(*) filter(where coalesce(a.status,'')<>'COMPLETED'
                and coalesce(v.result->>'intake_status','') not in ('REJECTED','CONFLICT')
                and j.status<>'BLOCKED' and coalesce(a.status,'')<>'BLOCKED'))
        from public.ingestion_receipts r
        join public.ingestion_jobs j on j.receipt_id=r.id
        left join public.ingestion_validations v on v.receipt_id=r.id
        left join public.feed_transactions t on t.receipt_id=r.id
        left join public.feed_audit_jobs a on a.transaction_id=t.id
        where r.id=any($1) and r.source_id=$2
    $query$ into result using receipt_ids,p_source;
    return jsonb_build_object('id',b.id,'confirmed',b.confirmed_at is not null,
        'inserted',b.receipts->'inserted','duplicates',b.receipts->'duplicates')||result;
end;
$$;
notify pgrst, 'reload schema';
