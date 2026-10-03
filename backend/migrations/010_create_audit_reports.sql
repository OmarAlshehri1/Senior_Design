create table if not exists public.audit_reports (
    id text primary key,
    report_type text not null default 'DAILY'
        check (report_type = 'DAILY'),
    status text not null
        check (status in ('PENDING', 'COMPLETED', 'FAILED')),
    period_start timestamptz not null,
    period_end timestamptz not null,
    summary jsonb not null default '{}'::jsonb
        check (jsonb_typeof(summary) = 'object'),
    created_at timestamptz not null default now(),
    completed_at timestamptz,
    failure_reason text,
    constraint audit_reports_period_valid check (
        period_end > period_start
        and period_end - period_start <= interval '1 day'
    ),
    constraint audit_reports_status_valid check (
        (
            status = 'PENDING'
            and completed_at is null
            and failure_reason is null
        )
        or (
            status = 'COMPLETED'
            and completed_at is not null
            and failure_reason is null
        )
        or (
            status = 'FAILED'
            and completed_at is not null
            and failure_reason is not null
        )
    ),
    unique (period_start, period_end)
);

create index if not exists audit_reports_created_at_idx
    on public.audit_reports (created_at desc);

alter table public.audit_reports enable row level security;

revoke all
on table public.audit_reports
from public, anon, authenticated;

grant select, insert, update
on table public.audit_reports
to service_role;


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
        from public.transactions as transaction
        where
            transaction.transaction_timestamp >= p_period_start
            and transaction.transaction_timestamp < p_period_end
    ),
    latest_evaluations as (
        select distinct on (evaluation.transaction_id)
            evaluation.transaction_id,
            evaluation.rule_status,
            evaluation.rule_results
        from public.transaction_evaluations as evaluation
        inner join period_transactions as transaction
            on transaction.id = evaluation.transaction_id
        order by
            evaluation.transaction_id,
            evaluation.evaluated_at desc,
            evaluation.id desc
    ),
    latest_risk_scores as (
        select distinct on (score.transaction_id)
            score.transaction_id,
            score.risk_score,
            score.risk_level
        from public.transaction_risk_scores as score
        inner join period_transactions as transaction
            on transaction.id = score.transaction_id
        order by
            score.transaction_id,
            score.calculated_at desc,
            score.id desc
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
        from public.alerts as alert
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

revoke all
on function public.get_daily_audit_summary(
    timestamptz,
    timestamptz
)
from public, anon, authenticated;

grant execute
on function public.get_daily_audit_summary(
    timestamptz,
    timestamptz
)
to service_role;