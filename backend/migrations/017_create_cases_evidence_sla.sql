create table public.case_sla_policies (
    priority text primary key check (priority in ('LOW','MEDIUM','HIGH','CRITICAL')),
    target_hours integer not null check (target_hours between 1 and 8760),
    updated_at timestamptz not null default clock_timestamp()
);
insert into public.case_sla_policies(priority,target_hours) values
    ('LOW',72),('MEDIUM',48),('HIGH',24),('CRITICAL',8);

create table public.audit_cases (
    id uuid primary key default gen_random_uuid(),
    case_number bigint generated always as identity unique,
    title text not null check (length(btrim(title)) between 1 and 200),
    description text not null check (length(btrim(description)) between 1 and 5000),
    status text not null default 'OPEN' check (status in (
        'OPEN','INVESTIGATING','ESCALATED','RESOLUTION_REQUESTED','RESOLVED','CLOSED'
    )),
    priority text not null check (priority in ('LOW','MEDIUM','HIGH','CRITICAL')),
    department text check (department is null or length(btrim(department)) between 1 and 120),
    source_type text not null check (source_type in ('ALERT','TRANSACTION')),
    source_id text not null check (length(btrim(source_id)) between 1 and 200),
    alert_id text references public.alerts(id) on delete restrict,
    transaction_id text not null references public.transactions(id) on delete restrict,
    team_id uuid references public.audit_teams(id) on delete restrict,
    assigned_to uuid not null references public.user_profiles(id) on delete restrict,
    created_by uuid not null references public.user_profiles(id) on delete restrict,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    sla_target_hours integer not null check (sla_target_hours between 1 and 8760),
    sla_due_at timestamptz not null,
    sla_status text not null default 'ON_TRACK' check (sla_status in ('ON_TRACK','DUE_SOON','OVERDUE','COMPLETED')),
    sla_overdue_at timestamptz,
    resolution_outcome text check (resolution_outcome in ('NO_ISSUE_FOUND','ISSUE_CONFIRMED','FALSE_POSITIVE','NEEDS_INVESTIGATION')),
    resolution_note text check (resolution_note is null or length(btrim(resolution_note)) between 1 and 4000),
    evidence_summary text check (evidence_summary is null or length(btrim(evidence_summary)) between 1 and 2000),
    closure_requested_by uuid references public.user_profiles(id) on delete restrict,
    closure_requested_at timestamptz,
    closure_decided_by uuid references public.user_profiles(id) on delete restrict,
    closure_decided_at timestamptz,
    closure_decision text check (closure_decision in ('APPROVED','REJECTED')),
    closure_decision_note text check (closure_decision_note is null or length(btrim(closure_decision_note)) between 1 and 2000),
    closed_at timestamptz,
    constraint audit_case_source_check check (
        (source_type='ALERT' and alert_id=source_id)
        or (source_type='TRANSACTION' and alert_id is null and transaction_id=source_id)
    ),
    constraint audit_case_closure_state_check check (
        (status='RESOLUTION_REQUESTED' and closure_requested_by is not null and closure_requested_at is not null)
        or status<>'RESOLUTION_REQUESTED'
    ),
    constraint audit_case_closed_state_check check (
        (status='CLOSED' and closed_at is not null and closure_decision='APPROVED')
        or status<>'CLOSED'
    )
);
create index audit_cases_scope_idx on public.audit_cases(team_id,status,updated_at desc,id desc);
create index audit_cases_assignee_idx on public.audit_cases(assigned_to,status,updated_at desc,id desc);
create index audit_cases_sla_idx on public.audit_cases(sla_due_at,id) where sla_status in ('ON_TRACK','DUE_SOON') and status<>'CLOSED';
create index audit_cases_source_idx on public.audit_cases(source_type,source_id,created_at desc);

create table public.case_assignment_history (
    id bigint generated always as identity primary key,
    case_id uuid not null references public.audit_cases(id) on delete restrict,
    previous_assignee_id uuid references public.user_profiles(id) on delete restrict,
    assignee_id uuid not null references public.user_profiles(id) on delete restrict,
    team_id uuid references public.audit_teams(id) on delete restrict,
    actor_id uuid not null references public.user_profiles(id) on delete restrict,
    actor_name text not null,
    actor_role text not null check (actor_role in ('AUDITOR','SUPERVISOR','ADMIN')),
    action text not null check (action in ('ASSIGNED','REASSIGNED')),
    note text check (note is null or length(btrim(note)) between 1 and 2000),
    created_at timestamptz not null default clock_timestamp(),
    constraint case_assignment_transition_check check (
        (action='ASSIGNED' and previous_assignee_id is null)
        or (action='REASSIGNED' and previous_assignee_id is not null and previous_assignee_id<>assignee_id)
    )
);
create index case_assignment_history_idx on public.case_assignment_history(case_id,created_at desc,id desc);

create table public.case_activity (
    id bigint generated always as identity primary key,
    case_id uuid not null references public.audit_cases(id) on delete restrict,
    actor_id uuid references public.user_profiles(id) on delete restrict,
    actor_name text not null,
    actor_role text not null check (actor_role in ('AUDITOR','SUPERVISOR','ADMIN','SYSTEM')),
    action text not null check (action in (
        'CASE_CREATED','CASE_ASSIGNED','CASE_REASSIGNED','CASE_STATUS_CHANGED','CASE_ESCALATED',
        'CASE_COMMENT_ADDED','EVIDENCE_ADDED','EVIDENCE_REJECTED','CASE_CLOSURE_REQUESTED',
        'CASE_CLOSURE_APPROVED','CASE_CLOSURE_REJECTED','SLA_OVERDUE'
    )),
    details jsonb not null default '{}'::jsonb check (jsonb_typeof(details)='object'),
    created_at timestamptz not null default clock_timestamp()
);
create index case_activity_case_idx on public.case_activity(case_id,created_at desc,id desc);

create table public.case_comments (
    id bigint generated always as identity primary key,
    case_id uuid not null references public.audit_cases(id) on delete restrict,
    author_id uuid not null references public.user_profiles(id) on delete restrict,
    author_name text not null,
    author_role text not null check (author_role in ('AUDITOR','SUPERVISOR','ADMIN')),
    message text not null check (length(btrim(message)) between 1 and 4000),
    created_at timestamptz not null default clock_timestamp()
);
create index case_comments_case_idx on public.case_comments(case_id,created_at,id);

create table public.case_evidence (
    id uuid primary key default gen_random_uuid(),
    case_id uuid not null references public.audit_cases(id) on delete restrict,
    file_name text not null check (length(file_name) between 1 and 240),
    file_size bigint not null check (file_size between 1 and 10485760),
    mime_type text not null check (mime_type in ('application/pdf','image/png','image/jpeg')),
    category text not null check (category in ('DOCUMENT','SCREENSHOT','INVOICE','APPROVAL_RECORD','OTHER')),
    description text check (description is null or length(btrim(description)) between 1 and 1000),
    storage_key text not null unique check (length(storage_key) between 1 and 500),
    scan_status text not null check (scan_status='CLEAN'),
    uploaded_by uuid not null references public.user_profiles(id) on delete restrict,
    uploaded_at timestamptz not null default clock_timestamp()
);
create index case_evidence_case_idx on public.case_evidence(case_id,uploaded_at desc,id desc);

create function public.prevent_case_history_mutation()
returns trigger language plpgsql set search_path='' as $$
begin
    raise exception 'Case history is append-only';
end;
$$;
create trigger case_assignment_history_immutable before update or delete on public.case_assignment_history
    for each row execute function public.prevent_case_history_mutation();
create trigger case_activity_immutable before update or delete on public.case_activity
    for each row execute function public.prevent_case_history_mutation();
create trigger case_comments_immutable before update or delete on public.case_comments
    for each row execute function public.prevent_case_history_mutation();
create trigger case_evidence_immutable before update or delete on public.case_evidence
    for each row execute function public.prevent_case_history_mutation();

create function public.can_access_case(p_actor uuid,p_case uuid)
returns boolean language sql stable security definer set search_path='' as $$
    select exists (
        select 1 from public.user_profiles u join public.audit_cases c on c.id=p_case
        where u.id=p_actor and u.account_status='ACTIVE' and (
            u.role='ADMIN'
            or (u.role='AUDITOR' and c.assigned_to=p_actor)
            or (u.role='SUPERVISOR' and exists (
                select 1 from public.audit_teams t where t.id=c.team_id and t.supervisor_id=p_actor and t.is_active
            ))
        )
    );
$$;

create function public.list_cases(
    p_actor uuid,p_page integer default 1,p_page_size integer default 25,
    p_status text default null,p_priority text default null,p_search text default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; team uuid; result_items jsonb; result_total bigint;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found then raise exception 'Active account required' using errcode='42501'; end if;
    if actor.role not in ('AUDITOR','SUPERVISOR','ADMIN') then raise exception 'Case access denied' using errcode='42501'; end if;
    if p_page<1 or p_page_size<1 or p_page_size>100
       or (p_status is not null and p_status not in ('OPEN','INVESTIGATING','ESCALATED','RESOLUTION_REQUESTED','RESOLVED','CLOSED'))
       or (p_priority is not null and p_priority not in ('LOW','MEDIUM','HIGH','CRITICAL'))
       or (p_search is not null and length(p_search)>100) then
        raise exception 'Invalid case query' using errcode='22023';
    end if;
    if actor.role='SUPERVISOR' then
        select id into team from public.audit_teams where supervisor_id=p_actor and is_active;
        if not found then raise exception 'Supervisor team not configured' using errcode='42501'; end if;
    end if;
    with scoped as materialized (
        select c.*,p.name as assigned_to_name,creator.name as created_by_name
        from public.audit_cases c
        join public.user_profiles p on p.id=c.assigned_to
        join public.user_profiles creator on creator.id=c.created_by
        where (actor.role='ADMIN' or (actor.role='AUDITOR' and c.assigned_to=p_actor)
            or (actor.role='SUPERVISOR' and c.team_id=team))
            and (p_status is null or c.status=p_status)
            and (p_priority is null or c.priority=p_priority)
            and (p_search is null or c.title ilike '%'||p_search||'%' or c.case_number::text ilike '%'||p_search||'%'
                or ('CASE-'||lpad(c.case_number::text,6,'0')) ilike '%'||p_search||'%'
                or c.transaction_id ilike '%'||p_search||'%' or coalesce(c.alert_id,'') ilike '%'||p_search||'%')
    )
    select count(*) into result_total from scoped;
    with scoped as materialized (
        select c.*,p.name as assigned_to_name,creator.name as created_by_name
        from public.audit_cases c
        join public.user_profiles p on p.id=c.assigned_to
        join public.user_profiles creator on creator.id=c.created_by
        where (actor.role='ADMIN' or (actor.role='AUDITOR' and c.assigned_to=p_actor)
            or (actor.role='SUPERVISOR' and c.team_id=team))
            and (p_status is null or c.status=p_status)
            and (p_priority is null or c.priority=p_priority)
            and (p_search is null or c.title ilike '%'||p_search||'%' or c.case_number::text ilike '%'||p_search||'%'
                or ('CASE-'||lpad(c.case_number::text,6,'0')) ilike '%'||p_search||'%'
                or c.transaction_id ilike '%'||p_search||'%' or coalesce(c.alert_id,'') ilike '%'||p_search||'%')
    )
    select coalesce(jsonb_agg(to_jsonb(row) order by row.updated_at desc,row.case_number desc),'[]'::jsonb)
    into result_items from (select * from scoped order by updated_at desc,case_number desc limit p_page_size offset (p_page-1)*p_page_size) row;
    return jsonb_build_object('items',result_items,'total',result_total,'page',p_page,'page_size',p_page_size);
end;
$$;

create function public.get_case_bundle(p_actor uuid,p_case uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare case_row public.audit_cases; actor public.user_profiles; assigned_name text; creator_name text;
    closure_requester_name text; closure_decider_name text; actor_team uuid;
    activity_rows jsonb; comment_rows jsonb; evidence_rows jsonb; assignment_rows jsonb; eligible_rows jsonb:='[]'::jsonb;
begin
    if not public.can_access_case(p_actor,p_case) then raise exception 'Case access denied' using errcode='42501'; end if;
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE';
    select * into case_row from public.audit_cases where id=p_case;
    select name into assigned_name from public.user_profiles where id=case_row.assigned_to;
    select name into creator_name from public.user_profiles where id=case_row.created_by;
    select name into closure_requester_name from public.user_profiles where id=case_row.closure_requested_by;
    select name into closure_decider_name from public.user_profiles where id=case_row.closure_decided_by;
    if actor.role='ADMIN' then
        select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'role',u.role,'team_id',coalesce(m.team_id,t.id)) order by u.name,u.id),'[]'::jsonb)
          into eligible_rows from public.user_profiles u
          left join public.audit_team_memberships m on m.user_id=u.id
          left join public.audit_teams t on t.supervisor_id=u.id and t.is_active
          where u.account_status='ACTIVE' and u.role in ('AUDITOR','SUPERVISOR');
    elsif actor.role='SUPERVISOR' then
        actor_team:=case_row.team_id;
        select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.name,'role',u.role,'team_id',actor_team) order by u.name,u.id),'[]'::jsonb)
          into eligible_rows from public.user_profiles u
          left join public.audit_team_memberships m on m.user_id=u.id
          where u.account_status='ACTIVE' and u.role in ('AUDITOR','SUPERVISOR')
            and (u.id=(select supervisor_id from public.audit_teams where id=actor_team)
                or (m.team_id=actor_team and u.role='AUDITOR'));
    end if;
    select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at,a.id),'[]'::jsonb) into activity_rows from public.case_activity a where a.case_id=p_case;
    select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at,c.id),'[]'::jsonb) into comment_rows from public.case_comments c where c.case_id=p_case;
    select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'case_id',e.case_id,'file_name',e.file_name,
        'file_size',e.file_size,'mime_type',e.mime_type,'category',e.category,'description',e.description,
        'scan_status',e.scan_status,'uploaded_by',e.uploaded_by,'uploaded_at',e.uploaded_at)
        order by e.uploaded_at desc,e.id desc),'[]'::jsonb) into evidence_rows from public.case_evidence e where e.case_id=p_case;
    select coalesce(jsonb_agg(to_jsonb(h)||jsonb_build_object('assignee_name',assignee.name,'previous_assignee_name',previous.name)
        order by h.created_at desc,h.id desc),'[]'::jsonb) into assignment_rows
      from public.case_assignment_history h
      join public.user_profiles assignee on assignee.id=h.assignee_id
      left join public.user_profiles previous on previous.id=h.previous_assignee_id where h.case_id=p_case;
    return jsonb_build_object('case',to_jsonb(case_row)||jsonb_build_object('assigned_to_name',assigned_name,'created_by_name',creator_name,
            'closure_requested_by_name',closure_requester_name,'closure_decided_by_name',closure_decider_name),
        'activity',activity_rows,'comments',comment_rows,'evidence',evidence_rows,'assignment_history',assignment_rows,
        'eligible_users',eligible_rows);
end;
$$;

create function public.create_case(
    p_actor uuid,p_source_type text,p_source_id text,p_title text,p_description text,
    p_priority text,p_department text default null,p_assigned_to uuid default null
) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; target public.user_profiles; source_transaction text; source_alert text;
    target_team uuid; case_team uuid; sla_hours integer; created public.audit_cases; supervisor uuid;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('AUDITOR','SUPERVISOR','ADMIN') then raise exception 'Case creation denied' using errcode='42501'; end if;
    if p_title is null or length(btrim(p_title)) not between 1 and 200 or p_description is null or length(btrim(p_description)) not between 1 and 5000
        or p_priority not in ('LOW','MEDIUM','HIGH','CRITICAL') or (p_department is not null and length(btrim(p_department)) not between 1 and 120)
        or p_source_id is null or length(btrim(p_source_id)) not between 1 and 200 then raise exception 'Invalid case payload' using errcode='22023'; end if;
    if p_source_type='ALERT' then
        select a.transaction_id into source_transaction from public.alerts a where a.id=p_source_id;
        if not found then raise exception 'Alert not found' using errcode='P0002'; end if;
        if not public.can_access_team_alert(p_actor,p_source_id) then raise exception 'Source alert access denied' using errcode='42501'; end if;
        source_alert:=p_source_id;
        select team_id into case_team from public.alert_assignments where alert_id=p_source_id and status='ASSIGNED';
    elsif p_source_type='TRANSACTION' then
        if not exists(select 1 from public.transactions where id=p_source_id) then raise exception 'Transaction not found' using errcode='P0002'; end if;
        source_transaction:=p_source_id;
    else raise exception 'Invalid case source' using errcode='22023';
    end if;
    if actor.role='SUPERVISOR' then
        select id into target_team from public.audit_teams where supervisor_id=p_actor and is_active;
        if not found then raise exception 'Supervisor team not configured' using errcode='42501'; end if;
    elsif actor.role='AUDITOR' then
        select m.team_id into target_team from public.audit_team_memberships m join public.audit_teams t on t.id=m.team_id
          where m.user_id=p_actor and t.is_active;
        if not found then raise exception 'Auditor team not configured' using errcode='42501'; end if;
    end if;
    if case_team is null then case_team:=target_team; end if;
    if p_assigned_to is null then p_assigned_to:=p_actor; end if;
    select * into target from public.user_profiles where id=p_assigned_to and account_status='ACTIVE' for share;
    if not found then raise exception 'Active case assignee not found' using errcode='P0002'; end if;
    if actor.role='AUDITOR' and target.id<>p_actor then raise exception 'Only Supervisor/Admin may assign a case' using errcode='42501'; end if;
    if target.role in ('AUDITOR','SUPERVISOR') then
        if target.role='SUPERVISOR' then select id into target_team from public.audit_teams where supervisor_id=target.id and is_active;
        else select m.team_id into target_team from public.audit_team_memberships m join public.audit_teams t on t.id=m.team_id where m.user_id=target.id and t.is_active; end if;
        if target_team is null then raise exception 'Assignee has no active team' using errcode='42501'; end if;
        if actor.role='SUPERVISOR' and target_team<>(select id from public.audit_teams where supervisor_id=p_actor and is_active) then raise exception 'Cross-team case assignment denied' using errcode='42501'; end if;
        case_team:=target_team;
    elsif target.role<>'ADMIN' or actor.role<>'ADMIN' then raise exception 'Case assignee role denied' using errcode='42501';
    end if;
    select target_hours into sla_hours from public.case_sla_policies where priority=p_priority;
    insert into public.audit_cases(title,description,priority,department,source_type,source_id,alert_id,transaction_id,team_id,assigned_to,created_by,sla_target_hours,sla_due_at)
    values(btrim(p_title),btrim(p_description),p_priority,nullif(btrim(p_department),''),p_source_type,p_source_id,source_alert,source_transaction,case_team,p_assigned_to,p_actor,sla_hours,
        clock_timestamp()+make_interval(hours=>sla_hours)) returning * into created;
    insert into public.case_assignment_history(case_id,assignee_id,team_id,actor_id,actor_name,actor_role,action)
    values(created.id,p_assigned_to,case_team,p_actor,actor.name,actor.role,'ASSIGNED');
    insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
    values(created.id,p_actor,actor.name,actor.role,'CASE_CREATED',jsonb_build_object('source_type',p_source_type,'source_id',p_source_id,'priority',p_priority));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,'CASE_CREATED','CASE',created.id::text,'SUCCESS',jsonb_build_object('case_number',created.case_number,'source_type',p_source_type,'source_id',p_source_id));
    if p_assigned_to<>p_actor then
        perform public.enqueue_user_notification(p_assigned_to,'case-assigned:'||created.id::text||':'||p_assigned_to::text,
            'CASE_ASSIGNED','Case assigned','A case was assigned to you.','CASE',created.id::text,'NORMAL');
    end if;
    if case_team is not null then
        select supervisor_id into supervisor from public.audit_teams where id=case_team and is_active;
        if supervisor is not null and supervisor not in (p_actor,p_assigned_to) then
            perform public.enqueue_user_notification(supervisor,'case-created:'||created.id::text||':'||supervisor::text,
                'CASE_ASSIGNED','Case created in your team','A case was created in your team.','CASE',created.id::text,'NORMAL');
        end if;
    end if;
    return to_jsonb(created)||jsonb_build_object('assigned_to_name',target.name,'case_reference','CASE-'||lpad(created.case_number::text,6,'0'));
end;
$$;

create function public.update_case_status(p_actor uuid,p_case uuid,p_status text,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; case_row public.audit_cases; previous_status text; allowed boolean:=false;
    supervisor uuid; recipient uuid; event_key text;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found then raise exception 'Active account required' using errcode='42501'; end if;
    select * into case_row from public.audit_cases where id=p_case for update;
    if not found then raise exception 'Case not found' using errcode='P0002'; end if;
    previous_status:=case_row.status;
    if not public.can_access_case(p_actor,p_case) then raise exception 'Case access denied' using errcode='42501'; end if;
    if case_row.status in ('RESOLUTION_REQUESTED','CLOSED') or p_status not in ('INVESTIGATING','ESCALATED','RESOLVED') then raise exception 'Invalid case transition' using errcode='23505'; end if;
    if actor.role='AUDITOR' and case_row.assigned_to=p_actor and p_status in ('INVESTIGATING','RESOLVED') and case_row.status in ('OPEN','INVESTIGATING','ESCALATED') then allowed:=true; end if;
    if actor.role='AUDITOR' and case_row.assigned_to=p_actor and p_status='ESCALATED' and case_row.status in ('OPEN','INVESTIGATING') then allowed:=true; end if;
    if actor.role in ('SUPERVISOR','ADMIN') and p_status='ESCALATED' and case_row.status in ('OPEN','INVESTIGATING','RESOLVED') then allowed:=true; end if;
    if actor.role in ('SUPERVISOR','ADMIN') and p_status='INVESTIGATING' and case_row.status in ('ESCALATED','RESOLVED') then allowed:=true; end if;
    if not allowed then raise exception 'Case transition denied' using errcode='42501'; end if;
    update public.audit_cases set status=p_status,
        sla_status=case when p_status='RESOLVED' then 'COMPLETED' else sla_status end,
        updated_at=clock_timestamp() where id=p_case returning * into case_row;
    insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
    values(p_case,p_actor,actor.name,actor.role,case when p_status='ESCALATED' then 'CASE_ESCALATED' else 'CASE_STATUS_CHANGED' end,
        jsonb_build_object('previous_status',previous_status,'status',p_status,'note',p_note));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,case when p_status='ESCALATED' then 'CASE_ESCALATED' else 'CASE_STATUS_CHANGED' end,'CASE',p_case::text,'SUCCESS',
        jsonb_build_object('status',p_status,'note',p_note));
    if p_status='ESCALATED' then
        event_key:=clock_timestamp()::text;
        if case_row.assigned_to<>p_actor then
            perform public.enqueue_user_notification(case_row.assigned_to,'case-escalated:'||p_case::text||':'||event_key||':'||case_row.assigned_to::text,
                'CASE_ESCALATED','Case escalated','A case assigned to you was escalated.','CASE',p_case::text,'HIGH');
        end if;
        if case_row.team_id is not null then select supervisor_id into supervisor from public.audit_teams where id=case_row.team_id and is_active; end if;
        if supervisor is not null and supervisor not in (p_actor,case_row.assigned_to) then
            perform public.enqueue_user_notification(supervisor,'case-escalated:'||p_case::text||':'||event_key||':'||supervisor::text,
                'CASE_ESCALATED','Case escalated','A case in your team was escalated.','CASE',p_case::text,'HIGH');
        end if;
        for recipient in select id from public.user_profiles where role='ADMIN' and account_status='ACTIVE'
            and id not in (p_actor,case_row.assigned_to,coalesce(supervisor,p_actor)) loop
            perform public.enqueue_user_notification(recipient,'case-escalated:'||p_case::text||':'||event_key||':'||recipient::text,
                'CASE_ESCALATED','Case escalated','A case was escalated.','CASE',p_case::text,'HIGH');
        end loop;
    end if;
    return to_jsonb(case_row);
end;
$$;

create function public.assign_case(p_actor uuid,p_case uuid,p_assignee uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; target public.user_profiles; case_row public.audit_cases; target_team uuid; previous uuid; action_name text;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('SUPERVISOR','ADMIN') then raise exception 'Case assignment denied' using errcode='42501'; end if;
    select * into case_row from public.audit_cases where id=p_case for update;
    if not found then raise exception 'Case not found' using errcode='P0002'; end if;
    if not public.can_access_case(p_actor,p_case) then raise exception 'Case access denied' using errcode='42501'; end if;
    if case_row.status='CLOSED' then raise exception 'Closed case cannot be assigned' using errcode='23505'; end if;
    select * into target from public.user_profiles where id=p_assignee and account_status='ACTIVE' for share;
    if not found or target.role not in ('AUDITOR','SUPERVISOR') then raise exception 'Active Auditor or Supervisor required' using errcode='P0002'; end if;
    if target.role='SUPERVISOR' then select id into target_team from public.audit_teams where supervisor_id=target.id and is_active;
    else select m.team_id into target_team from public.audit_team_memberships m join public.audit_teams t on t.id=m.team_id where m.user_id=target.id and t.is_active; end if;
    if target_team is null then raise exception 'Assignee has no active team' using errcode='42501'; end if;
    if actor.role='SUPERVISOR' and target_team<>case_row.team_id then raise exception 'Cross-team case assignment denied' using errcode='42501'; end if;
    if case_row.assigned_to=p_assignee then raise exception 'Case already assigned to this user' using errcode='23505'; end if;
    previous:=case_row.assigned_to; action_name:=case when previous is null then 'ASSIGNED' else 'REASSIGNED' end;
    update public.audit_cases set assigned_to=p_assignee,team_id=target_team,updated_at=clock_timestamp() where id=p_case returning * into case_row;
    insert into public.case_assignment_history(case_id,previous_assignee_id,assignee_id,team_id,actor_id,actor_name,actor_role,action,note)
    values(p_case,previous,p_assignee,target_team,p_actor,actor.name,actor.role,action_name,nullif(btrim(p_note),''));
    insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
    values(p_case,p_actor,actor.name,actor.role,case when action_name='ASSIGNED' then 'CASE_ASSIGNED' else 'CASE_REASSIGNED' end,
        jsonb_build_object('previous_assignee_id',previous,'assignee_id',p_assignee,'note',p_note));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,'CASE_'||action_name,'CASE',p_case::text,'SUCCESS',jsonb_build_object('assignee_id',p_assignee,'previous_assignee_id',previous));
    perform public.enqueue_user_notification(p_assignee,'case-assignment:'||p_case::text||':'||p_assignee::text||':'||clock_timestamp()::text,
        'CASE_ASSIGNED',case when action_name='ASSIGNED' then 'Case assigned' else 'Case reassigned' end,'A case was assigned to you.','CASE',p_case::text,'NORMAL');
    return jsonb_build_object('case',to_jsonb(case_row),'assignee_name',target.name,'action',action_name);
end;
$$;

create function public.add_case_comment(p_actor uuid,p_case uuid,p_message text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; case_row public.audit_cases; comment_row public.case_comments;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found then raise exception 'Active account required' using errcode='42501'; end if;
    if length(btrim(coalesce(p_message,''))) not between 1 and 4000 then raise exception 'Invalid case comment' using errcode='22023'; end if;
    select * into case_row from public.audit_cases where id=p_case for update;
    if not found then raise exception 'Case not found' using errcode='P0002'; end if;
    if not public.can_access_case(p_actor,p_case) then raise exception 'Case access denied' using errcode='42501'; end if;
    if case_row.status='CLOSED' then raise exception 'Closed case is read-only' using errcode='23505'; end if;
    insert into public.case_comments(case_id,author_id,author_name,author_role,message)
    values(p_case,p_actor,actor.name,actor.role,btrim(p_message)) returning * into comment_row;
    insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
    values(p_case,p_actor,actor.name,actor.role,'CASE_COMMENT_ADDED',jsonb_build_object('comment_id',comment_row.id));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,'CASE_COMMENT_ADDED','CASE',p_case::text,'SUCCESS',jsonb_build_object('comment_id',comment_row.id));
    return to_jsonb(comment_row);
end;
$$;

create function public.request_case_closure(p_actor uuid,p_case uuid,p_outcome text,p_note text,p_evidence_summary text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; case_row public.audit_cases; supervisor uuid; recipient uuid;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role<>'AUDITOR' then raise exception 'Auditor closure request required' using errcode='42501'; end if;
    select * into case_row from public.audit_cases where id=p_case for update;
    if not found then raise exception 'Case not found' using errcode='P0002'; end if;
    if not public.can_access_case(p_actor,p_case) or case_row.assigned_to<>p_actor then raise exception 'Case access denied' using errcode='42501'; end if;
    if case_row.status<>'RESOLVED' then raise exception 'Case must be resolved before closure request' using errcode='23505'; end if;
    if p_outcome not in ('NO_ISSUE_FOUND','ISSUE_CONFIRMED','FALSE_POSITIVE','NEEDS_INVESTIGATION')
       or length(btrim(coalesce(p_note,''))) not between 1 and 4000
       or (p_evidence_summary is not null and length(btrim(p_evidence_summary)) not between 1 and 2000) then
        raise exception 'Invalid closure resolution' using errcode='22023';
    end if;
    update public.audit_cases set status='RESOLUTION_REQUESTED',resolution_outcome=p_outcome,resolution_note=btrim(p_note),
        evidence_summary=nullif(btrim(p_evidence_summary),''),closure_requested_by=p_actor,closure_requested_at=clock_timestamp(),
        closure_decided_by=null,closure_decided_at=null,closure_decision=null,closure_decision_note=null,
        sla_status='COMPLETED',updated_at=clock_timestamp() where id=p_case returning * into case_row;
    insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
    values(p_case,p_actor,actor.name,actor.role,'CASE_CLOSURE_REQUESTED',jsonb_build_object('outcome',p_outcome,'resolution_note',p_note));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,'CASE_CLOSURE_REQUESTED','CASE',p_case::text,'SUCCESS',jsonb_build_object('outcome',p_outcome));
    if case_row.team_id is not null then select supervisor_id into supervisor from public.audit_teams where id=case_row.team_id and is_active; end if;
    if supervisor is not null then
        perform public.enqueue_user_notification(supervisor,'case-closure-request:'||p_case::text||':'||supervisor::text,
            'CASE_CLOSURE_REQUESTED','Case closure requested','A case is waiting for closure review.','CASE',p_case::text,'HIGH');
    end if;
    for recipient in select id from public.user_profiles where role='ADMIN' and account_status='ACTIVE' loop
        perform public.enqueue_user_notification(recipient,'case-closure-request:'||p_case::text||':'||recipient::text,
            'CASE_CLOSURE_REQUESTED','Case closure requested','A case is waiting for closure review.','CASE',p_case::text,'HIGH');
    end loop;
    return to_jsonb(case_row);
end;
$$;

create function public.decide_case_closure(p_actor uuid,p_case uuid,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; case_row public.audit_cases; supervisor uuid; recipient uuid; action_name text;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('SUPERVISOR','ADMIN') then raise exception 'Closure decision denied' using errcode='42501'; end if;
    select * into case_row from public.audit_cases where id=p_case for update;
    if not found then raise exception 'Case not found' using errcode='P0002'; end if;
    if case_row.status<>'RESOLUTION_REQUESTED' then raise exception 'No pending closure request' using errcode='23505'; end if;
    if p_actor=case_row.closure_requested_by then raise exception 'Requester cannot decide own closure request' using errcode='42501'; end if;
    if actor.role='SUPERVISOR' and not exists(select 1 from public.audit_teams t where t.id=case_row.team_id and t.supervisor_id=p_actor and t.is_active) then
        raise exception 'Cross-team closure decision denied' using errcode='42501';
    end if;
    if p_note is not null and length(btrim(p_note)) not between 1 and 2000 then raise exception 'Invalid decision note' using errcode='22023'; end if;
    action_name:=case when p_approve then 'CASE_CLOSURE_APPROVED' else 'CASE_CLOSURE_REJECTED' end;
    update public.audit_cases set status=case when p_approve then 'CLOSED' else 'INVESTIGATING' end,
        closure_decided_by=p_actor,closure_decided_at=clock_timestamp(),closure_decision=case when p_approve then 'APPROVED' else 'REJECTED' end,
        closure_decision_note=nullif(btrim(p_note),''),closed_at=case when p_approve then clock_timestamp() else null end,
        sla_status=case when p_approve then 'COMPLETED' else 'ON_TRACK' end,
        sla_due_at=case when p_approve then sla_due_at else clock_timestamp()+make_interval(hours=>sla_target_hours) end,
        sla_overdue_at=case when p_approve then sla_overdue_at else null end,updated_at=clock_timestamp()
      where id=p_case returning * into case_row;
    insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
    values(p_case,p_actor,actor.name,actor.role,action_name,jsonb_build_object('approved',p_approve,'note',p_note,'requester_id',case_row.closure_requested_by));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,action_name,'CASE',p_case::text,'SUCCESS',jsonb_build_object('approved',p_approve,'requester_id',case_row.closure_requested_by));
    action_name:=case when p_approve then 'CASE_CLOSURE_APPROVED' else 'CASE_CLOSURE_REJECTED' end;
    perform public.enqueue_user_notification(case_row.closure_requested_by,'case-closure-decision:'||p_case::text||':'||case_row.closure_requested_by::text,
        action_name,case when p_approve then 'Case closure approved' else 'Case closure rejected' end,
        case when p_approve then 'Your case closure request was approved.' else 'Your case closure request needs more investigation.' end,
        'CASE',p_case::text,'HIGH');
    if case_row.assigned_to<>case_row.closure_requested_by then
        perform public.enqueue_user_notification(case_row.assigned_to,'case-closure-decision:'||p_case::text||':'||case_row.assigned_to::text,
            action_name,case when p_approve then 'Case closure approved' else 'Case closure rejected' end,
            case when p_approve then 'A case assigned to you was closed.' else 'A case assigned to you needs more investigation.' end,
            'CASE',p_case::text,'HIGH');
    end if;
    return to_jsonb(case_row);
end;
$$;

create function public.add_case_evidence(p_actor uuid,p_case uuid,p_file_name text,p_file_size bigint,p_mime_type text,
    p_category text,p_description text,p_storage_key text,p_scan_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; case_row public.audit_cases; evidence_row public.case_evidence;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('AUDITOR','SUPERVISOR','ADMIN') then raise exception 'Evidence upload denied' using errcode='42501'; end if;
    select * into case_row from public.audit_cases where id=p_case for update;
    if not found then raise exception 'Case not found' using errcode='P0002'; end if;
    if not public.can_access_case(p_actor,p_case) then raise exception 'Case access denied' using errcode='42501'; end if;
    if case_row.status='CLOSED' then raise exception 'Closed case is read-only' using errcode='23505'; end if;
    if p_file_size not between 1 and 10485760 or p_mime_type not in ('application/pdf','image/png','image/jpeg')
       or p_category not in ('DOCUMENT','SCREENSHOT','INVOICE','APPROVAL_RECORD','OTHER') or p_scan_status<>'CLEAN'
       or p_file_name is null or length(p_file_name) not between 1 and 240 or p_storage_key is null or length(p_storage_key) not between 1 and 500 then
        raise exception 'Invalid or unscanned evidence' using errcode='22023';
    end if;
    insert into public.case_evidence(case_id,file_name,file_size,mime_type,category,description,storage_key,scan_status,uploaded_by)
    values(p_case,p_file_name,p_file_size,p_mime_type,p_category,nullif(btrim(p_description),''),p_storage_key,p_scan_status,p_actor)
    returning * into evidence_row;
    insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
    values(p_case,p_actor,actor.name,actor.role,'EVIDENCE_ADDED',jsonb_build_object('evidence_id',evidence_row.id,'file_name',p_file_name,'file_size',p_file_size,'mime_type',p_mime_type));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,'EVIDENCE_ADDED','CASE',p_case::text,'SUCCESS',jsonb_build_object('evidence_id',evidence_row.id,'scan_status','CLEAN'));
    return to_jsonb(evidence_row);
end;
$$;

create function public.get_case_evidence(p_actor uuid,p_case uuid,p_evidence uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.case_evidence;
begin
    if not public.can_access_case(p_actor,p_case) then raise exception 'Case access denied' using errcode='42501'; end if;
    select * into result from public.case_evidence where id=p_evidence and case_id=p_case and scan_status='CLEAN';
    if not found then raise exception 'Evidence not found' using errcode='P0002'; end if;
    return to_jsonb(result);
end;
$$;

create function public.record_case_evidence_rejection(p_actor uuid,p_case uuid,p_reason text)
returns void language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or not public.can_access_case(p_actor,p_case) then raise exception 'Case access denied' using errcode='42501'; end if;
    if p_reason not in ('SIZE_LIMIT','UNSAFE_TYPE','MIME_MISMATCH','MALWARE_DETECTED') then raise exception 'Invalid evidence rejection reason' using errcode='22023'; end if;
    insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
    values(p_case,p_actor,actor.name,actor.role,'EVIDENCE_REJECTED',jsonb_build_object('reason',p_reason));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,actor.name,actor.role,'EVIDENCE_REJECTED','CASE',p_case::text,'DENIED',jsonb_build_object('reason',p_reason));
end;
$$;

create function public.escalate_overdue_cases(p_batch integer default 100)
returns jsonb language plpgsql security definer set search_path='' as $$
declare case_row public.audit_cases; supervisor uuid; recipient uuid; changed integer:=0; actor_name text:='System';
begin
    if p_batch<1 or p_batch>500 then raise exception 'Invalid escalation batch' using errcode='22023'; end if;
    for case_row in
        select * from public.audit_cases where status in ('OPEN','INVESTIGATING','ESCALATED','RESOLVED')
          and sla_status in ('ON_TRACK','DUE_SOON') and sla_due_at<=clock_timestamp()
        order by sla_due_at,id for update skip locked limit p_batch
    loop
        update public.audit_cases set status='ESCALATED',sla_status='OVERDUE',sla_overdue_at=clock_timestamp(),updated_at=clock_timestamp()
          where id=case_row.id returning * into case_row;
        insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
        values(case_row.id,null,actor_name,'SYSTEM','SLA_OVERDUE',jsonb_build_object('sla_due_at',case_row.sla_due_at,'priority',case_row.priority));
        insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
        values(null,actor_name,'SYSTEM','SLA_OVERDUE','CASE',case_row.id::text,'SUCCESS',jsonb_build_object('sla_due_at',case_row.sla_due_at,'priority',case_row.priority));
        perform public.enqueue_user_notification(case_row.assigned_to,'case-sla-overdue:'||case_row.id::text||':'||case_row.assigned_to::text,
            'SLA_OVERDUE','Case SLA overdue','A case assigned to you has exceeded its SLA and was escalated.','CASE',case_row.id::text,'HIGH');
        if case_row.team_id is not null then select supervisor_id into supervisor from public.audit_teams where id=case_row.team_id and is_active;
        else supervisor:=null; end if;
        if supervisor is not null then
            perform public.enqueue_user_notification(supervisor,'case-sla-overdue:'||case_row.id::text||':'||supervisor::text,
                'SLA_OVERDUE','Case SLA overdue','A case in your team exceeded its SLA and was escalated.','CASE',case_row.id::text,'HIGH');
        end if;
        for recipient in select id from public.user_profiles where role='ADMIN' and account_status='ACTIVE' loop
            perform public.enqueue_user_notification(recipient,'case-sla-overdue:'||case_row.id::text||':'||recipient::text,
                'SLA_OVERDUE','Case SLA overdue','A case exceeded its SLA and was escalated.','CASE',case_row.id::text,'HIGH');
        end loop;
        changed:=changed+1;
    end loop;
    return jsonb_build_object('escalated',changed);
end;
$$;

alter table public.case_sla_policies enable row level security;
alter table public.audit_cases enable row level security;
alter table public.case_assignment_history enable row level security;
alter table public.case_activity enable row level security;
alter table public.case_comments enable row level security;
alter table public.case_evidence enable row level security;
revoke all on public.case_sla_policies,public.audit_cases,public.case_assignment_history,public.case_activity,public.case_comments,public.case_evidence from anon,authenticated;
grant select on public.case_sla_policies,public.audit_cases,public.case_assignment_history,public.case_activity,public.case_comments,public.case_evidence to service_role;
revoke insert,update,delete on public.case_sla_policies,public.audit_cases,public.case_assignment_history,public.case_activity,public.case_comments,public.case_evidence from service_role;
revoke all on function public.prevent_case_history_mutation() from public,anon,authenticated;
revoke all on function public.can_access_case(uuid,uuid),public.list_cases(uuid,integer,integer,text,text,text),
    public.get_case_bundle(uuid,uuid),public.create_case(uuid,text,text,text,text,text,text,uuid),
    public.update_case_status(uuid,uuid,text,text),public.assign_case(uuid,uuid,uuid,text),public.add_case_comment(uuid,uuid,text),
    public.request_case_closure(uuid,uuid,text,text,text),public.decide_case_closure(uuid,uuid,boolean,text),
    public.add_case_evidence(uuid,uuid,text,bigint,text,text,text,text,text),public.get_case_evidence(uuid,uuid,uuid),
    public.record_case_evidence_rejection(uuid,uuid,text),public.escalate_overdue_cases(integer)
    from public,anon,authenticated;
grant execute on function public.can_access_case(uuid,uuid),public.list_cases(uuid,integer,integer,text,text,text),
    public.get_case_bundle(uuid,uuid),public.create_case(uuid,text,text,text,text,text,text,uuid),
    public.update_case_status(uuid,uuid,text,text),public.assign_case(uuid,uuid,uuid,text),public.add_case_comment(uuid,uuid,text),
    public.request_case_closure(uuid,uuid,text,text,text),public.decide_case_closure(uuid,uuid,boolean,text),
    public.add_case_evidence(uuid,uuid,text,bigint,text,text,text,text,text),public.get_case_evidence(uuid,uuid,uuid),
    public.record_case_evidence_rejection(uuid,uuid,text),public.escalate_overdue_cases(integer)
    to service_role;
