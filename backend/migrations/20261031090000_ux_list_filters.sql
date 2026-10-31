-- Additive list capabilities for the redesigned Alerts and Vendors queues.
-- Existing functions are unchanged; these new functions reuse their exact
-- authorization scope and apply every filter before ordering, paging and count.

create function public.list_accessible_alerts_filtered(
    p_actor uuid,p_page integer,p_page_size integer,p_status text default null,
    p_severity text default null,p_title text default null,p_search text default null,p_sort text default 'NEWEST')
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; actor_team uuid; term text:=nullif(lower(btrim(coalesce(p_search,''))),'');
begin
    if p_page<1 or p_page_size<1 or p_page_size>100
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
                order by r.list_position) from page_rows r),'[]'::jsonb),
            'total',(select count(*) from scoped),'page',p_page,'page_size',p_page_size)
    );
end;
$$;

-- Bounded option discovery and summary counts inside the caller's alert scope.
create function public.get_alert_filter_options(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; actor_team uuid;
begin
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
            select a.title,a.status,a.severity
            from public.application_alerts a
            left join public.alert_assignments aa on aa.alert_id=a.id
            where actor.role='ADMIN'
                or (actor.role='AUDITOR' and aa.status='ASSIGNED' and aa.assignee_id=p_actor)
                or (actor.role='SUPERVISOR' and (aa.alert_id is null or aa.team_id=actor_team))
        )
        select jsonb_build_object(
            'types',coalesce((select jsonb_agg(x.title order by x.title) from
                (select distinct title from scoped order by title limit 50) x),'[]'::jsonb),
            'counts',jsonb_build_object(
                'total',(select count(*) from scoped),
                'active',(select count(*) from scoped where status='ACTIVE'),
                'reviewed',(select count(*) from scoped where status='REVIEWED'),
                'active_high',(select count(*) from scoped where status='ACTIVE' and severity='HIGH'),
                'active_medium',(select count(*) from scoped where status='ACTIVE' and severity='MEDIUM')))
    );
end;
$$;

create function public.search_vendor_monitoring(p_actor uuid,p_page integer default 1,p_page_size integer default 25,
    p_status text default null,p_search text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.user_profiles; items jsonb; total bigint; term text:=nullif(lower(btrim(coalesce(p_search,''))),'');
begin
    select * into profile from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found or profile.role not in ('AUDITOR','SUPERVISOR','ADMIN') then raise exception 'Active account required' using errcode='42501'; end if;
    if p_page<1 or p_page_size<1 or p_page_size>100 or length(coalesce(p_search,''))>100
        or (p_status is not null and p_status not in ('NORMAL','WATCHLISTED','BLOCKED')) then raise exception 'Invalid vendor query' using errcode='22023'; end if;
    select count(*) into total from public.application_vendors v where (p_status is null or v.monitoring_status=p_status)
        and (term is null or strpos(lower(v.vendor_name),term)>0 or strpos(lower(coalesce(v.vendor_id,'')),term)>0);
    select coalesce(jsonb_agg(x.item order by x.vendor_name),'[]'::jsonb) into items from (
        select v.vendor_name, jsonb_build_object('id',coalesce(v.vendor_id,v.id::text),'vendorId',v.vendor_id,'name',v.vendor_name,'monitoringStatus',v.monitoring_status,
          'riskLevel',coalesce(r.risk_level,'LOW'),'averageRiskScore',r.average_score,'transactionCount',coalesce(t.tx_count,0),
          'totalTransactionValue',coalesce(t.tx_total,0),'activeAlerts',coalesce(a.alert_count,0),'openCases',coalesce(c.case_count,0),
          'ruleViolations',coalesce(r.violation_count,0)) as item
        from (select * from public.application_vendors v where (p_status is null or v.monitoring_status=p_status)
            and (term is null or strpos(lower(v.vendor_name),term)>0 or strpos(lower(coalesce(v.vendor_id,'')),term)>0)
          order by v.vendor_name,v.id limit p_page_size offset ((p_page-1)*p_page_size)) v
        left join lateral (select count(*) tx_count,coalesce(sum(amount),0) tx_total from public.primary_vendor_transactions(v.vendor_id,v.vendor_name) tx where (v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))) ) t on true
        left join lateral (select count(*) alert_count from public.alerts al join public.primary_vendor_transactions(v.vendor_id,v.vendor_name) tx on tx.id=al.transaction_id where al.status='ACTIVE' and (profile.role='ADMIN' or public.can_access_team_alert(p_actor,al.id)) and ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) a on true
        left join lateral (select count(*) case_count from public.audit_cases ca join public.primary_vendor_transactions(v.vendor_id,v.vendor_name) tx on tx.id=ca.transaction_id where ca.status not in ('CLOSED','RESOLVED') and public.can_access_case(p_actor,ca.id) and ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) c on true
        left join lateral (select avg(latest.risk_score)::numeric(5,2) average_score,(array_agg(latest.risk_level order by latest.calculated_at desc))[1] risk_level,count(*) filter(where latest.risk_level in ('HIGH','MEDIUM')) violation_count from public.primary_vendor_transactions(v.vendor_id,v.vendor_name) tx join lateral (select rs.risk_score,rs.risk_level,rs.calculated_at from public.application_risk_scores rs where rs.transaction_id=tx.id order by rs.calculated_at desc,rs.id desc limit 1) latest on true where ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) r on true
        order by v.vendor_name,v.id
    ) x;
    return jsonb_build_object('items',items,'total',total,'page',p_page,'page_size',p_page_size);
end;
$$;

revoke all on function public.list_accessible_alerts_filtered(uuid,integer,integer,text,text,text,text,text),
    public.get_alert_filter_options(uuid),
    public.search_vendor_monitoring(uuid,integer,integer,text,text) from public,anon,authenticated;
grant execute on function public.list_accessible_alerts_filtered(uuid,integer,integer,text,text,text,text,text),
    public.get_alert_filter_options(uuid),
    public.search_vendor_monitoring(uuid,integer,integer,text,text) to service_role;
