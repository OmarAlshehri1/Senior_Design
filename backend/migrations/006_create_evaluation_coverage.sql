create or replace function public.get_evaluation_coverage()
returns table (
    total_transaction_count bigint,
    evaluated_transaction_count bigint,
    unevaluated_transaction_count bigint,
    coverage_percent numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
    with latest_evaluations as (
        select distinct on (evaluation.transaction_id)
            evaluation.transaction_id,
            evaluation.rule_results
        from public.transaction_evaluations as evaluation
        order by
            evaluation.transaction_id,
            evaluation.evaluated_at desc,
            evaluation.id desc
    ),
    transaction_coverage as (
        select
            transaction.id,
            exists (
                select 1
                from jsonb_array_elements(
                    coalesce(
                        evaluation.rule_results,
                        '[]'::jsonb
                    )
                ) as rule
                where rule ->> 'status' in (
                    'PASSED',
                    'FAILED'
                )
            ) as automatically_evaluated
        from public.transactions as transaction
        left join latest_evaluations as evaluation
            on evaluation.transaction_id = transaction.id
    )
    select
        count(*) as total_transaction_count,
        count(*) filter (
            where automatically_evaluated
        ) as evaluated_transaction_count,
        count(*) filter (
            where not automatically_evaluated
        ) as unevaluated_transaction_count,
        case
            when count(*) = 0 then 0::numeric
            else round(
                (
                    count(*) filter (
                        where automatically_evaluated
                    )
                )::numeric
                / count(*)::numeric
                * 100,
                2
            )
        end as coverage_percent
    from transaction_coverage;
$$;

revoke all
on function public.get_evaluation_coverage()
from public, anon, authenticated;

grant execute
on function public.get_evaluation_coverage()
to service_role;