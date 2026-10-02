create index if not exists transactions_vendor_time_amount_idx
    on public.transactions (
        vendor_id,
        currency,
        transaction_timestamp,
        amount
    );

create index if not exists transactions_vendor_name_time_amount_idx
    on public.transactions (
        lower(btrim(vendor_name)),
        currency,
        transaction_timestamp,
        amount
    );

create or replace function public.get_invoice_splitting_context(
    transaction_ids text[]
)
returns table (
    transaction_id text,
    historical_transaction_count bigint,
    window_total_amount numeric
)
language sql
stable
security definer
set search_path = public
as $$
    select
        source.id as transaction_id,
        count(candidate.id)::bigint
            as historical_transaction_count,
        (
            coalesce(source.amount, 0)
            + coalesce(sum(candidate.amount), 0)
        )::numeric as window_total_amount
    from public.transactions as source
    left join public.transactions as candidate
        on candidate.id <> source.id
        and candidate.transaction_timestamp
            >= source.transaction_timestamp
                - interval '24 hours'
        and candidate.transaction_timestamp
            <= source.transaction_timestamp
        and candidate.currency
            is not distinct from source.currency
        and candidate.amount is not null
        and source.approval_limit is not null
        and source.amount is not null
        and source.amount <= source.approval_limit
        and candidate.amount <= source.approval_limit
        and (
            (
                source.vendor_id is not null
                and candidate.vendor_id = source.vendor_id
            )
            or (
                source.vendor_id is null
                and source.vendor_name is not null
                and candidate.vendor_name is not null
                and lower(btrim(candidate.vendor_name))
                    = lower(btrim(source.vendor_name))
            )
        )
    where source.id = any(transaction_ids)
    group by
        source.id,
        source.amount;
$$;

revoke all
on function public.get_invoice_splitting_context(text[])
from public, anon, authenticated;

grant execute
on function public.get_invoice_splitting_context(text[])
to service_role;