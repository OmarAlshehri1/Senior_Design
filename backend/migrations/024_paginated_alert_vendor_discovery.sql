drop function if exists public.list_accessible_alerts(uuid,integer,integer,text);

create function public.list_accessible_alerts(
    p_actor uuid,
    p_page integer,
    p_page_size integer,
    p_status text default null,
    p_search text default null,
    p_severity text default null,
    p_alert_type text default null,
    p_sort text default 'newest'
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; actor_team uuid;
begin
    if p_page<1 or p_page_size<1 or p_page_size>100
       or (p_status is not null and p_status not in ('ACTIVE','REVIEWED'))
       or (p_severity is not null and p_severity not in ('MEDIUM','HIGH'))
       or p_sort not in ('newest','oldest','highest-risk','lowest-risk') then
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
            select a.*,tx.vendor_name,
                aa.team_id as assignment_team_id,aa.assignee_id as assignment_assignee_id,
                aa.status as assignment_status,aa.updated_by as assignment_updated_by,
                aa.updated_at as assignment_updated_at,p.name as assignment_assignee_name
            from public.alerts a
            join public.transactions tx on tx.id=a.transaction_id
            left join public.alert_assignments aa on aa.alert_id=a.id
            left join public.user_profiles p on p.id=aa.assignee_id
            where (p_status is null or a.status=p_status)
              and (p_severity is null or a.severity=p_severity)
              and (nullif(btrim(p_alert_type),'') is null or a.title ilike '%'||btrim(p_alert_type)||'%')
              and (nullif(btrim(p_search),'') is null or a.id ilike '%'||btrim(p_search)||'%'
                   or a.transaction_id ilike '%'||btrim(p_search)||'%'
                   or tx.vendor_name ilike '%'||btrim(p_search)||'%'
                   or a.title ilike '%'||btrim(p_search)||'%')
              and (actor.role='ADMIN'
                  or (actor.role='AUDITOR' and aa.status='ASSIGNED' and aa.assignee_id=p_actor)
                  or (actor.role='SUPERVISOR' and (aa.alert_id is null or aa.team_id=actor_team)))
        ), page_rows as (
            select * from scoped order by
              case when p_sort='newest' then created_at end desc,
              case when p_sort='oldest' then created_at end asc,
              case when p_sort='highest-risk' then risk_score end desc nulls last,
              case when p_sort='lowest-risk' then risk_score end asc nulls last,
              created_at desc,id asc
            limit p_page_size offset (p_page-1)*p_page_size
        )
        select jsonb_build_object(
            'items',coalesce((select jsonb_agg(
                (to_jsonb(r)-array['assignment_team_id','assignment_assignee_id','assignment_status','assignment_updated_by','assignment_updated_at','assignment_assignee_name'])
                || jsonb_build_object('assignment',case when r.assignment_status is null then null else jsonb_build_object(
                    'alert_id',r.id,'team_id',r.assignment_team_id,'assignee_id',r.assignment_assignee_id,
                    'assignee_name',r.assignment_assignee_name,'assigned_by_id',r.assignment_updated_by,
                    'assigned_at',r.assignment_updated_at,'status',r.assignment_status) end)
                order by
                  case when p_sort='newest' then r.created_at end desc,
                  case when p_sort='oldest' then r.created_at end asc,
                  case when p_sort='highest-risk' then r.risk_score end desc nulls last,
                  case when p_sort='lowest-risk' then r.risk_score end asc nulls last,
                  r.created_at desc,r.id asc) from page_rows r),'[]'::jsonb),
            'total',(select count(*) from scoped),'page',p_page,'page_size',p_page_size)
    );
end;
$$;

drop function if exists public.list_vendor_monitoring(uuid,integer,integer,text);

create function public.list_vendor_monitoring(
    p_actor uuid,
    p_page integer default 1,
    p_page_size integer default 25,
    p_status text default null,
    p_search text default null,
    p_risk text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.user_profiles; items jsonb; total bigint;
begin
    select * into profile from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found or profile.role not in ('AUDITOR','SUPERVISOR','ADMIN') then
        raise exception 'Active account required' using errcode='42501';
    end if;
    if p_page<1 or p_page_size<1 or p_page_size>100
       or (p_status is not null and p_status not in ('NORMAL','WATCHLISTED','BLOCKED'))
       or (p_risk is not null and p_risk not in ('LOW','MEDIUM','HIGH')) then
        raise exception 'Invalid vendor query' using errcode='22023';
    end if;

    with vendor_rows as materialized (
        select v.vendor_name,v.vendor_id,v.id,v.monitoring_status,
          coalesce(r.risk_level,'LOW') risk_level,r.average_score,
          coalesce(t.tx_count,0) tx_count,coalesce(t.tx_total,0) tx_total,
          coalesce(a.alert_count,0) alert_count,coalesce(c.case_count,0) case_count,
          coalesce(r.violation_count,0) violation_count
        from public.approved_vendors v
        left join lateral (select count(*) tx_count,coalesce(sum(amount),0) tx_total from public.transactions tx where (v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name)))) t on true
        left join lateral (select count(*) alert_count from public.alerts al join public.transactions tx on tx.id=al.transaction_id where al.status='ACTIVE' and (profile.role='ADMIN' or public.can_access_team_alert(p_actor,al.id)) and ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) a on true
        left join lateral (select count(*) case_count from public.audit_cases ca join public.transactions tx on tx.id=ca.transaction_id where ca.status not in ('CLOSED','RESOLVED') and public.can_access_case(p_actor,ca.id) and ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) c on true
        left join lateral (select avg(latest.risk_score)::numeric(5,2) average_score,(array_agg(latest.risk_level order by latest.calculated_at desc))[1] risk_level,count(*) filter(where latest.risk_level in ('HIGH','MEDIUM')) violation_count from public.transactions tx join lateral (select rs.risk_score,rs.risk_level,rs.calculated_at from public.transaction_risk_scores rs where rs.transaction_id=tx.id order by rs.calculated_at desc,rs.id desc limit 1) latest on true where ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) r on true
    ), filtered as materialized (
        select * from vendor_rows
        where (p_status is null or monitoring_status=p_status)
          and (p_risk is null or risk_level=p_risk)
          and (nullif(btrim(p_search),'') is null or vendor_name ilike '%'||btrim(p_search)||'%'
               or vendor_id ilike '%'||btrim(p_search)||'%' or id::text ilike '%'||btrim(p_search)||'%')
    ), page_rows as (
        select * from filtered order by vendor_name,id limit p_page_size offset ((p_page-1)*p_page_size)
    )
    select count(*) into total from filtered;

    with vendor_rows as materialized (
        select v.vendor_name,v.vendor_id,v.id,v.monitoring_status,
          coalesce(r.risk_level,'LOW') risk_level,r.average_score,
          coalesce(t.tx_count,0) tx_count,coalesce(t.tx_total,0) tx_total,
          coalesce(a.alert_count,0) alert_count,coalesce(c.case_count,0) case_count,
          coalesce(r.violation_count,0) violation_count
        from public.approved_vendors v
        left join lateral (select count(*) tx_count,coalesce(sum(amount),0) tx_total from public.transactions tx where (v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name)))) t on true
        left join lateral (select count(*) alert_count from public.alerts al join public.transactions tx on tx.id=al.transaction_id where al.status='ACTIVE' and (profile.role='ADMIN' or public.can_access_team_alert(p_actor,al.id)) and ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) a on true
        left join lateral (select count(*) case_count from public.audit_cases ca join public.transactions tx on tx.id=ca.transaction_id where ca.status not in ('CLOSED','RESOLVED') and public.can_access_case(p_actor,ca.id) and ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) c on true
        left join lateral (select avg(latest.risk_score)::numeric(5,2) average_score,(array_agg(latest.risk_level order by latest.calculated_at desc))[1] risk_level,count(*) filter(where latest.risk_level in ('HIGH','MEDIUM')) violation_count from public.transactions tx join lateral (select rs.risk_score,rs.risk_level,rs.calculated_at from public.transaction_risk_scores rs where rs.transaction_id=tx.id order by rs.calculated_at desc,rs.id desc limit 1) latest on true where ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) r on true
    ), filtered as materialized (
        select * from vendor_rows where (p_status is null or monitoring_status=p_status)
          and (p_risk is null or risk_level=p_risk)
          and (nullif(btrim(p_search),'') is null or vendor_name ilike '%'||btrim(p_search)||'%'
               or vendor_id ilike '%'||btrim(p_search)||'%' or id::text ilike '%'||btrim(p_search)||'%')
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',coalesce(vendor_id,id::text),'vendorId',vendor_id,'name',vendor_name,
      'monitoringStatus',monitoring_status,'riskLevel',risk_level,'averageRiskScore',average_score,
      'transactionCount',tx_count,'totalTransactionValue',tx_total,'activeAlerts',alert_count,
      'openCases',case_count,'ruleViolations',violation_count) order by vendor_name,id),'[]'::jsonb)
    into items from (select * from filtered order by vendor_name,id limit p_page_size offset ((p_page-1)*p_page_size)) page_rows;

    return jsonb_build_object('items',items,'total',total,'page',p_page,'page_size',p_page_size);
end;
$$;

revoke all on function public.list_accessible_alerts(uuid,integer,integer,text,text,text,text,text),
    public.list_vendor_monitoring(uuid,integer,integer,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.list_accessible_alerts(uuid,integer,integer,text,text,text,text,text),
    public.list_vendor_monitoring(uuid,integer,integer,text,text,text) to service_role;
