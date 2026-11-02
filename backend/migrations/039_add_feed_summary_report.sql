-- Live aggregate report. No fabricated missing rule outcomes, converted currencies or model scores.
create function public.read_feed_summary_report(p_actor uuid,p_source text,p_start timestamptz default null,
    p_end timestamptz default null,p_team uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor public.user_profiles; result jsonb;
begin
    select * into actor from public.user_profiles where id=p_actor;
    if not found or actor.role not in ('ADMIN','SUPERVISOR') or not public.can_review_feed(p_actor,p_source) then
        raise exception 'Report access denied' using errcode='42501'; end if;
    if (p_start is null)<>(p_end is null) or (p_start is not null and p_start>=p_end) then
        raise exception 'Invalid report period' using errcode='22023'; end if;
    if p_team is not null and not exists(select 1 from public.feed_review_teams g
        join public.audit_teams team on team.id=g.team_id where g.source_id=p_source and team.id=p_team
        and team.is_active and (actor.role='ADMIN' or team.supervisor_id=p_actor)) then
        raise exception 'Team not eligible' using errcode='42501'; end if;

    with population as materialized (
        select t.id,t.record_id,t.received_at,t.amount,t.currency,j.status as job_status,r.bundle,r.evaluated_at,
            w.team_id,w.status as review_status,w.resolution,w.version,
            coalesce(r.bundle @> '{"rule_results":[{"status":"FAILED"}]}'::jsonb,false) as failed
        from public.feed_transactions t
        join public.ingestion_sources s on s.id=t.source_id and s.organization_id=t.organization_id
        left join public.feed_audit_jobs j on j.transaction_id=t.id
        left join public.feed_audit_results r on r.transaction_id=t.id
        left join public.feed_exception_reviews w on w.transaction_id=t.id
        where t.source_id=p_source and (p_start is null or (t.received_at>=p_start and t.received_at<p_end))
          and ((actor.role='ADMIN' and p_team is null) or public.can_review_feed_exception(p_actor,t.id))
          and (p_team is null or w.team_id=p_team)
    ), currency_totals as (
        select currency,count(*) as transactions,count(amount) as amounts_recorded,
            sum(amount)::text as recorded_amount,sum(amount) filter(where failed)::text as failed_recorded_amount
        from population group by currency
    ), keys(rule_key) as (values ('segregation_of_duties'),('approval_limits'),('duplicate_payment'),('invoice_splitting'),('ghost_vendors')),
    slots as (
        select k.rule_key,(select v->>'status' from jsonb_array_elements(p.bundle->'rule_results') v
            where v->>'rule_key'=k.rule_key limit 1) as status
        from population p cross join keys k where p.bundle is not null
    ), rule_totals as (
        select k.rule_key,count(*) filter(where s.status='PASSED') as passed,
            count(*) filter(where s.status='FAILED') as failed,
            count(*) filter(where s.status='NOT_EVALUATED') as not_evaluated,
            count(*) filter(where s.rule_key is not null and (s.status is null or s.status not in ('PASSED','FAILED','NOT_EVALUATED'))) as missing_or_unknown
        from keys k left join slots s on s.rule_key=k.rule_key group by k.rule_key
    ), sample as (
        select id,record_id,received_at,amount::text as amount,currency,job_status,
            failed,team_id,review_status,resolution,version
        from population order by received_at desc,id desc limit 100
    )
    select jsonb_build_object(
        'source_id',p_source,'team_id',p_team,'as_of',statement_timestamp(),
        'scope',case when actor.role='ADMIN' and p_team is null then 'SOURCE'
            when p_team is not null then 'TEAM_EXCEPTIONS' else 'SUPERVISOR_REVIEW_QUEUE' end,
        'period_start',p_start,'period_end',p_end,'period_basis','RECEIPT_ARRIVAL_INCLUSIVE_START_EXCLUSIVE_END',
        'counts',(select jsonb_build_object('transactions',count(*),'completed',count(*) filter(where bundle is not null),
            'pending',count(*) filter(where bundle is null and job_status in ('PENDING','AUDITING')),
            'blocked',count(*) filter(where bundle is null and job_status='BLOCKED'),
            'other_unprocessed',count(*) filter(where bundle is null and (job_status is null or job_status not in ('PENDING','AUDITING','BLOCKED'))),
            'failed_transactions',count(*) filter(where failed),
            'open_exceptions',count(*) filter(where failed and coalesce(review_status,'OPEN')='OPEN'),
            'in_review',count(*) filter(where failed and review_status='IN_REVIEW'),
            'closed_exceptions',count(*) filter(where failed and review_status='CLOSED'),
            'combined_risk_scored',count(*) filter(where bundle->>'risk_score' is not null),
            'combined_risk_unscored',count(*) filter(where bundle is not null and bundle->>'risk_score' is null)) from population),
        'currencies',coalesce((select jsonb_agg(to_jsonb(c) order by currency nulls last) from currency_totals c),'[]'::jsonb),
        'rules',(select jsonb_agg(to_jsonb(k) order by rule_key) from rule_totals k),
        'clocks',coalesce((select jsonb_agg(to_jsonb(c) order by time_basis) from (
            select coalesce(bundle->>'time_basis','UNAVAILABLE') as time_basis,count(*) as transactions
            from population group by coalesce(bundle->>'time_basis','UNAVAILABLE')) c),'[]'::jsonb),
        'schedule',coalesce((select jsonb_agg(to_jsonb(s) order by received_at desc,id desc) from sample s),'[]'::jsonb),
        'schedule_limit',100,'schedule_truncated',(select count(*)>100 from population)
    ) into result;
    return result;
end;
$$;
revoke all on function public.read_feed_summary_report(uuid,text,timestamptz,timestamptz,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_feed_summary_report(uuid,text,timestamptz,timestamptz,uuid) to service_role;
