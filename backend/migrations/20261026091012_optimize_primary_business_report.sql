-- Avoid materializing all 355,426 wide records before applying the report period.
create or replace function public.get_business_report_source(p_actor uuid,p_start timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; team public.audit_teams; result jsonb;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found or actor.role not in ('ADMIN','SUPERVISOR') then
        raise exception 'Report access denied' using errcode='42501';
    end if;
    if actor.role='SUPERVISOR' then
        select * into team from public.audit_teams where supervisor_id=p_actor and is_active;
        if not found then raise exception 'Active supervising team required' using errcode='42501'; end if;
    end if;
    if p_start is not null and p_start<>date_trunc('day',p_start at time zone 'UTC') at time zone 'UTC' then
        raise exception 'UTC midnight required' using errcode='22023';
    end if;
    with cohort as not materialized (
        select t.* from public.application_transactions t where actor.role='ADMIN'
        union all
        select t.* from public.application_transactions t join (
            select a.transaction_id from public.application_alerts a
              join public.alert_assignments aa on aa.alert_id=a.id where aa.team_id=team.id
            union
            select c.transaction_id from public.audit_cases c where c.team_id=team.id
        ) authorized on authorized.transaction_id=t.id where actor.role<>'ADMIN'
    ), bounds as (
        select coalesce(p_start,date_trunc('day',max(transaction_timestamp) at time zone 'UTC') at time zone 'UTC') as start_at from cohort
    ), period_rows as materialized (
        select t.* from cohort t cross join bounds b
        where t.transaction_timestamp>=b.start_at and t.transaction_timestamp<b.start_at+interval '24 hours'
    ), tx as (
        select t.id,t.transaction_timestamp as timestamp,t.vendor_name,t.amount,t.currency,
            t.completeness_status as data_quality_status,t.missing_fields,
            e.id as evaluation_id,e.evaluation_version,e.evaluated_at,
            coalesce(e.rule_results,'[]'::jsonb) as rule_results,
            r.id as risk_snapshot_id,r.scoring_version,r.rule_evaluation_version,r.anomaly_model_version,
            r.calculated_at,r.rule_score,r.ai_score,r.risk_score,r.risk_level
        from period_rows t
        left join lateral (select * from public.application_evaluations e where e.transaction_id=t.id
            order by e.evaluated_at desc,e.id desc limit 1) e on true
        left join lateral (select * from public.application_risk_scores r where r.transaction_id=t.id
            order by r.calculated_at desc,r.id desc limit 1) r on true
    ), scoped_alerts as (
        select a.id,a.transaction_id,a.severity,a.status,a.created_at,a.reviewed_at
        from public.application_alerts a join period_rows t on t.id=a.transaction_id
        where actor.role='ADMIN' or exists(select 1 from public.alert_assignments aa where aa.alert_id=a.id and aa.team_id=team.id)
    ), scoped_cases as (
        select c.id,c.case_number,c.transaction_id,c.status,c.priority,c.sla_status,c.sla_due_at,
            c.created_at,c.updated_at,c.closed_at,c.resolution_outcome
        from public.audit_cases c join period_rows t on t.id=c.transaction_id
        where actor.role='ADMIN' or c.team_id=team.id
    )
    select jsonb_build_object(
        'dataset',public.primary_report_context(),
        'organization_name',(select organization_name from public.organization_settings where singleton),
        'prepared_by',jsonb_build_object('id',actor.id,'name',actor.name,'role',actor.role),
        'scope',case when actor.role='ADMIN' then 'ORGANIZATION' else 'TEAM' end,
        'team_id',team.id,'team_name',team.name,'as_of',statement_timestamp(),
        'period_start',b.start_at,'period_end',b.start_at+interval '24 hours',
        'undated_in_scope',(select count(*) from cohort where transaction_timestamp is null),
        'transactions',coalesce((select jsonb_agg(to_jsonb(tx) order by tx.timestamp,tx.id) from tx),'[]'::jsonb),
        'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from scoped_alerts a),'[]'::jsonb),
        'cases',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from scoped_cases c),'[]'::jsonb)
    ) into result from bounds b;
    if result->>'organization_name' is null then raise exception 'Organization settings unavailable'; end if;
    if result->>'period_start' is null then raise exception 'No dated transactions in scope' using errcode='22023'; end if;
    return result;
end; $$;
