create or replace function public.list_transactions_authoritative(
    p_page integer,
    p_page_size integer,
    p_search text default null,
    p_risk_level text default null,
    p_rule_status text default null,
    p_sort_by text default 'newest'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    normalized_search text := nullif(btrim(p_search), '');
    result jsonb;
begin
    if p_page < 1 or p_page_size < 1 or p_page_size > 100
       or (p_risk_level is not null and p_risk_level not in ('LOW', 'MEDIUM', 'HIGH'))
       or (p_rule_status is not null and p_rule_status not in ('PASSED', 'REVIEW'))
       or p_sort_by not in ('newest', 'oldest', 'highest-amount', 'lowest-amount')
       or length(normalized_search) > 100 then
        raise exception 'Invalid transaction query' using errcode = '22023';
    end if;

    with authoritative as (
        select
            transaction.id,
            transaction.transaction_timestamp,
            transaction.vendor_id,
            transaction.vendor_name,
            transaction.invoice_number,
            transaction.category,
            transaction.amount,
            transaction.currency,
            transaction.created_by,
            transaction.approved_by,
            transaction.approver_role,
            transaction.approval_limit,
            transaction.completeness_status,
            transaction.missing_fields,
            evaluation.rule_status,
            risk.risk_level
        from public.transactions as transaction
        left join lateral (
            select snapshot.rule_status
            from public.transaction_evaluations as snapshot
            where snapshot.transaction_id = transaction.id
            order by snapshot.evaluated_at desc, snapshot.id desc
            limit 1
        ) as evaluation on true
        left join lateral (
            select snapshot.risk_level
            from public.transaction_risk_scores as snapshot
            where snapshot.transaction_id = transaction.id
            order by snapshot.calculated_at desc, snapshot.id desc
            limit 1
        ) as risk on true
        where
            (
                normalized_search is null
                or transaction.id ilike '%' || normalized_search || '%'
                or transaction.vendor_name ilike '%' || normalized_search || '%'
                or transaction.category ilike '%' || normalized_search || '%'
            )
            and (p_risk_level is null or risk.risk_level = p_risk_level)
            and (
                p_rule_status is null
                or coalesce(evaluation.rule_status, 'NOT_EVALUATED') = p_rule_status
            )
    ),
    page_rows as (
        select *
        from authoritative
        order by
            case when p_sort_by = 'newest' then transaction_timestamp end desc nulls last,
            case when p_sort_by = 'oldest' then transaction_timestamp end asc nulls last,
            case when p_sort_by = 'highest-amount' then amount end desc nulls last,
            case when p_sort_by = 'lowest-amount' then amount end asc nulls last,
            id asc
        offset (p_page - 1) * p_page_size
        limit p_page_size
    )
    select jsonb_build_object(
        'items', coalesce(
            (
                select jsonb_agg(
                    jsonb_build_object(
                        'id', row.id,
                        'transaction_timestamp', row.transaction_timestamp,
                        'vendor_id', row.vendor_id,
                        'vendor_name', row.vendor_name,
                        'invoice_number', row.invoice_number,
                        'category', row.category,
                        'amount', row.amount,
                        'currency', row.currency,
                        'created_by', row.created_by,
                        'approved_by', row.approved_by,
                        'approver_role', row.approver_role,
                        'approval_limit', row.approval_limit,
                        'completeness_status', row.completeness_status,
                        'missing_fields', row.missing_fields
                    )
                    order by
                        case when p_sort_by = 'newest' then row.transaction_timestamp end desc nulls last,
                        case when p_sort_by = 'oldest' then row.transaction_timestamp end asc nulls last,
                        case when p_sort_by = 'highest-amount' then row.amount end desc nulls last,
                        case when p_sort_by = 'lowest-amount' then row.amount end asc nulls last,
                        row.id asc
                )
                from page_rows as row
            ),
            '[]'::jsonb
        ),
        'total', (select count(*) from authoritative)
    ) into result;

    return result;
end;
$$;

revoke all on function public.list_transactions_authoritative(
    integer, integer, text, text, text, text
) from public, anon, authenticated, service_role;

grant execute on function public.list_transactions_authoritative(
    integer, integer, text, text, text, text
) to service_role;
