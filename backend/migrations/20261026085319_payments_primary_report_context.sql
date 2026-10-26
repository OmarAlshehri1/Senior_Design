-- Separate retained report histories; context is captured in the same source snapshot.
alter table public.audit_reports add column dataset_id smallint not null default 0 references public.primary_datasets(id);
alter table public.audit_reports alter column dataset_id set default public.primary_dataset_id();
alter table public.audit_reports drop constraint audit_reports_period_start_period_end_key;
alter table public.audit_reports add constraint audit_reports_dataset_period_key unique(dataset_id,period_start,period_end);
create function public.primary_report_context() returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',d.id,'label',d.label,'source_schema',d.source_schema,
   'source_sha256',d.source_sha256,'currency',d.currency,'model_version',d.model_version)
 from public.primary_datasets d where d.id=public.primary_dataset_id();
$$;
revoke all on function public.primary_report_context() from public,anon,authenticated;
grant execute on function public.primary_report_context() to service_role;

create or replace function public.get_daily_audit_summary(
    p_period_start timestamptz,
    p_period_end timestamptz
)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
    with period_transactions as (
        select
            transaction.id,
            transaction.transaction_timestamp,
            transaction.vendor_name,
            transaction.amount,
            transaction.currency
        from public.application_transactions as transaction
        where
            transaction.transaction_timestamp >= p_period_start
            and transaction.transaction_timestamp < p_period_end
    ),
    latest_evaluations as materialized (
        select t.id as transaction_id,e.rule_status,e.rule_results
        from period_transactions t join lateral (
            select e.rule_status,e.rule_results from public.all_dataset_evaluations e
            where e.transaction_id=t.id order by e.evaluated_at desc,e.id desc limit 1
        )e on true
    ), latest_risk_scores as materialized (
        select t.id as transaction_id,r.risk_score,r.risk_level
        from period_transactions t join lateral (
            select r.risk_score,r.risk_level from public.all_dataset_risk_scores r
            where r.transaction_id=t.id order by r.calculated_at desc,r.id desc limit 1
        )r on true
    ),
    daily_statistics as (
        select
            count(*) as total_transactions,
            count(evaluation.transaction_id) filter (
                where evaluation.rule_status <> 'NOT_EVALUATED'
            ) as transactions_evaluated,
            count(score.transaction_id) filter (
                where score.risk_level = 'LOW'
            ) as low_risk_transactions,
            count(score.transaction_id) filter (
                where score.risk_level = 'MEDIUM'
            ) as medium_risk_transactions,
            count(score.transaction_id) filter (
                where score.risk_level = 'HIGH'
            ) as high_risk_transactions,
            round(
                coalesce(avg(score.risk_score), 0),
                2
            ) as average_risk_score
        from period_transactions as transaction
        left join latest_evaluations as evaluation
            on evaluation.transaction_id = transaction.id
        left join latest_risk_scores as score
            on score.transaction_id = transaction.id
    ),
    alert_statistics as (
        select
            count(alert.id) as total_alerts,
            count(alert.id) filter (
                where alert.status = 'ACTIVE'
            ) as active_alerts,
            count(alert.id) filter (
                where alert.status = 'REVIEWED'
            ) as reviewed_alerts,
            count(alert.id) filter (
                where alert.severity = 'HIGH'
            ) as high_alerts,
            count(alert.id) filter (
                where alert.severity = 'MEDIUM'
            ) as medium_alerts
        from public.application_alerts as alert
        inner join period_transactions as transaction
            on transaction.id = alert.transaction_id
    ),
    failed_rule_counts as (
        select
            result.value ->> 'rule_key' as rule_key,
            max(result.value ->> 'rule_name') as rule_name,
            count(*) as violation_count
        from latest_evaluations as evaluation
        cross join lateral jsonb_array_elements(
            evaluation.rule_results
        ) as result(value)
        where result.value ->> 'status' = 'FAILED'
        group by result.value ->> 'rule_key'
    ),
    rule_summary as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'rule_key',
                    failed_rule_counts.rule_key,
                    'rule_name',
                    failed_rule_counts.rule_name,
                    'violation_count',
                    failed_rule_counts.violation_count
                )
                order by failed_rule_counts.rule_key
            ),
            '[]'::jsonb
        ) as value
        from failed_rule_counts
    ),
    high_risk_summary as (
        select coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'id',
                    transaction.id,
                    'timestamp',
                    transaction.transaction_timestamp,
                    'vendor_name',
                    transaction.vendor_name,
                    'amount',
                    transaction.amount,
                    'currency',
                    transaction.currency,
                    'risk_score',
                    score.risk_score,
                    'risk_level',
                    score.risk_level
                )
                order by transaction.transaction_timestamp desc
            ),
            '[]'::jsonb
        ) as value
        from period_transactions as transaction
        inner join latest_risk_scores as score
            on score.transaction_id = transaction.id
        where score.risk_level = 'HIGH'
    )
    select jsonb_build_object(
        'dataset',public.primary_report_context(),
        'daily_summary',
        jsonb_build_object(
            'total_transactions',
            daily.total_transactions,
            'transactions_evaluated',
            daily.transactions_evaluated,
            'high_risk_transactions',
            daily.high_risk_transactions,
            'average_risk_score',
            daily.average_risk_score,
            'active_alerts',
            alerts.active_alerts,
            'reviewed_alerts',
            alerts.reviewed_alerts
        ),
        'risk_distribution',
        jsonb_build_object(
            'low',
            daily.low_risk_transactions,
            'medium',
            daily.medium_risk_transactions,
            'high',
            daily.high_risk_transactions
        ),
        'alert_summary',
        jsonb_build_object(
            'total',
            alerts.total_alerts,
            'active',
            alerts.active_alerts,
            'reviewed',
            alerts.reviewed_alerts,
            'high',
            alerts.high_alerts,
            'medium',
            alerts.medium_alerts
        ),
        'rule_summary',
        rules.value,
        'high_risk_transactions',
        high_risk.value
    )
    from daily_statistics as daily
    cross join alert_statistics as alerts
    cross join rule_summary as rules
    cross join high_risk_summary as high_risk;
$$;

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
    with cohort as materialized (
        select t.* from public.application_transactions t where actor.role='ADMIN' or exists (
            select 1 from public.application_alerts a join public.alert_assignments aa on aa.alert_id=a.id
            where a.transaction_id=t.id and aa.team_id=team.id
        ) or exists (select 1 from public.audit_cases c where c.transaction_id=t.id and c.team_id=team.id)
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

create or replace function public.complete_daily_audit_report(
    p_run_id uuid, p_lease_token uuid, p_summary jsonb
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    state_row public.daily_report_schedule_state;
    run_row public.daily_report_runs;
    stored_report_id text;
    source_dataset smallint;
    period_start_utc timestamptz;
    period_end_utc timestamptz;
begin
    select * into state_row from public.daily_report_schedule_state where singleton = true for update;
    if p_run_id is null or p_lease_token is null or p_summary is null
       or state_row.active_run_id is distinct from p_run_id
       or state_row.lease_token is distinct from p_lease_token
       or state_row.lease_until <= clock_timestamp() then
        raise exception 'Daily report lease is no longer valid' using errcode = '40001';
    end if;
    select * into run_row from public.daily_report_runs where id = p_run_id and status = 'RUNNING' for update;
    if not found or jsonb_typeof(p_summary) is distinct from 'object' then
        raise exception 'Daily report completion payload is invalid' using errcode = '22023';
    end if;

    period_start_utc := run_row.period_start::timestamp at time zone 'UTC';
    period_end_utc := run_row.period_end::timestamp at time zone 'UTC';
    source_dataset:=coalesce((p_summary->'dataset'->>'id')::smallint,0);
    if not exists(select 1 from public.primary_datasets where id=source_dataset and state='READY') then
      raise exception 'Ready report dataset required' using errcode='22023'; end if;
    stored_report_id := case when source_dataset=0 then 'RPT-' else 'RPT-P'||source_dataset::text||'-' end || run_row.period_start::text;
    insert into public.audit_reports(dataset_id,id, report_type, status, period_start, period_end, summary, completed_at)
    values (source_dataset,stored_report_id, 'DAILY', 'COMPLETED', period_start_utc, period_end_utc,
            p_summary || jsonb_build_object('report_version', '1.0.0'), clock_timestamp())
    on conflict (dataset_id, period_start, period_end) do nothing;
    if not found then
        select id into stored_report_id from public.audit_reports
         where dataset_id=source_dataset and period_start = period_start_utc and period_end = period_end_utc and status = 'COMPLETED';
        if stored_report_id is null then
            raise exception 'Existing daily report is not complete' using errcode = '23514';
        end if;
    end if;

    update public.daily_report_runs
       set status = 'COMPLETED', completed_at = clock_timestamp(), report_id = stored_report_id
     where id = p_run_id;
    update public.daily_report_schedule_state
       set next_period_start = run_row.period_end, attempt_count = 0, available_at = clock_timestamp(),
           lease_token = null, lease_until = null, active_run_id = null, updated_at = clock_timestamp()
     where singleton = true;

    return jsonb_build_object('report_id', stored_report_id, 'period_start', period_start_utc, 'period_end', period_end_utc);
end;
$$;
