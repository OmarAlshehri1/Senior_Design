-- Additive read-only RPC. Respect the active-dataset view when installed;
-- older staging schemas continue to use the original transaction tables.
create or replace function public.get_dashboard_categories(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
    if not exists(select 1 from public.user_profiles where id=p_actor
      and account_status='ACTIVE' and role in ('ADMIN','SUPERVISOR','AUDITOR')) then
      raise exception 'Active account required' using errcode='42501';
    end if;
    if to_regclass('public.application_transactions') is not null then
      execute $query$
        with latest as materialized (
          select distinct on(r.transaction_id) r.transaction_id,r.risk_level
          from public.transaction_risk_scores r
          join public.application_transactions t on t.id=r.transaction_id
          where t.primary_rule_mask is null
          order by r.transaction_id,r.calculated_at desc,r.id desc
        ), categories as (
          select nullif(t.category,'') category,count(*) transactions,
            count(*) filter(where case when t.primary_rule_mask is not null
              then t.primary_risk_scaled>=7500 else r.risk_level='HIGH' end) high_risk_transactions
          from public.application_transactions t left join latest r on r.transaction_id=t.id
          group by nullif(t.category,'')
        ) select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(c) order by c.transactions desc,c.category nulls last),'[]'::jsonb),
          'total_transactions',coalesce(sum(c.transactions),0),'scope','ORGANIZATION','generated_at',statement_timestamp())
          from categories c
      $query$ into result;
    else
      with latest as materialized (
        select distinct on(transaction_id) transaction_id,risk_level
        from public.transaction_risk_scores order by transaction_id,calculated_at desc,id desc
      ), categories as (
        select nullif(t.category,'') category,count(*) transactions,
          count(*) filter(where r.risk_level='HIGH') high_risk_transactions
        from public.transactions t left join latest r on r.transaction_id=t.id
        group by nullif(t.category,'')
      ) select jsonb_build_object('items',coalesce(jsonb_agg(to_jsonb(c) order by c.transactions desc,c.category nulls last),'[]'::jsonb),
        'total_transactions',coalesce(sum(c.transactions),0),'scope','ORGANIZATION','generated_at',statement_timestamp())
        into result from categories c;
    end if;
    return result;
end; $$;
revoke all on function public.get_dashboard_categories(uuid) from public,anon,authenticated;
grant execute on function public.get_dashboard_categories(uuid) to service_role;
