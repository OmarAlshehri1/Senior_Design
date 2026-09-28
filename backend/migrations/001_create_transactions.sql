create table if not exists public.transactions (
    id text primary key,
    transaction_timestamp timestamptz,
    vendor_id text,
    vendor_name text,
    invoice_number text,
    category text,
    amount numeric(14, 2),
    currency text default 'SAR',
    created_by text,
    approved_by text,
    approver_role text,
    approval_limit numeric(14, 2),
    completeness_status text not null
        check (completeness_status in ('COMPLETE', 'PARTIAL')),
    missing_fields jsonb not null default '[]'::jsonb,
    metadata jsonb not null default '{}'::jsonb,
    ground_truth jsonb not null default '{}'::jsonb,
    imported_at timestamptz not null default now()
);

alter table public.transactions enable row level security;
grant select, insert, update, delete
on table public.transactions
to service_role;

create index if not exists transactions_timestamp_idx
    on public.transactions (transaction_timestamp);

create index if not exists transactions_vendor_id_idx
    on public.transactions (vendor_id);

create index if not exists transactions_invoice_number_idx
    on public.transactions (invoice_number);