create table public.audit_teams (
    id uuid primary key default gen_random_uuid(),
    name text not null check (length(btrim(name)) between 1 and 120),
    supervisor_id uuid not null references public.user_profiles(id) on delete restrict,
    is_active boolean not null default true,
    created_by uuid not null references public.user_profiles(id) on delete restrict,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp()
);
create unique index audit_teams_active_name_idx on public.audit_teams(lower(name)) where is_active;
create unique index audit_teams_active_supervisor_idx on public.audit_teams(supervisor_id) where is_active;

-- Each account has one current team; membership changes are retained separately.
create table public.audit_team_memberships (
    user_id uuid primary key references public.user_profiles(id) on delete restrict,
    team_id uuid not null references public.audit_teams(id) on delete restrict,
    added_by uuid not null references public.user_profiles(id) on delete restrict,
    added_at timestamptz not null default clock_timestamp()
);
create index audit_team_memberships_team_idx on public.audit_team_memberships(team_id,user_id);

create table public.audit_team_membership_history (
    id bigint generated always as identity primary key,
    user_id uuid not null references public.user_profiles(id) on delete restrict,
    previous_team_id uuid references public.audit_teams(id) on delete restrict,
    new_team_id uuid references public.audit_teams(id) on delete restrict,
    actor_id uuid not null references public.user_profiles(id) on delete restrict,
    actor_name text not null,
    actor_role text not null check (actor_role in ('SUPERVISOR','ADMIN')),
    action text not null check (action in ('ADDED','TRANSFERRED','REMOVED')),
    created_at timestamptz not null default clock_timestamp(),
    constraint audit_team_membership_transition_check check (
        (action='ADDED' and previous_team_id is null and new_team_id is not null)
        or (action='TRANSFERRED' and previous_team_id is not null and new_team_id is not null and previous_team_id<>new_team_id)
        or (action='REMOVED' and previous_team_id is not null and new_team_id is null)
    )
);
create index audit_team_membership_history_user_idx on public.audit_team_membership_history(user_id,created_at desc,id desc);

-- An unassigned row keeps its team queue. A missing row is globally unclaimed.
create table public.alert_assignments (
    alert_id text primary key references public.alerts(id) on delete restrict,
    team_id uuid not null references public.audit_teams(id) on delete restrict,
    assignee_id uuid references public.user_profiles(id) on delete restrict,
    status text not null check (status in ('ASSIGNED','UNASSIGNED')),
    updated_by uuid not null references public.user_profiles(id) on delete restrict,
    updated_at timestamptz not null default clock_timestamp(),
    constraint alert_assignment_state_check check (
        (status='ASSIGNED' and assignee_id is not null)
        or (status='UNASSIGNED' and assignee_id is null)
    )
);
create index alert_assignments_team_idx on public.alert_assignments(team_id,status,updated_at desc);
create index alert_assignments_assignee_idx on public.alert_assignments(assignee_id,updated_at desc) where status='ASSIGNED';

create table public.alert_assignment_history (
    id bigint generated always as identity primary key,
    alert_id text not null references public.alerts(id) on delete restrict,
    team_id uuid not null references public.audit_teams(id) on delete restrict,
    previous_assignee_id uuid references public.user_profiles(id) on delete restrict,
    assignee_id uuid references public.user_profiles(id) on delete restrict,
    actor_id uuid not null references public.user_profiles(id) on delete restrict,
    actor_name text not null,
    actor_role text not null check (actor_role in ('SUPERVISOR','ADMIN')),
    action text not null check (action in ('ASSIGNED','REASSIGNED','UNASSIGNED')),
    note text check (note is null or length(note) between 1 and 2000),
    created_at timestamptz not null default clock_timestamp(),
    constraint alert_assignment_transition_check check (
        (action='ASSIGNED' and previous_assignee_id is null and assignee_id is not null)
        or (action='REASSIGNED' and previous_assignee_id is not null and assignee_id is not null and previous_assignee_id<>assignee_id)
        or (action='UNASSIGNED' and previous_assignee_id is not null and assignee_id is null)
    )
);
create index alert_assignment_history_alert_idx on public.alert_assignment_history(alert_id,created_at desc,id desc);
create index alert_assignment_history_team_idx on public.alert_assignment_history(team_id,created_at desc,id desc);

create function public.prevent_team_history_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
    raise exception 'Team and assignment history is append-only';
end;
$$;
create trigger audit_team_membership_history_immutable before update or delete on public.audit_team_membership_history
    for each row execute function public.prevent_team_history_mutation();
create trigger alert_assignment_history_immutable before update or delete on public.alert_assignment_history
    for each row execute function public.prevent_team_history_mutation();

create function public.can_access_team_alert(p_actor uuid,p_alert_id text)
returns boolean language sql stable security definer set search_path='' as $$
    select exists (
        select 1 from public.user_profiles u
        where u.id=p_actor and u.account_status='ACTIVE' and (
            u.role='ADMIN'
            or (u.role='AUDITOR' and exists (
                select 1 from public.alert_assignments aa
                where aa.alert_id=p_alert_id and aa.status='ASSIGNED' and aa.assignee_id=p_actor
            ))
            or (u.role='SUPERVISOR' and exists (
                select 1 from public.audit_teams t
                where t.supervisor_id=p_actor and t.is_active and (
                    not exists (select 1 from public.alert_assignments aa where aa.alert_id=p_alert_id)
                    or exists (select 1 from public.alert_assignments aa where aa.alert_id=p_alert_id and aa.team_id=t.id)
                )
            ))
        )
    );
$$;

create function public.list_accessible_alerts(p_actor uuid,p_page integer,p_page_size integer,p_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; actor_team uuid;
begin
    if p_page<1 or p_page_size<1 or p_page_size>100 or (p_status is not null and p_status not in ('ACTIVE','REVIEWED')) then
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
            from public.alerts a
            left join public.alert_assignments aa on aa.alert_id=a.id
            left join public.user_profiles p on p.id=aa.assignee_id
            where (p_status is null or a.status=p_status)
                and (actor.role='ADMIN'
                    or (actor.role='AUDITOR' and aa.status='ASSIGNED' and aa.assignee_id=p_actor)
                    or (actor.role='SUPERVISOR' and (aa.alert_id is null or aa.team_id=actor_team)))
        ), page_rows as (
            select * from scoped order by created_at desc,id asc limit p_page_size offset (p_page-1)*p_page_size
        )
        select jsonb_build_object(
            'items',coalesce((select jsonb_agg(
                (to_jsonb(r)-array['assignment_team_id','assignment_assignee_id','assignment_status','assignment_updated_by','assignment_updated_at','assignment_assignee_name'])
                || jsonb_build_object('assignment',case when r.assignment_status is null then null else jsonb_build_object(
                    'alert_id',r.id,'team_id',r.assignment_team_id,'assignee_id',r.assignment_assignee_id,
                    'assignee_name',r.assignment_assignee_name,'assigned_by_id',r.assignment_updated_by,
                    'assigned_at',r.assignment_updated_at,'status',r.assignment_status) end)
                order by r.created_at desc,r.id asc) from page_rows r),'[]'::jsonb),
            'total',(select count(*) from scoped),'page',p_page,'page_size',p_page_size)
    );
end;
$$;

create function public.get_alert_assignment_bundle(p_actor uuid,p_alert_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; current_row jsonb; history_rows jsonb; eligible_rows jsonb;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or not public.can_access_team_alert(p_actor,p_alert_id) then
        raise exception 'Alert access denied' using errcode='42501';
    end if;
    if not exists(select 1 from public.alerts where id=p_alert_id) then raise exception 'Alert not found' using errcode='P0002'; end if;

    select jsonb_build_object('id',aa.alert_id,'alertId',aa.alert_id,'teamId',aa.team_id,'assigneeId',aa.assignee_id,
        'assigneeName',p.name,'assignedById',aa.updated_by,'assignedAt',aa.updated_at,'status',aa.status)
    into current_row
    from public.alert_assignments aa left join public.user_profiles p on p.id=aa.assignee_id where aa.alert_id=p_alert_id;
    select coalesce(jsonb_agg(jsonb_build_object('id',h.id,'alertId',h.alert_id,'teamId',h.team_id,
        'assigneeId',h.assignee_id,'assigneeName',p.name,'assignedById',h.actor_id,'assignedByName',h.actor_name,
        'action',h.action,'status',h.action,'note',h.note,'createdAt',h.created_at) order by h.created_at desc,h.id desc),'[]'::jsonb)
    into history_rows from public.alert_assignment_history h left join public.user_profiles p on p.id=h.assignee_id
    where h.alert_id=p_alert_id;
    if actor.role in ('ADMIN','SUPERVISOR') then
        select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'role',u.role,'teamId',coalesce(m.team_id,t.id)) order by u.name,u.id),'[]'::jsonb)
        into eligible_rows
        from public.user_profiles u
        left join public.audit_team_memberships m on m.user_id=u.id
        left join public.audit_teams t on t.supervisor_id=u.id and t.is_active
        where u.account_status='ACTIVE' and u.role in ('AUDITOR','SUPERVISOR')
            and (actor.role='ADMIN' or coalesce(m.team_id,t.id)=(select id from public.audit_teams where supervisor_id=p_actor and is_active));
    else eligible_rows:='[]'::jsonb; end if;
    return jsonb_build_object('assignment',current_row,'history',history_rows,'eligible_users',eligible_rows);
end;
$$;

create function public.list_audit_teams(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; result jsonb;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('SUPERVISOR','ADMIN') then raise exception 'Team access denied' using errcode='42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'supervisor_id',t.supervisor_id,
        'supervisor_name',u.name,'is_active',t.is_active,'created_at',t.created_at,'updated_at',t.updated_at,
        'member_count',(select count(*) from public.audit_team_memberships m join public.user_profiles p on p.id=m.user_id
            where m.team_id=t.id and p.account_status='ACTIVE')) order by t.name,t.id),'[]'::jsonb)
    into result from public.audit_teams t join public.user_profiles u on u.id=t.supervisor_id
    where actor.role='ADMIN' or (t.supervisor_id=p_actor and t.is_active);
    return result;
end;
$$;

create function public.list_team_member_candidates(p_actor uuid,p_team_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; result jsonb;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('SUPERVISOR','ADMIN') then raise exception 'Team membership denied' using errcode='42501'; end if;
    if not exists(select 1 from public.audit_teams where id=p_team_id and is_active)
       or (actor.role='SUPERVISOR' and not exists(select 1 from public.audit_teams where id=p_team_id and supervisor_id=p_actor and is_active)) then
        raise exception 'Team membership denied' using errcode='42501';
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'role',u.role,'team_id',m.team_id)
        order by u.name,u.id),'[]'::jsonb)
    into result from public.user_profiles u left join public.audit_team_memberships m on m.user_id=u.id
    where u.role='AUDITOR' and u.account_status='ACTIVE'
      and (actor.role='ADMIN' or m.team_id is null or m.team_id=p_team_id);
    return result;
end;
$$;

create function public.get_team_activity(p_actor uuid,p_team_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; team_count integer; result jsonb;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('SUPERVISOR','ADMIN') then raise exception 'Team activity denied' using errcode='42501'; end if;
    if actor.role='SUPERVISOR' and p_team_id is not null
       and not exists(select 1 from public.audit_teams where id=p_team_id and supervisor_id=p_actor and is_active) then
        raise exception 'Cross-team activity denied' using errcode='42501';
    end if;
    if actor.role='SUPERVISOR' and not exists(select 1 from public.audit_teams where supervisor_id=p_actor and is_active) then
        raise exception 'Supervisor team not configured' using errcode='42501';
    end if;
    with team_scope as materialized (
        select t.* from public.audit_teams t
        where t.is_active and (actor.role='ADMIN' or t.supervisor_id=p_actor)
            and (p_team_id is null or t.id=p_team_id)
    ), members as (
        select t.id as team_id,u.id as user_id,u.name,u.role from team_scope t
            join public.user_profiles u on u.id=t.supervisor_id and u.account_status='ACTIVE'
        union all
        select t.id,m.user_id,u.name,u.role from team_scope t
            join public.audit_team_memberships m on m.team_id=t.id
            join public.user_profiles u on u.id=m.user_id and u.account_status='ACTIVE'
    ), workload as (
        select m.team_id,m.user_id,m.name,m.role,
            (select count(*) from public.alert_assignments aa join public.alerts a on a.id=aa.alert_id
                where aa.team_id=m.team_id and aa.assignee_id=m.user_id and aa.status='ASSIGNED' and a.status='ACTIVE') as assigned_alerts,
            (select count(*) from public.alert_assignments aa join public.alerts a on a.id=aa.alert_id
                where aa.team_id=m.team_id and aa.assignee_id=m.user_id and aa.status='ASSIGNED' and a.status='ACTIVE') as open_reviews,
            (select count(*) from public.audit_events e where e.action='ALERT_REVIEWED' and e.actor_id=m.user_id
                and e.details->>'team_id'=m.team_id::text
                and e.created_at>=date_trunc('day',clock_timestamp() at time zone 'utc') at time zone 'utc') as completed_today
        from members m
    ), activity as (
        select e.* from public.audit_events e
        where exists(select 1 from team_scope t where e.details->>'team_id'=t.id::text)
           or (e.resource_type='ALERT' and exists(select 1 from public.alert_assignment_history h join team_scope t on t.id=h.team_id
                where h.alert_id=e.resource_id))
        order by e.created_at desc,e.id desc limit 20
    )
    select jsonb_build_object(
        'teams',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'supervisor_id',supervisor_id) order by name,id) from team_scope),'[]'::jsonb),
        'overview',jsonb_build_object(
            'team_members',(select count(*) from members),
            'active_assignments',(select count(*) from public.alert_assignments aa join team_scope t on t.id=aa.team_id
                join public.alerts a on a.id=aa.alert_id where aa.status='ASSIGNED' and a.status='ACTIVE'),
            'reviews_today',(select count(*) from public.audit_events e where e.action='ALERT_REVIEWED'
                and exists(select 1 from team_scope t where e.details->>'team_id'=t.id::text)
                and e.created_at>=date_trunc('day',clock_timestamp() at time zone 'utc') at time zone 'utc'),
            'open_alerts',(select count(*) from public.alerts a left join public.alert_assignments aa on aa.alert_id=a.id
                where a.status='ACTIVE' and (aa.alert_id is null or exists(select 1 from team_scope t where t.id=aa.team_id)))),
        'workload',coalesce((select jsonb_agg(jsonb_build_object('user_id',user_id,'name',name,'role',role,'team_id',team_id,
            'assigned_alerts',assigned_alerts,'open_reviews',open_reviews,'completed_today',completed_today) order by name,user_id) from workload),'[]'::jsonb),
        'activity',coalesce((select jsonb_agg(jsonb_build_object('id',id,'actor_id',actor_id,'actor_name',actor_name,'actor_role',actor_role,
            'action',action,'resource_type',resource_type,'resource_id',resource_id,'outcome',outcome,'details',details,'created_at',created_at)
            order by created_at desc,id desc) from activity),'[]'::jsonb))
    into result;
    return result;
end;
$$;

create or replace function public.record_review_action(
    p_actor uuid,p_resource_type text,p_resource_id text,p_action text,p_note text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
    u public.user_profiles; t public.transactions; a public.alerts; current_status text;
    mapped_action text; record_row public.review_records; event_team uuid;
begin
    select * into u from public.user_profiles where id=p_actor for share;
    if not found or u.account_status<>'ACTIVE' or u.role not in ('AUDITOR','SUPERVISOR','ADMIN') then
        raise exception 'Review permission denied' using errcode='42501';
    end if;
    if p_resource_type not in ('TRANSACTION','ALERT') or p_action not in ('REVIEWED','REOPENED','NOTE_ADDED') then
        raise exception 'Invalid review action' using errcode='22023';
    end if;
    if p_note is not null and length(p_note)>2000 then raise exception 'Review note is too long' using errcode='22023'; end if;
    if p_action='NOTE_ADDED' and coalesce(length(btrim(p_note)),0)=0 then raise exception 'A review note is required' using errcode='22023'; end if;

    if p_resource_type='TRANSACTION' then
        select * into t from public.transactions where id=p_resource_id for update;
        if not found then raise exception 'Review target not found' using errcode='P0002'; end if;
        select status into current_status from public.transaction_review_states where transaction_id=p_resource_id for update;
        if p_action='REVIEWED' then
            if current_status='REVIEWED' then raise exception 'Review is already complete' using errcode='23505'; end if;
            insert into public.transaction_review_states(transaction_id,status,updated_by,updated_at)
            values(p_resource_id,'REVIEWED',p_actor,clock_timestamp())
            on conflict(transaction_id) do update set status='REVIEWED',updated_by=excluded.updated_by,updated_at=excluded.updated_at;
        elsif p_action='REOPENED' then
            if current_status is distinct from 'REVIEWED' then raise exception 'Review is not complete' using errcode='23505'; end if;
            update public.transaction_review_states set status='ACTIVE',updated_by=p_actor,updated_at=clock_timestamp()
            where transaction_id=p_resource_id;
        end if;
        insert into public.review_records(resource_type,resource_id,transaction_id,actor_id,actor_name,actor_role,action,note)
        values('TRANSACTION',p_resource_id,p_resource_id,p_actor,u.name,u.role,p_action,nullif(btrim(p_note),'')) returning * into record_row;
        mapped_action:=case p_action when 'REVIEWED' then 'TRANSACTION_REVIEWED' when 'REOPENED' then 'TRANSACTION_REOPENED' else 'REVIEW_NOTE_ADDED' end;
    else
        if not public.can_access_team_alert(p_actor,p_resource_id) then raise exception 'Alert review scope denied' using errcode='42501'; end if;
        select * into a from public.alerts where id=p_resource_id for update;
        if not found then raise exception 'Review target not found' using errcode='P0002'; end if;
        current_status:=a.status;
        select team_id into event_team from public.alert_assignments where alert_id=p_resource_id;
        if event_team is null and u.role='SUPERVISOR' then
            select id into event_team from public.audit_teams where supervisor_id=p_actor and is_active;
        end if;
        if p_action='REVIEWED' then
            if current_status='REVIEWED' then raise exception 'Review is already complete' using errcode='23505'; end if;
            update public.alerts set status='REVIEWED',reviewed_at=clock_timestamp() where id=p_resource_id returning * into a;
        elsif p_action='REOPENED' then
            if current_status<>'REVIEWED' then raise exception 'Review is not complete' using errcode='23505'; end if;
            update public.alerts set status='ACTIVE',reviewed_at=null where id=p_resource_id returning * into a;
        end if;
        insert into public.review_records(resource_type,resource_id,transaction_id,alert_id,actor_id,actor_name,actor_role,action,note)
        values('ALERT',p_resource_id,a.transaction_id,p_resource_id,p_actor,u.name,u.role,p_action,nullif(btrim(p_note),'')) returning * into record_row;
        mapped_action:=case p_action when 'REVIEWED' then 'ALERT_REVIEWED' when 'REOPENED' then 'ALERT_REOPENED' else 'REVIEW_NOTE_ADDED' end;
    end if;

    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,u.name,u.role,mapped_action,p_resource_type,p_resource_id,'SUCCESS',
        jsonb_build_object('review_record_id',record_row.id,'action',p_action)
            || case when event_team is null then '{}'::jsonb else jsonb_build_object('team_id',event_team) end);
    if p_resource_type='ALERT' then
        return jsonb_build_object('record',to_jsonb(record_row),'alert',to_jsonb(a));
    end if;
    return jsonb_build_object('record',to_jsonb(record_row),'transaction_review_status',case when p_action='REOPENED' then 'NOT_REVIEWED' else 'REVIEWED' end);
end;
$$;

create function public.list_scoped_review_records(
    p_actor uuid,p_resource_type text,p_resource_id text,p_page integer,p_page_size integer
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles;
begin
    if p_page<1 or p_page_size<1 or p_page_size>100 or p_resource_type not in ('TRANSACTION','ALERT') then
        raise exception 'Invalid review-history query' using errcode='22023';
    end if;
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('AUDITOR','SUPERVISOR','ADMIN') then raise exception 'Review-history access denied' using errcode='42501'; end if;
    if p_resource_type='ALERT' and not public.can_access_team_alert(p_actor,p_resource_id) then
        raise exception 'Alert review scope denied' using errcode='42501';
    end if;
    if p_resource_type='TRANSACTION' and not exists(select 1 from public.transactions where id=p_resource_id) then
        raise exception 'Review target not found' using errcode='P0002';
    end if;
    return (
        with scoped as materialized (select r.* from public.review_records r where r.resource_type=p_resource_type and r.resource_id=p_resource_id),
        page_rows as (select * from scoped order by created_at desc,id desc limit p_page_size offset (p_page-1)*p_page_size)
        select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc,r.id desc) from page_rows r),'[]'::jsonb),
            'total',(select count(*) from scoped),'page',p_page,'page_size',p_page_size)
    );
end;
$$;

create function public.list_scoped_audit_events(
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
                        and e.details->>'team_id'=t.id::text))
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

create function public.manage_audit_team(
    p_actor uuid,p_action text,p_team_id uuid default null,p_name text default null,p_supervisor_id uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; supervisor public.user_profiles; team public.audit_teams;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role<>'ADMIN' then raise exception 'Team administration denied' using errcode='42501'; end if;
    if p_action not in ('CREATE','UPDATE','DEACTIVATE') then raise exception 'Invalid team action' using errcode='22023'; end if;

    if p_action='CREATE' then
        if p_name is null or length(btrim(p_name)) not between 1 and 120 or p_supervisor_id is null then
            raise exception 'Team name and supervisor are required' using errcode='22023';
        end if;
        select * into supervisor from public.user_profiles where id=p_supervisor_id and role='SUPERVISOR' and account_status='ACTIVE' for share;
        if not found then raise exception 'Active supervisor not found' using errcode='P0002'; end if;
        insert into public.audit_teams(name,supervisor_id,created_by)
        values(btrim(p_name),p_supervisor_id,p_actor) returning * into team;
    else
        select * into team from public.audit_teams where id=p_team_id for update;
        if not found then raise exception 'Team not found' using errcode='P0002'; end if;
        if p_action='UPDATE' then
            if p_name is not null and length(btrim(p_name)) not between 1 and 120 then
                raise exception 'Invalid team name' using errcode='22023';
            end if;
            if p_supervisor_id is not null then
                select * into supervisor from public.user_profiles where id=p_supervisor_id and role='SUPERVISOR' and account_status='ACTIVE' for share;
                if not found then raise exception 'Active supervisor not found' using errcode='P0002'; end if;
            end if;
            update public.audit_teams set
                name=coalesce(btrim(p_name),name),supervisor_id=coalesce(p_supervisor_id,supervisor_id),updated_at=clock_timestamp()
            where id=p_team_id returning * into team;
        else
            if not team.is_active then raise exception 'Team already inactive' using errcode='23505'; end if;
            if exists(select 1 from public.audit_team_memberships where team_id=p_team_id)
               or exists(select 1 from public.alert_assignments where team_id=p_team_id) then
                raise exception 'Team must have no members or assignments before deactivation' using errcode='23505';
            end if;
            update public.audit_teams set is_active=false,updated_at=clock_timestamp() where id=p_team_id returning * into team;
        end if;
    end if;

    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,case p_action when 'CREATE' then 'TEAM_CREATED' when 'UPDATE' then 'TEAM_UPDATED' else 'TEAM_DEACTIVATED' end,
        'TEAM',team.id::text,'SUCCESS',jsonb_build_object('team_id',team.id,'team_name',team.name,'supervisor_id',team.supervisor_id));
    return to_jsonb(team);
end;
$$;

create function public.set_audit_team_member(p_actor uuid,p_team_id uuid,p_user_id uuid,p_action text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; member public.user_profiles; team public.audit_teams; current_team uuid; action_name text;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('SUPERVISOR','ADMIN') then raise exception 'Team membership denied' using errcode='42501'; end if;
    if p_action not in ('ADD','TRANSFER','REMOVE') then raise exception 'Invalid membership action' using errcode='22023'; end if;
    select * into team from public.audit_teams where id=p_team_id and is_active for share;
    if not found then raise exception 'Active team not found' using errcode='P0002'; end if;
    if actor.role='SUPERVISOR' and team.supervisor_id<>p_actor then raise exception 'Team membership denied' using errcode='42501'; end if;
    if actor.role='SUPERVISOR' and p_action='TRANSFER' then raise exception 'Only Admin may transfer a member between teams' using errcode='42501'; end if;

    select * into member from public.user_profiles where id=p_user_id for update;
    if not found or member.role<>'AUDITOR' or member.account_status<>'ACTIVE' then
        raise exception 'Active Auditor not found' using errcode='P0002';
    end if;
    select team_id into current_team from public.audit_team_memberships where user_id=p_user_id for update;

    if p_action='ADD' then
        if current_team is not null then raise exception 'Auditor already belongs to a team' using errcode='23505'; end if;
        insert into public.audit_team_memberships(user_id,team_id,added_by) values(p_user_id,p_team_id,p_actor);
        action_name := 'ADDED';
    elsif p_action='TRANSFER' then
        if current_team is null or current_team=p_team_id then raise exception 'Invalid team transfer' using errcode='23505'; end if;
        if exists(select 1 from public.alert_assignments where assignee_id=p_user_id and status='ASSIGNED') then
            raise exception 'Reassign or unassign active alerts before transferring the Auditor' using errcode='23505';
        end if;
        update public.audit_team_memberships set team_id=p_team_id,added_by=p_actor,added_at=clock_timestamp() where user_id=p_user_id;
        action_name := 'TRANSFERRED';
    else
        if current_team is distinct from p_team_id then raise exception 'Auditor is not a member of this team' using errcode='23505'; end if;
        if exists(select 1 from public.alert_assignments where assignee_id=p_user_id and status='ASSIGNED') then
            raise exception 'Reassign or unassign active alerts before removing the Auditor' using errcode='23505';
        end if;
        delete from public.audit_team_memberships where user_id=p_user_id;
        action_name := 'REMOVED';
    end if;

    insert into public.audit_team_membership_history(user_id,previous_team_id,new_team_id,actor_id,actor_name,actor_role,action)
    values(p_user_id,case when action_name in ('TRANSFERRED','REMOVED') then current_team else null end,
        case when action_name in ('ADDED','TRANSFERRED') then p_team_id else null end,p_actor,actor.name,actor.role,action_name);
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,'TEAM_MEMBER_'||action_name,'TEAM_MEMBER',p_user_id::text,'SUCCESS',
        jsonb_build_object('team_id',p_team_id,'user_id',p_user_id,'previous_team_id',current_team));
    return jsonb_build_object('user_id',p_user_id,'team_id',case when p_action='REMOVE' then null else p_team_id end,'action',action_name);
end;
$$;

create function public.record_alert_assignment(p_actor uuid,p_alert_id text,p_action text,p_assignee_id uuid default null,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; target public.user_profiles; alert public.alerts; current_assignment public.alert_assignments;
    actor_team uuid; target_team uuid; previous_assignee uuid; event_team uuid; history_row public.alert_assignment_history;
    has_assignment boolean := false;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('SUPERVISOR','ADMIN') then raise exception 'Assignment denied' using errcode='42501'; end if;
    if p_action not in ('ASSIGNED','REASSIGNED','UNASSIGNED') then raise exception 'Invalid assignment action' using errcode='22023'; end if;
    if p_note is not null and (length(p_note)>2000 or length(btrim(p_note))=0) then raise exception 'Invalid assignment note' using errcode='22023'; end if;
    select * into alert from public.alerts where id=p_alert_id for update;
    if not found then raise exception 'Alert not found' using errcode='P0002'; end if;
    if actor.role='SUPERVISOR' then
        select id into actor_team from public.audit_teams where supervisor_id=p_actor and is_active for share;
        if not found then raise exception 'Supervisor team not configured' using errcode='42501'; end if;
    end if;
    select * into current_assignment from public.alert_assignments where alert_id=p_alert_id for update;
    has_assignment:=found;
    if has_assignment then event_team:=current_assignment.team_id; previous_assignee:=current_assignment.assignee_id; end if;

    if p_action='UNASSIGNED' then
        if not has_assignment or current_assignment.status<>'ASSIGNED' then raise exception 'Alert is not assigned' using errcode='23505'; end if;
        if actor.role='SUPERVISOR' and current_assignment.team_id<>actor_team then raise exception 'Cross-team assignment denied' using errcode='42501'; end if;
        target_team:=current_assignment.team_id;
    else
        if p_assignee_id is null then raise exception 'Assignee is required' using errcode='22023'; end if;
        select * into target from public.user_profiles where id=p_assignee_id and account_status='ACTIVE' for share;
        if not found or target.role not in ('AUDITOR','SUPERVISOR') then raise exception 'Active Auditor or Supervisor not found' using errcode='P0002'; end if;
        if target.role='SUPERVISOR' then
            select id into target_team from public.audit_teams where supervisor_id=p_assignee_id and is_active for share;
        else
            select m.team_id into target_team from public.audit_team_memberships m join public.audit_teams t on t.id=m.team_id
            where m.user_id=p_assignee_id and t.is_active for share of m,t;
        end if;
        if target_team is null then raise exception 'Assignee has no active team' using errcode='42501'; end if;
        if actor.role='SUPERVISOR' and target_team<>actor_team then raise exception 'Cross-team assignment denied' using errcode='42501'; end if;

        if p_action='ASSIGNED' then
            if actor.role='SUPERVISOR' and has_assignment and current_assignment.team_id<>actor_team then
                raise exception 'Cross-team assignment denied' using errcode='42501';
            end if;
            if has_assignment and current_assignment.status='ASSIGNED' then raise exception 'Alert is already assigned; use REASSIGNED' using errcode='23505'; end if;
            if not has_assignment and alert.status<>'ACTIVE' then raise exception 'Only active alerts can be assigned' using errcode='23505'; end if;
            if has_assignment then
                update public.alert_assignments set team_id=target_team,assignee_id=p_assignee_id,status='ASSIGNED',updated_by=p_actor,updated_at=clock_timestamp()
                where alert_id=p_alert_id returning * into current_assignment;
            else
                insert into public.alert_assignments(alert_id,team_id,assignee_id,status,updated_by)
                values(p_alert_id,target_team,p_assignee_id,'ASSIGNED',p_actor) returning * into current_assignment;
            end if;
        else
            if not has_assignment or current_assignment.status<>'ASSIGNED' then raise exception 'Alert is not assigned; use ASSIGNED' using errcode='23505'; end if;
            if previous_assignee=p_assignee_id then raise exception 'Alert is already assigned to this user' using errcode='23505'; end if;
            if actor.role='SUPERVISOR' and current_assignment.team_id<>actor_team then raise exception 'Cross-team assignment denied' using errcode='42501'; end if;
            update public.alert_assignments set team_id=target_team,assignee_id=p_assignee_id,updated_by=p_actor,updated_at=clock_timestamp()
            where alert_id=p_alert_id returning * into current_assignment;
        end if;
        event_team:=target_team;
    end if;

    insert into public.alert_assignment_history(alert_id,team_id,previous_assignee_id,assignee_id,actor_id,actor_name,actor_role,action,note)
    values(p_alert_id,event_team,previous_assignee,p_assignee_id,p_actor,actor.name,actor.role,p_action,nullif(btrim(p_note),''))
    returning * into history_row;
    if p_action='UNASSIGNED' then
        update public.alert_assignments set assignee_id=null,status='UNASSIGNED',updated_by=p_actor,updated_at=clock_timestamp()
        where alert_id=p_alert_id returning * into current_assignment;
    end if;
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,'ALERT_'||p_action,'ALERT',p_alert_id,'SUCCESS',
        jsonb_build_object('team_id',event_team,'assignment_history_id',history_row.id,'assignee_id',p_assignee_id));
    return jsonb_build_object('assignment',to_jsonb(current_assignment),'history',to_jsonb(history_row));
end;
$$;

alter table public.audit_teams enable row level security;
alter table public.audit_team_memberships enable row level security;
alter table public.audit_team_membership_history enable row level security;
alter table public.alert_assignments enable row level security;
alter table public.alert_assignment_history enable row level security;
revoke all on public.audit_teams,public.audit_team_memberships,public.audit_team_membership_history,
    public.alert_assignments,public.alert_assignment_history from anon,authenticated;
grant select on public.audit_teams,public.audit_team_memberships,public.audit_team_membership_history,
    public.alert_assignments,public.alert_assignment_history to service_role;
revoke insert,update,delete on public.audit_teams,public.audit_team_memberships,public.audit_team_membership_history,
    public.alert_assignments,public.alert_assignment_history from service_role;
revoke all on function public.prevent_team_history_mutation() from public,anon,authenticated;
revoke all on function public.can_access_team_alert(uuid,text),
    public.list_accessible_alerts(uuid,integer,integer,text),
    public.get_alert_assignment_bundle(uuid,text),
    public.list_audit_teams(uuid),
    public.list_team_member_candidates(uuid,uuid),
    public.get_team_activity(uuid,uuid),
    public.record_review_action(uuid,text,text,text,text),
    public.list_scoped_review_records(uuid,text,text,integer,integer),
    public.list_scoped_audit_events(uuid,integer,integer,text,text,text,text,date,text,text),
    public.manage_audit_team(uuid,text,uuid,text,uuid),
    public.set_audit_team_member(uuid,uuid,uuid,text),
    public.record_alert_assignment(uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.can_access_team_alert(uuid,text),
    public.list_accessible_alerts(uuid,integer,integer,text),
    public.get_alert_assignment_bundle(uuid,text),
    public.list_audit_teams(uuid),
    public.list_team_member_candidates(uuid,uuid),
    public.get_team_activity(uuid,uuid),
    public.record_review_action(uuid,text,text,text,text),
    public.list_scoped_review_records(uuid,text,text,integer,integer),
    public.list_scoped_audit_events(uuid,integer,integer,text,text,text,text,date,text,text),
    public.manage_audit_team(uuid,text,uuid,text,uuid),
    public.set_audit_team_member(uuid,uuid,uuid,text),
    public.record_alert_assignment(uuid,text,text,uuid,text) to service_role;
