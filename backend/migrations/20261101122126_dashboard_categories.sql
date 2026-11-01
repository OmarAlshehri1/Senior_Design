-- Dashboard categories use the same organization transaction scope as migration
-- 019's summary and the authenticated transaction list. Alerts remain team scoped.
-- Backend only: callers cannot provide another actor through the HTTP endpoint.
create or replace function public.get_dashboard_categories(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare result jsonb;
begin
    if not exists(select 1 from public.user_profiles where id=p_actor
                  and account_status='ACTIVE' and role in ('ADMIN','SUPERVISOR','AUDITOR')) then
        raise exception 'Active account required' using errcode='42501';
    end if;
    with latest_risk as materialized (
        select distinct on (transaction_id) transaction_id, risk_level
        from public.transaction_risk_scores
        order by transaction_id, calculated_at desc, id desc
    ), categories as (
        select nullif(t.category,'') as category, count(*) as transactions,
               count(*) filter(where r.risk_level='HIGH') as high_risk_transactions
        from public.transactions t left join latest_risk r on r.transaction_id=t.id
        group by nullif(t.category,'')
    )
    select jsonb_build_object(
        'items', coalesce(jsonb_agg(to_jsonb(c) order by c.transactions desc,c.category nulls last),'[]'::jsonb),
        'total_transactions', coalesce(sum(c.transactions),0),
        'scope', 'ORGANIZATION', 'generated_at', statement_timestamp()
    ) into result from categories c;
    return result;
end; $$;
revoke all on function public.get_dashboard_categories(uuid) from public,anon,authenticated;
grant execute on function public.get_dashboard_categories(uuid) to service_role;
