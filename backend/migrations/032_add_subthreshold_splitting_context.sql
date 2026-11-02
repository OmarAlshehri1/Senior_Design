-- Opt-in v1.1 feed rule. No automatic deployment or rewriting of saved snapshots.
alter function public.claim_feed_audit() rename to claim_feed_audit_before_subthreshold;
create function public.claim_feed_audit()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; t public.feed_transactions; config jsonb; pinned jsonb;
    point timestamptz; policies jsonb; policy jsonb; authority numeric; n integer; total numeric;
begin
    result:=public.claim_feed_audit_before_subthreshold();
    if result is null or coalesce((result->>'blocked')::boolean,false) then return result; end if;
    pinned:=result->'snapshot';config:=pinned->'configuration';
    if config->>'invoice_splitting_mode' is distinct from 'SUBTHRESHOLD_PAYMENTS'
        or pinned->'history'->'subthreshold_invoice_splitting_context' is not null then return result; end if;
    -- Only enrich a freshly captured snapshot, never a historical pinned retry.
    if (select attempts from public.feed_audit_jobs where transaction_id=(result->>'transaction_id')::uuid)<>1 then return result; end if;
    select * into t from public.feed_transactions where id=(result->>'transaction_id')::uuid;
    point:=(pinned->>'evaluation_time')::timestamptz;
    select jsonb_agg(p) into policies from jsonb_array_elements(coalesce(config->'approval_policies','[]'::jsonb)) p
        where config->>'actor_namespace'=t.identity_context->>'actor_namespace'
        and (case when coalesce((config->>'actor_case_insensitive')::boolean,false)
            then lower(p->>'approver_id')=lower(t.canonical->>'approved_by')
            else p->>'approver_id'=t.canonical->>'approved_by' end)
        and p->>'currency'=t.currency and (p->>'valid_from')::timestamptz<=point
        and (p->>'valid_to' is null or point<(p->>'valid_to')::timestamptz);
    if policies is null or jsonb_array_length(policies)<>1 then return result; end if;
    policy:=policies->0;authority:=(policy->>'limit')::numeric;
    if authority<=0 then return result; end if;
    select count(*)::integer,coalesce(sum(p.amount),0) into n,total from public.feed_transactions p
        where p.source_id=t.source_id and p.organization_id=t.organization_id
        and (p.received_at,p.receipt_id)<(t.received_at,t.receipt_id)
        and p.vendor_id=t.vendor_id and p.currency=t.currency
        and p.identity_context->>'vendor_namespace'=t.identity_context->>'vendor_namespace'
        and p.amount>0 and p.amount<authority
        and (case when config->>'time_basis'='SIMULATED_ARRIVAL_TIME' then p.received_at else p.transaction_timestamp end)
            between point-interval '24 hours' and point;
    total:=total+case when t.amount>0 and t.amount<authority then t.amount else 0 end;
    pinned:=jsonb_set(pinned,'{history,subthreshold_invoice_splitting_context}',jsonb_build_object(
        'historical_transaction_count',n,'window_total_amount',total::text,'approval_limit',authority::text,
        'calculation_basis','SUBTHRESHOLD_CURRENT_APPROVAL_LIMIT'));
    update public.feed_audit_jobs set snapshot=pinned where transaction_id=t.id
        and lease_token=(result->>'lease_token')::uuid;
    return jsonb_set(result,'{snapshot}',pinned);
end;
$$;
revoke all on function public.claim_feed_audit_before_subthreshold() from public,anon,authenticated,service_role;
revoke all on function public.claim_feed_audit() from public,anon,authenticated;
grant execute on function public.claim_feed_audit() to service_role;
