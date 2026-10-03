create table if not exists public.transaction_risk_scores (
    id bigint generated always as identity primary key,
    transaction_id text not null
        references public.transactions(id)
        on delete cascade,
    scoring_version text not null,
    rule_evaluation_version text not null,
    anomaly_model_version text not null,
    rule_score numeric(5, 2) not null,
    ai_score numeric(5, 2) not null,
    risk_score numeric(5, 2) not null,
    risk_level text not null,
    calculated_at timestamptz not null default now(),

    constraint transaction_risk_rule_score_range
        check (rule_score between 0 and 100),

    constraint transaction_risk_ai_score_range
        check (ai_score between 0 and 100),

    constraint transaction_risk_score_range
        check (risk_score between 0 and 100),

    constraint transaction_risk_level_valid
        check (
            risk_level in ('LOW', 'MEDIUM', 'HIGH')
        ),

    constraint transaction_risk_level_consistent
        check (
            (risk_score < 50 and risk_level = 'LOW')
            or (
                risk_score >= 50
                and risk_score < 75
                and risk_level = 'MEDIUM'
            )
            or (
                risk_score >= 75
                and risk_level = 'HIGH'
            )
        )
);

create index if not exists
    transaction_risk_scores_latest_idx
on public.transaction_risk_scores (
    transaction_id,
    calculated_at desc,
    id desc
);

alter table public.transaction_risk_scores
enable row level security;

revoke all
on table public.transaction_risk_scores
from public, anon, authenticated;

grant select, insert, update, delete
on table public.transaction_risk_scores
to service_role;

grant usage, select
on sequence public.transaction_risk_scores_id_seq
to service_role;


create or replace function
public.get_latest_transaction_risk_scores(
    transaction_ids text[]
)
returns table (
    transaction_id text,
    scoring_version text,
    rule_evaluation_version text,
    anomaly_model_version text,
    rule_score numeric,
    ai_score numeric,
    risk_score numeric,
    risk_level text,
    calculated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select
        latest.transaction_id,
        latest.scoring_version,
        latest.rule_evaluation_version,
        latest.anomaly_model_version,
        latest.rule_score,
        latest.ai_score,
        latest.risk_score,
        latest.risk_level,
        latest.calculated_at
    from (
        select distinct on (scores.transaction_id)
            scores.transaction_id,
            scores.scoring_version,
            scores.rule_evaluation_version,
            scores.anomaly_model_version,
            scores.rule_score,
            scores.ai_score,
            scores.risk_score,
            scores.risk_level,
            scores.calculated_at,
            scores.id
        from public.transaction_risk_scores as scores
        where scores.transaction_id = any(transaction_ids)
        order by
            scores.transaction_id,
            scores.calculated_at desc,
            scores.id desc
    ) as latest;
$$;

revoke all
on function public.get_latest_transaction_risk_scores(text[])
from public, anon, authenticated;

grant execute
on function public.get_latest_transaction_risk_scores(text[])
to service_role;