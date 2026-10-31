-- Additive audit-rule filter for the Alerts queue. Alerts store no rule column;
-- an alert's rules are the FAILED results of its transaction's latest
-- evaluation, chosen exactly as get_latest_transaction_evaluations chooses it
-- (all_dataset_evaluations ordered by evaluated_at desc, id desc). Sealed
-- primary rows are read from primary_rule_mask/primary_rule_templates, the same
-- inputs all_dataset_evaluations uses. Existing functions are unchanged.

create function public.transaction_failed_rule_keys(p_transaction_id text)
returns text[] language sql stable security invoker set search_path='' as $$
    select x.rule_keys from (
        select e.evaluated_at,e.id,coalesce((select array_agg(r.value->>'rule_key' order by r.ordinality)
                from jsonb_array_elements(e.rule_results) with ordinality r where r.value->>'status'='FAILED'),'{}') as rule_keys
            from public.transaction_evaluations e where e.transaction_id=p_transaction_id
        union all
        select d.scored_at,-(t.dataset_id::bigint*4294967296+t.source_row),
            coalesce((select array_agg(p.payload->>'rule_key' order by p.ordinal) from public.primary_rule_templates p
                where p.version=d.rule_template_version and p.failed
                    and (t.primary_rule_mask::integer & (1<<p.ordinal))<>0 and p.payload->>'status'='FAILED'),'{}')
            from public.transactions t join public.primary_datasets d on d.id=t.dataset_id
            where t.id=p_transaction_id and t.primary_rule_mask is not null
    ) x order by x.evaluated_at desc,x.id desc limit 1;
$$;

-- Page enrichment only: callers pass transaction IDs from an already scoped page.
create function public.get_transaction_failed_rule_keys(p_transaction_ids text[])
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
    if coalesce(cardinality(p_transaction_ids),0)>100 then
        raise exception 'Invalid rule lookup' using errcode='22023';
    end if;
    return coalesce((select jsonb_object_agg(x.id,to_jsonb(coalesce(public.transaction_failed_rule_keys(x.id),'{}'::text[])))
        from (select distinct unnest(p_transaction_ids) as id) x where x.id is not null),'{}'::jsonb);
end;
$$;

-- Same scope, filters, ordering and projection as list_accessible_alerts_filtered,
-- plus the rule predicate (applied before ordering, paging and count) and rule_keys.
create function public.list_accessible_alerts_by_rule(
    p_actor uuid,p_page integer,p_page_size integer,p_rule text,p_status text default null,
    p_severity text default null,p_title text default null,p_search text default null,p_sort text default 'NEWEST')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; actor_team uuid; term text:=nullif(lower(btrim(coalesce(p_search,''))),'');
begin
    if p_page<1 or p_page_size<1 or p_page_size>100
        or p_rule is null or p_rule not in ('segregation_of_duties','approval_limits','duplicate_payment','invoice_splitting','ghost_vendors')
        or (p_status is not null and p_status not in ('ACTIVE','REVIEWED'))
        or (p_severity is not null and p_severity not in ('LOW','MEDIUM','HIGH'))
        or (p_sort not in ('NEWEST','OLDEST','HIGHEST_RISK'))
        or length(coalesce(p_title,''))>200 or length(coalesce(p_search,''))>100 then
        raise exception 'Invalid alert query' using errcode='22023';
    end if;
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found then raise exception 'Active user required' using errcode='42501'; end if;
    if actor.role='SUPERVISOR' then
        select id into actor_team from public.audit_teams where supervisor_id=p_actor and is_active;
        if not found then raise exception 'Supervisor team not configured' using errcode='42501'; end if;
    elsif actor.role not in ('AUDITOR','ADMIN') then
        raise exception 'Alert access denied' using errcode='42501';
    end if;

    return (
        with scoped as materialized (
            select a.*,aa.team_id as assignment_team_id,aa.assignee_id as assignment_assignee_id,
                aa.status as assignment_status,aa.updated_by as assignment_updated_by,aa.updated_at as assignment_updated_at,
                p.name as assignment_assignee_name
            from public.application_alerts a
            left join public.alert_assignments aa on aa.alert_id=a.id
            left join public.user_profiles p on p.id=aa.assignee_id
            left join public.transactions t on t.id=a.transaction_id
            where (p_status is null or a.status=p_status)
                and (p_severity is null or a.severity=p_severity)
                and (p_title is null or a.title=p_title)
                and (term is null or strpos(lower(a.id),term)>0 or strpos(lower(a.transaction_id),term)>0
                    or strpos(lower(a.title),term)>0 or strpos(lower(coalesce(t.vendor_name,'')),term)>0)
                and (actor.role='ADMIN'
                    or (actor.role='AUDITOR' and aa.status='ASSIGNED' and aa.assignee_id=p_actor)
                    or (actor.role='SUPERVISOR' and (aa.alert_id is null or aa.team_id=actor_team)))
                and p_rule=any(public.transaction_failed_rule_keys(a.transaction_id))
        ), page_rows as (
            select s.*,row_number() over (order by
                case when p_sort='HIGHEST_RISK' then s.risk_score end desc nulls last,
                case when p_sort='OLDEST' then s.created_at end asc,
                case when p_sort<>'OLDEST' then s.created_at end desc,
                s.id asc) as list_position
            from scoped s
            order by list_position limit p_page_size offset (p_page-1)*p_page_size
        )
        select jsonb_build_object(
            'items',coalesce((select jsonb_agg(
                (to_jsonb(r)-array['assignment_team_id','assignment_assignee_id','assignment_status','assignment_updated_by','assignment_updated_at','assignment_assignee_name','list_position'])
                || jsonb_build_object('assignment',case when r.assignment_status is null then null else jsonb_build_object(
                    'alert_id',r.id,'team_id',r.assignment_team_id,'assignee_id',r.assignment_assignee_id,
                    'assignee_name',r.assignment_assignee_name,'assigned_by_id',r.assignment_updated_by,
                    'assigned_at',r.assignment_updated_at,'status',r.assignment_status) end)
                || jsonb_build_object('rule_keys',to_jsonb(coalesce(public.transaction_failed_rule_keys(r.transaction_id),'{}'::text[])))
                order by r.list_position) from page_rows r),'[]'::jsonb),
            'total',(select count(*) from scoped),'page',p_page,'page_size',p_page_size)
    );
end;
$$;

revoke all on function public.transaction_failed_rule_keys(text),
    public.get_transaction_failed_rule_keys(text[]),
    public.list_accessible_alerts_by_rule(uuid,integer,integer,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.transaction_failed_rule_keys(text),
    public.get_transaction_failed_rule_keys(text[]),
    public.list_accessible_alerts_by_rule(uuid,integer,integer,text,text,text,text,text,text) to service_role;
