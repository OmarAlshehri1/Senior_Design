create table if not exists
public.transaction_explanations (
    id bigint generated always as identity primary key,
    transaction_id text not null
        references public.transactions (id)
        on delete cascade,
    model_name text not null,
    prompt_version text not null,
    rule_evaluation_version text not null,
    anomaly_model_version text not null,
    risk_scoring_version text not null,
    explanation text not null
        check (
            char_length(trim(explanation)) between 1 and 2000
        ),
    generated_at timestamptz not null default now()
);

create index if not exists
    transaction_explanations_latest_idx
on public.transaction_explanations (
    transaction_id,
    generated_at desc,
    id desc
);

alter table public.transaction_explanations
enable row level security;

revoke all
on table public.transaction_explanations
from public, anon, authenticated;

grant select, insert, update, delete
on table public.transaction_explanations
to service_role;

grant usage, select
on sequence public.transaction_explanations_id_seq
to service_role;

create or replace function
public.get_latest_transaction_explanations(
    transaction_ids text[]
)
returns table (
    transaction_id text,
    model_name text,
    prompt_version text,
    rule_evaluation_version text,
    anomaly_model_version text,
    risk_scoring_version text,
    explanation text,
    generated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select
        latest.transaction_id,
        latest.model_name,
        latest.prompt_version,
        latest.rule_evaluation_version,
        latest.anomaly_model_version,
        latest.risk_scoring_version,
        latest.explanation,
        latest.generated_at
    from (
        select distinct on (
            explanations.transaction_id
        )
            explanations.transaction_id,
            explanations.model_name,
            explanations.prompt_version,
            explanations.rule_evaluation_version,
            explanations.anomaly_model_version,
            explanations.risk_scoring_version,
            explanations.explanation,
            explanations.generated_at,
            explanations.id
        from public.transaction_explanations
            as explanations
        where
            transaction_ids is not null
            and explanations.transaction_id = any(
                transaction_ids
            )
        order by
            explanations.transaction_id,
            explanations.generated_at desc,
            explanations.id desc
    ) as latest;
$$;

revoke all
on function
public.get_latest_transaction_explanations(text[])
from public, anon, authenticated;

grant execute
on function
public.get_latest_transaction_explanations(text[])
to service_role;