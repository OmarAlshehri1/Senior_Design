-- Separate, explicitly assumed simulation indicator. Does not bypass real audit gates.
-- Apply after 029 only. No automatic startup or production migration.
create function public.simulated_name_window(p_transaction_id uuid,p_configuration jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare t public.feed_transactions; policy jsonb; name_value jsonb; path text[];
    prior_count integer; gap_count integer; prior_total numeric; total numeric; candidate_count integer;
    threshold numeric:=10000.00; status text; reason text; indicated boolean; current_eligible boolean;
begin
    select * into t from public.feed_transactions where id=p_transaction_id;
    if not found then raise exception 'Simulation transaction missing'; end if;
    policy:=p_configuration->'simulation_splitting';
    if p_configuration->>'time_basis' is distinct from 'SIMULATED_ARRIVAL_TIME'
        or policy->>'scenario_version' is distinct from 'payments-name-window-1.0.0'
        or policy->>'threshold' is distinct from '10000.00'
        or policy->>'currency' is distinct from 'USD'
        or policy->'grouping_path' is distinct from '["source","VENDOR NAME"]'::jsonb
        then raise exception 'Unapproved simulation name-window configuration'; end if;
    path:=array['original_record']||array(select jsonb_array_elements_text(policy->'grouping_path'));
    select r.envelope#>path into name_value from public.ingestion_receipts r where r.id=t.receipt_id;
    with prior as (
        select p.id,p.amount,p.currency,r.envelope#>path as source_name
        from public.ingestion_receipts r left join public.feed_transactions p on p.receipt_id=r.id
        where r.source_id=t.source_id and r.organization_id=t.organization_id
            and r.received_at>=t.received_at-interval '24 hours'
            and (r.received_at,r.id)<(t.received_at,t.receipt_id)
    ) select
        count(*) filter(where currency='USD' and amount>0 and amount<threshold and source_name=name_value
            and jsonb_typeof(name_value)='string' and btrim(name_value#>>'{}')<>''),
        coalesce(sum(amount) filter(where currency='USD' and amount>0 and amount<threshold and source_name=name_value
            and jsonb_typeof(name_value)='string' and btrim(name_value#>>'{}')<>''),0),
        count(*) filter(where (currency is null or currency='USD') and (id is null or amount is null or currency is null
            or jsonb_typeof(source_name) is distinct from 'string' or btrim(source_name#>>'{}')=''))
        into prior_count,prior_total,gap_count from prior;
    current_eligible:=coalesce(t.currency='USD' and t.amount>0 and t.amount<threshold
        and jsonb_typeof(name_value)='string' and btrim(name_value#>>'{}')<>'',false);
    candidate_count:=prior_count+case when current_eligible then 1 else 0 end;
    total:=prior_total+case when current_eligible then t.amount else 0 end;
    if t.currency is null or t.currency<>'USD' or t.amount is null
        or jsonb_typeof(name_value) is distinct from 'string' or btrim(name_value#>>'{}')='' then
        status:='NOT_EVALUATED';reason:='REQUIRED_GROUP_OR_MONETARY_FIELDS_MISSING';indicated:=null;
    elsif not current_eligible then
        status:='NOT_APPLICABLE';reason:='CURRENT_PAYMENT_NOT_POSITIVE_BELOW_THRESHOLD';indicated:=false;
    elsif candidate_count>=2 and total>threshold then
        status:='INDICATED';reason:='MULTIPLE_SUBTHRESHOLD_RECORDS_EXCEED_SIMULATION_THRESHOLD';indicated:=true;
    elsif gap_count>0 then
        status:='NOT_EVALUATED';reason:='SIMULATION_HISTORY_INCOMPLETE';indicated:=null;
    else
        status:='NOT_INDICATED';reason:='OBSERVED_WINDOW_DOES_NOT_EXCEED_SIMULATION_THRESHOLD';indicated:=false;
    end if;
    return jsonb_build_object('scenario_version','payments-name-window-1.0.0','time_basis','SIMULATED_ARRIVAL_TIME',
        'grouping_basis','EXACT_SOURCE_VENDOR_NAME','scope','SOURCE_ORGANIZATION_AND_CURRENCY',
        'threshold','10000.00','currency','USD','window_hours',24,'window_end',t.received_at,
        'window_start',t.received_at-interval '24 hours','includes_current',current_eligible,
        'candidate_transactions',candidate_count,'candidate_total_amount',total::text,'history_complete',gap_count=0,
        'status',status,'reason',reason,'indicated',indicated,'human_review_required',true,
        'assumed_policy',true,'verified_supplier_identity',false,
        'meaning','Potential splitting under simulation assumptions; not verified supplier identity, actual Chicago policy violation or historical timing');
end;
$$;

alter function public.claim_feed_audit() rename to claim_feed_audit_before_name_window;
create function public.claim_feed_audit()
returns jsonb language plpgsql security definer set search_path='' as $$
declare job jsonb; pinned_snapshot jsonb; indicator jsonb;
begin
    job:=public.claim_feed_audit_before_name_window();
    if job is null or job->>'blocked'='true' or job->'snapshot' is null or job->'snapshot'='null'::jsonb then return job; end if;
    pinned_snapshot:=job->'snapshot';
    if pinned_snapshot->'configuration'->'simulation_splitting' is not null
        and pinned_snapshot->'configuration'->'simulation_splitting'<>'null'::jsonb then
        if pinned_snapshot->'simulation_name_window' is null then
            indicator:=public.simulated_name_window((job->>'transaction_id')::uuid,pinned_snapshot->'configuration');
            pinned_snapshot:=jsonb_set(pinned_snapshot,'{simulation_name_window}',indicator);
            update public.feed_audit_jobs set snapshot=pinned_snapshot
                where transaction_id=(job->>'transaction_id')::uuid and lease_token=(job->>'lease_token')::uuid;
            job:=jsonb_set(job,'{snapshot}',pinned_snapshot);
        end if;
    end if;
    return job;
end;
$$;

alter function public.finish_feed_audit(uuid,uuid,jsonb) rename to finish_feed_audit_before_name_window;
create function public.finish_feed_audit(p_transaction_id uuid,p_lease_token uuid,p_bundle jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare j public.feed_audit_jobs;
begin
    select * into j from public.feed_audit_jobs where transaction_id=p_transaction_id for update;
    if not found then return false; end if;
    if j.snapshot->'configuration'->'simulation_splitting' is not null
        and j.snapshot->'configuration'->'simulation_splitting'<>'null'::jsonb then
        if j.snapshot->'simulation_name_window' is null then raise exception 'Pinned simulation indicator missing'; end if;
        p_bundle:=jsonb_set(p_bundle,'{simulation_indicator}',j.snapshot->'simulation_name_window');
    else
        p_bundle:=p_bundle-'simulation_indicator';
    end if;
    return public.finish_feed_audit_before_name_window(p_transaction_id,p_lease_token,p_bundle);
end;
$$;

alter function public.ingestion_receipt_view(public.ingestion_receipts) rename to ingestion_receipt_view_before_name_window;
create function public.ingestion_receipt_view(p_receipt public.ingestion_receipts)
returns jsonb language sql stable set search_path='' as $$
    select public.ingestion_receipt_view_before_name_window(p_receipt)||jsonb_build_object(
        'simulation_indicator',(select b.bundle->'simulation_indicator' from public.feed_transactions t
            join public.feed_audit_results b on b.transaction_id=t.id where t.receipt_id=p_receipt.id));
$$;

revoke all on function public.simulated_name_window(uuid,jsonb),public.claim_feed_audit_before_name_window(),
    public.finish_feed_audit_before_name_window(uuid,uuid,jsonb),
    public.ingestion_receipt_view_before_name_window(public.ingestion_receipts),public.claim_feed_audit(),
    public.finish_feed_audit(uuid,uuid,jsonb),public.ingestion_receipt_view(public.ingestion_receipts)
    from public,anon,authenticated,service_role;
grant execute on function public.claim_feed_audit(),public.finish_feed_audit(uuid,uuid,jsonb) to service_role;
