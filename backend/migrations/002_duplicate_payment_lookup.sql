create index if not exists transactions_duplicate_payment_idx
    on public.transactions (
        invoice_number,
        amount,
        vendor_id
    );

create index if not exists transactions_vendor_name_normalized_idx
    on public.transactions (
        lower(btrim(vendor_name))
    );

create or replace function public.get_duplicate_payment_counts(
    transaction_ids text[]
)
returns table (
    transaction_id text,
    matching_transaction_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
    select
        source.id as transaction_id,
        count(candidate.id)::bigint
            as matching_transaction_count
    from public.transactions as source
    left join public.transactions as candidate
        on candidate.id <> source.id
        and candidate.invoice_number
            = source.invoice_number
        and candidate.amount = source.amount
        and (
            (
                source.vendor_id is not null
                and candidate.vendor_id
                    = source.vendor_id
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
    group by source.id;
$$;

revoke all
on function public.get_duplicate_payment_counts(text[])
from public, anon, authenticated;

grant execute
on function public.get_duplicate_payment_counts(text[])
to service_role;