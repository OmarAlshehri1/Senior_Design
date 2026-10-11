-- Include case audit events in the active supervising team's audit scope.
-- Older case events have no team_id in details, so resolve their scope through
-- the authoritative audit_cases.team_id instead of rewriting immutable history.
create or replace function public.list_scoped_audit_events(
    p_actor uuid,p_page integer,p_page_size integer,p_actor_name text default null,p_action text default null,
    p_resource_type text default null,p_outcome text default null,p_date date default null,p_search text default null,p_sort text default 'NEWEST'
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles;
begin
    if p_page<1 or p_page_size<1 or p_page_size>100 or p_sort not in ('NEWEST','OLDEST') then
        raise exception 'Invalid audit-event query' using errcode='22023';
    end if;
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('SUPERVISOR','ADMIN') then raise exception 'Audit access denied' using errcode='42501'; end if;
    if actor.role='SUPERVISOR' and not exists(select 1 from public.audit_teams where supervisor_id=p_actor and is_active) then
        raise exception 'Supervisor team not configured' using errcode='42501';
    end if;
    return (
        with scoped as materialized (
            select e.* from public.audit_events e
            where (actor.role='ADMIN' or e.actor_id=p_actor or exists(
                    select 1 from public.audit_teams t where t.supervisor_id=p_actor and t.is_active
                        and e.details->>'team_id'=t.id::text) or (
                    e.resource_type='CASE' and exists (
                        select 1 from public.audit_cases c
                        join public.audit_teams t on t.id=c.team_id
                        where c.id::text=e.resource_id and t.supervisor_id=p_actor and t.is_active
                    )))
                and (p_actor_name is null or e.actor_name ilike '%'||p_actor_name||'%')
                and (p_action is null or e.action=p_action)
                and (p_resource_type is null or e.resource_type=p_resource_type)
                and (p_outcome is null or e.outcome=p_outcome)
                and (p_date is null or (e.created_at>=p_date::timestamp at time zone 'UTC' and e.created_at<(p_date+1)::timestamp at time zone 'UTC'))
                and (p_search is null or e.actor_name ilike '%'||p_search||'%' or e.action ilike '%'||p_search||'%'
                    or e.resource_type ilike '%'||p_search||'%' or e.resource_id ilike '%'||p_search||'%' or e.details::text ilike '%'||p_search||'%')
        ), page_rows as (
            select * from scoped order by
                case when p_sort='OLDEST' then created_at end asc,
                case when p_sort='NEWEST' then created_at end desc,
                case when p_sort='OLDEST' then id end asc,
                case when p_sort='NEWEST' then id end desc
                limit p_page_size offset (p_page-1)*p_page_size
        )
        select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(e) order by
                case when p_sort='OLDEST' then e.created_at end asc,
                case when p_sort='NEWEST' then e.created_at end desc,
                case when p_sort='OLDEST' then e.id end asc,
                case when p_sort='NEWEST' then e.id end desc) from page_rows e),'[]'::jsonb),
            'total',(select count(*) from scoped),'page',p_page,'page_size',p_page_size)
    );
end;
$$;
