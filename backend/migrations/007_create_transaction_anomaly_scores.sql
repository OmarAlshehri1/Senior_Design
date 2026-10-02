create table if not exists
public.transaction_anomaly_scores (
    id bigint generated always as identity primary key,
    transaction_id text not null
        references public.transactions (id)
        on delete cascade,
    model_version text not null,
    ai_score numeric(5, 2) not null
        check (
            ai_score >= 0
            and ai_score <= 100
        ),
    threshold numeric(5, 2) not null
        check (
            threshold >= 0
            and threshold <= 100
        ),
    is_anomalous boolean not null,
    scored_at timestamptz not null default now(),
    check (
        is_anomalous = (ai_score >= threshold)
    )
);

create index if not exists
    transaction_anomaly_scores_latest_idx
on public.transaction_anomaly_scores (
    transaction_id,
    scored_at desc,
    id desc
);

alter table public.transaction_anomaly_scores
    enable row level security;

revoke all
on table public.transaction_anomaly_scores
from public, anon, authenticated;

grant select, insert, update, delete
on table public.transaction_anomaly_scores
to service_role;

grant usage, select
on sequence public.transaction_anomaly_scores_id_seq
to service_role;

create or replace function
public.get_latest_transaction_anomaly_scores(
    transaction_ids text[]
)
returns table (
    transaction_id text,
    model_version text,
    ai_score numeric,
    threshold numeric,
    is_anomalous boolean,
    scored_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
    select distinct on (score.transaction_id)
        score.transaction_id,
        score.model_version,
        score.ai_score,
        score.threshold,
        score.is_anomalous,
        score.scored_at
    from public.transaction_anomaly_scores as score
    where
        $1 is not null
        and score.transaction_id = any ($1)
    order by
        score.transaction_id,
        score.scored_at desc,
        score.id desc;
$$;

revoke all
on function
public.get_latest_transaction_anomaly_scores(text[])
from public, anon, authenticated;

grant execute
on function
public.get_latest_transaction_anomaly_scores(text[])
to service_role;