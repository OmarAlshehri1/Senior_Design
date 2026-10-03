create or replace function public.get_dashboard_summary(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.user_profiles; result jsonb;
begin
    select * into profile from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found then raise exception 'Active account required' using errcode='42501'; end if;
    with latest_risk as (
        select distinct on (transaction_id) transaction_id,risk_score,risk_level
        from public.transaction_risk_scores order by transaction_id,calculated_at desc,id desc
    ), counts as (
        select count(*) total_transactions,
          count(*) filter(where r.risk_level in ('HIGH','MEDIUM','LOW')) transactions_evaluated,
          count(*) filter(where r.risk_level='HIGH') high_risk_transactions,
          count(*) filter(where r.risk_level='MEDIUM') medium_risk_transactions,
          count(*) filter(where r.risk_level='LOW') low_risk_transactions,
          round(avg(r.risk_score) filter(where r.risk_level in ('HIGH','MEDIUM','LOW')),2) average_risk_score
        from public.transactions t left join latest_risk r on r.transaction_id=t.id
    ), alert_count as (
        select count(*) active_alerts from public.alerts a where a.status='ACTIVE'
          and (profile.role='ADMIN' or public.can_access_team_alert(p_actor,a.id))
    )
    select jsonb_build_object('total_transactions',c.total_transactions,'transactions_evaluated',c.transactions_evaluated,
      'high_risk_transactions',c.high_risk_transactions,'medium_risk_transactions',c.medium_risk_transactions,
      'low_risk_transactions',c.low_risk_transactions,'average_risk_score',coalesce(c.average_risk_score,0),
      'active_alerts',a.active_alerts,'generated_at',clock_timestamp()) into result
    from counts c cross join alert_count a;
    return result;
end;
$$;

create or replace function public.get_authoritative_analytics(p_actor uuid,p_period_days integer default 30)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.user_profiles; result jsonb; utc_today date; period_start date;
begin
    select * into profile from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found then raise exception 'Active account required' using errcode='42501'; end if;
    if p_period_days not in (7,30,90) then raise exception 'Unsupported analytics period' using errcode='22023'; end if;
    utc_today:=(clock_timestamp() at time zone 'UTC')::date;
    period_start:=utc_today-(p_period_days-1);
    with rule_definitions(rule_key,rule_name) as (values
      ('segregation_of_duties','Segregation of Duties'),('approval_limits','Approval Limits'),
      ('duplicate_payment','Duplicate Payments'),('invoice_splitting','Invoice Splitting'),('ghost_vendors','Ghost Vendors')),
    latest_evaluations as (
      select distinct on(e.transaction_id) e.transaction_id,e.rule_results,e.evaluated_at
      from public.transaction_evaluations e order by e.transaction_id,e.evaluated_at desc,e.id desc
    ), transaction_counts as (
      select count(*) total_transactions,
        count(*) filter(where coalesce(x.executed_count,0)=5) fully_evaluated,
        count(*) filter(where coalesce(x.executed_count,0)>0 and x.executed_count<5) partially_evaluated,
        count(*) filter(where coalesce(x.executed_count,0)=0) not_evaluated,
        count(*) filter(where coalesce(x.executed_count,0)>0) evaluated_transactions
      from public.transactions t left join lateral(
        select count(*) filter(where rr->>'status' in ('PASSED','FAILED')) executed_count
        from latest_evaluations e cross join lateral jsonb_array_elements(coalesce(e.rule_results,'[]'::jsonb)) rr
        where e.transaction_id=t.id
      ) x on true
    ), flattened as (
      select e.transaction_id,e.evaluated_at,rr->>'rule_key' rule_key,rr->>'status' status,coalesce(rr->'evidence','{}'::jsonb) evidence
      from latest_evaluations e cross join lateral jsonb_array_elements(coalesce(e.rule_results,'[]'::jsonb)) rr
    ), rule_coverage as (
      select d.rule_key,d.rule_name,count(*) filter(where f.status in ('PASSED','FAILED')) evaluated,
        count(*) filter(where f.status='NOT_EVALUATED' or f.status is null) not_evaluated
      from rule_definitions d cross join public.transactions t
      left join flattened f on f.transaction_id=t.id and f.rule_key=d.rule_key
      group by d.rule_key,d.rule_name
    ), exclusion_rows as (
      select f.rule_key,case
        when jsonb_array_length(coalesce(f.evidence->'missing_fields','[]'::jsonb))>0
          or jsonb_array_length(coalesce(f.evidence->'missing_any_of','[]'::jsonb))>0 then 'MISSING_REQUIRED_FIELDS'
        when f.evidence->>'historical_context_available'='false'
          or f.evidence->>'vendor_registry_available'='false' then 'RULE_CONTEXT_UNAVAILABLE'
        else 'RULE_NOT_EVALUATED' end reason
      from flattened f where f.status='NOT_EVALUATED'
      union all
      select d.rule_key,'EVALUATION_SNAPSHOT_MISSING' from rule_definitions d cross join public.transactions t
      where not exists(select 1 from latest_evaluations e where e.transaction_id=t.id)
    ), exclusions as (
      select rule_key,reason,count(*) transaction_count from exclusion_rows group by rule_key,reason
    ), daily_dates as (
      select generate_series(period_start,utc_today,interval '1 day')::date as bucket_date
    ), latest_daily_risk as (
      select distinct on(rs.transaction_id,(rs.calculated_at at time zone 'UTC')::date)
        rs.transaction_id,(rs.calculated_at at time zone 'UTC')::date as bucket_date,rs.risk_score,rs.risk_level
      from public.transaction_risk_scores rs
      where (rs.calculated_at at time zone 'UTC')::date between period_start and utc_today
      order by rs.transaction_id,(rs.calculated_at at time zone 'UTC')::date,rs.calculated_at desc,rs.id desc
    ), daily_risk as (
      select bucket_date,round(avg(risk_score),2) average_risk_score,count(*) filter(where risk_level='HIGH') high_risk_transactions,
        count(*) filter(where risk_level='MEDIUM') medium_risk_transactions,count(*) filter(where risk_level='LOW') low_risk_transactions
      from latest_daily_risk group by bucket_date
    ), daily_alerts as (
      select (a.created_at at time zone 'UTC')::date as bucket_date,count(*) alerts_created from public.alerts a
      where (a.created_at at time zone 'UTC')::date between period_start and utc_today
        and (profile.role='ADMIN' or public.can_access_team_alert(p_actor,a.id)) group by 1
    ), daily_closures as (
      select (c.closed_at at time zone 'UTC')::date as bucket_date,count(*) filter(where c.resolution_outcome='ISSUE_CONFIRMED') confirmed_issues,
        count(*) filter(where c.resolution_outcome='FALSE_POSITIVE') false_positives
      from public.audit_cases c where c.closed_at is not null and (c.closed_at at time zone 'UTC')::date between period_start and utc_today
        and public.can_access_case(p_actor,c.id) group by 1
    ), daily_rule_violations as (
      select (f.evaluated_at at time zone 'UTC')::date as bucket_date,f.rule_key,count(*) violations
      from flattened f where f.status='FAILED' and (f.evaluated_at at time zone 'UTC')::date between period_start and utc_today
      group by 1,2
    ), coverage_json as (
      select jsonb_build_object('total_transactions',tc.total_transactions,'fully_evaluated',tc.fully_evaluated,
        'partially_evaluated',tc.partially_evaluated,'not_evaluated',tc.not_evaluated,'evaluated_transactions',tc.evaluated_transactions,
        'coverage_percent',case when tc.total_transactions=0 then 0 else round(tc.evaluated_transactions::numeric/tc.total_transactions*100,2) end,
        'by_rule',coalesce((select jsonb_agg(jsonb_build_object('rule_key',rc.rule_key,'rule_name',rc.rule_name,
          'evaluated_transactions',rc.evaluated,'not_evaluated_transactions',rc.not_evaluated,
          'coverage_percent',case when tc.total_transactions=0 then 0 else round(rc.evaluated::numeric/tc.total_transactions*100,2) end) order by rc.rule_key) from rule_coverage rc),'[]'::jsonb),
        'exclusions',coalesce((select jsonb_agg(jsonb_build_object('rule_key',ex.rule_key,'reason',ex.reason,'transaction_count',ex.transaction_count) order by ex.rule_key,ex.reason) from exclusions ex),'[]'::jsonb)) value
      from transaction_counts tc
    ), risk_json as (
      select coalesce(jsonb_agg(jsonb_build_object('date',d.bucket_date,'average_risk_score',r.average_risk_score,
        'high_risk_transactions',coalesce(r.high_risk_transactions,0),'medium_risk_transactions',coalesce(r.medium_risk_transactions,0),
        'low_risk_transactions',coalesce(r.low_risk_transactions,0),'alerts_created',coalesce(a.alerts_created,0),
        'confirmed_issues',coalesce(c.confirmed_issues,0),'false_positives',coalesce(c.false_positives,0)) order by d.bucket_date),'[]'::jsonb) value
      from daily_dates d left join daily_risk r using(bucket_date) left join daily_alerts a using(bucket_date) left join daily_closures c using(bucket_date)
    ), rule_json as (
      select coalesce(jsonb_agg(jsonb_build_object('date',d.bucket_date,'rule_key',defs.rule_key,'rule_name',defs.rule_name,'violations',coalesce(v.violations,0)) order by d.bucket_date,defs.rule_key),'[]'::jsonb) value
      from daily_dates d cross join rule_definitions defs left join daily_rule_violations v on v.bucket_date=d.bucket_date and v.rule_key=defs.rule_key
    )
    select jsonb_build_object('period_days',p_period_days,'period_start',period_start,'period_end',utc_today+1,
      'coverage',coverage_json.value,'risk_trends',risk_json.value,'rule_violation_trends',rule_json.value) into result
    from coverage_json cross join risk_json cross join rule_json;
    return result;
end;
$$;

revoke all on function public.get_dashboard_summary(uuid),public.get_authoritative_analytics(uuid,integer) from public,anon,authenticated;
grant execute on function public.get_dashboard_summary(uuid),public.get_authoritative_analytics(uuid,integer) to service_role;
