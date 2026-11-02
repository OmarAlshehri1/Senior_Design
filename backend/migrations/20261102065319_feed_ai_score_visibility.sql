-- Add department presentation and aggregates to existing authorized projections.
-- Existing source/team/period access checks and service-only ACLs are preserved.
create or replace function public.read_review_feed(p_actor uuid,p_source text,p_page integer default 1,
    p_page_size integer default 25,p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb; total bigint;
begin
    if not public.can_review_feed(p_actor,p_source) then
        raise exception 'Feed access denied' using errcode='42501';
    end if;
    if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
        raise exception 'Invalid pagination' using errcode='22023';
    end if;
    select count(*) into total from public.feed_transactions t
        join public.ingestion_sources s on s.id=t.source_id and s.organization_id=t.organization_id
        where t.source_id=p_source and (p_id is null or t.id=p_id);
    select coalesce(jsonb_agg(x.document order by x.received_at desc,x.id desc),'[]'::jsonb) into items from (
        select t.id,t.received_at,jsonb_build_object(
            'id',t.id,'source_id',t.source_id,'record_id',t.record_id,
            'amount',t.amount::text,'currency',t.currency,'vendor_name',t.canonical->>'vendor_name',
            'category',nullif(btrim(t.canonical->>'category'),''),
            'invoice_number',t.invoice_number,'source_date',t.canonical->>'source_date',
            'transaction_timestamp',t.transaction_timestamp,'received_at',t.received_at,
            'time_basis',r.bundle->>'time_basis','processing_status',j.status,
            'evaluated_at',r.evaluated_at,'coverage',r.bundle->'coverage',
            'rule_score',r.bundle->'rule_score','ai_score',r.bundle->'ai_score','risk_score',r.bundle->'risk_score',
            'risk_level',r.bundle->>'risk_level','anomaly_status',r.bundle->'anomaly'->>'status',
            'unscored_reason',r.bundle->'anomaly'->>'reason',
            'rules',case when p_id is null then null else (
                select coalesce(jsonb_agg(jsonb_build_object('rule_key',v->>'rule_key',
                    'status',v->>'status','detail',v->>'detail',
                    'gate_reasons',v->'evidence'->'gate_reasons') order by n),'[]'::jsonb)
                from jsonb_array_elements(r.bundle->'rule_results') with ordinality a(v,n)
            ) end
        ) document
        from public.feed_transactions t
        join public.ingestion_sources s on s.id=t.source_id and s.organization_id=t.organization_id
        left join public.feed_audit_jobs j on j.transaction_id=t.id
        left join public.feed_audit_results r on r.transaction_id=t.id
        where t.source_id=p_source and (p_id is null or t.id=p_id)
        order by t.received_at desc,t.id desc limit p_page_size offset ((p_page::bigint-1)*p_page_size)
    ) x;
    return jsonb_build_object('items',items,'total',total,'page',p_page,'page_size',p_page_size);
end;
$$;

revoke all on function public.read_review_feed(uuid,text,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.read_review_feed(uuid,text,integer,integer,uuid) to service_role;
