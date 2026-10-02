create table if not exists public.transaction_evaluations (
    id bigint generated always as identity primary key,
    transaction_id text not null
        references public.transactions (id)
        on delete cascade,
    evaluation_version text not null,
    rule_status text not null
        check (
            rule_status in (
                'PASSED',
                'REVIEW',
                'NOT_EVALUATED'
            )
        ),
    rule_score numeric(5, 2)
        check (
            rule_score is null
            or (
                rule_score >= 0
                and rule_score <= 100
            )
        ),
    rule_results jsonb not null default '[]'::jsonb
        check (jsonb_typeof(rule_results) = 'array'),
    evaluated_at timestamptz not null default now(),
    check (
        (
            rule_status = 'NOT_EVALUATED'
            and rule_score is null
        )
        or (
            rule_status in ('PASSED', 'REVIEW')
            and rule_score is not null
        )
    )
);

create index if not exists
    transaction_evaluations_latest_idx
on public.transaction_evaluations (
    transaction_id,
    evaluated_at desc,
    id desc
);

alter table public.transaction_evaluations
    enable row level security;

revoke all
on table public.transaction_evaluations
from public, anon, authenticated;

grant select, insert, update, delete
on table public.transaction_evaluations
to service_role;

grant usage, select
on sequence public.transaction_evaluations_id_seq
to service_role;

create or replace function
public.get_latest_transaction_evaluations(
    transaction_ids text[]
)
returns table (
    transaction_id text,
    evaluation_version text,
    rule_status text,
    rule_score numeric,
    rule_results jsonb,
    evaluated_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
    select distinct on (evaluation.transaction_id)
        evaluation.transaction_id,
        evaluation.evaluation_version,
        evaluation.rule_status,
        evaluation.rule_score,
        evaluation.rule_results,
        evaluation.evaluated_at
    from public.transaction_evaluations as evaluation
    where
        $1 is not null
        and evaluation.transaction_id = any ($1)
    order by
        evaluation.transaction_id,
        evaluation.evaluated_at desc,
        evaluation.id desc;
$$;

revoke all
on function
public.get_latest_transaction_evaluations(text[])
from public, anon, authenticated;

grant execute
on function
public.get_latest_transaction_evaluations(text[])
to service_role;