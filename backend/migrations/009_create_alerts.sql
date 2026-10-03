create extension if not exists pgcrypto;

create table if not exists public.alerts (
    id text primary key default (
        'AL-' || gen_random_uuid()::text
    ),
    transaction_id text not null unique
        references public.transactions(id) on delete cascade,
    severity text not null
        check (severity in ('LOW', 'MEDIUM', 'HIGH')),
    title text not null,
    description text not null,
    reason text not null,
    status text not null default 'ACTIVE'
        check (status in ('ACTIVE', 'REVIEWED')),
    risk_score numeric(5, 2) not null
        check (risk_score between 0 and 100),
    risk_scoring_version text not null,
    request_received_at timestamptz not null,
    created_at timestamptz not null default now(),
    reviewed_at timestamptz,
    latency_ms numeric generated always as (
        greatest(
            extract(
                epoch from (created_at - request_received_at)
            ) * 1000,
            0
        )
    ) stored,
    constraint alerts_review_state_check check (
        (
            status = 'ACTIVE'
            and reviewed_at is null
        )
        or (
            status = 'REVIEWED'
            and reviewed_at is not null
        )
    )
);

create index if not exists alerts_created_at_idx
    on public.alerts (created_at desc);

create index if not exists alerts_status_created_at_idx
    on public.alerts (status, created_at desc);

alter table public.alerts enable row level security;

revoke all on table public.alerts from anon, authenticated;
grant select, insert, update on table public.alerts to service_role;