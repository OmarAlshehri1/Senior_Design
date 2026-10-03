create table public.user_notifications (
    id uuid primary key default gen_random_uuid(),
    recipient_id uuid not null references public.user_profiles(id) on delete restrict,
    event_key text not null check (length(event_key) between 1 and 240),
    type text not null check (type in (
        'HIGH_RISK_ALERT','ALERT_ASSIGNED','ALERT_REASSIGNED','REVIEW_REQUIRED',
        'ACCESS_REQUEST_SUBMITTED','ACCESS_REQUEST_APPROVED',
        'ACCOUNT_LOCKED','ACCOUNT_UNLOCKED','ACCOUNT_UNLOCK_REQUESTED','ACCOUNT_UNLOCK_REJECTED',
        'SECURITY_ALERT','SYSTEM_NOTICE','CASE_ASSIGNED','CASE_ESCALATED',
        'CASE_CLOSURE_REQUESTED','CASE_CLOSURE_APPROVED','CASE_CLOSURE_REJECTED',
        'SLA_DUE_SOON','SLA_OVERDUE','VENDOR_WATCHLIST_REQUEST','VENDOR_WATCHLIST_APPROVED',
        'VENDOR_BLOCK_REQUEST','VENDOR_BLOCKED'
    )),
    title text not null check (length(title) between 1 and 160),
    message text not null check (length(message) between 1 and 1000),
    resource_type text not null check (length(resource_type) between 1 and 40),
    resource_id text not null check (length(resource_id) between 1 and 240),
    priority text not null check (priority in ('LOW','NORMAL','HIGH')),
    created_at timestamptz not null default clock_timestamp(),
    read_at timestamptz,
    unique(recipient_id,event_key)
);
create index user_notifications_recipient_created_idx
    on public.user_notifications(recipient_id,created_at desc,id desc);
create index user_notifications_unread_idx
    on public.user_notifications(recipient_id,created_at desc,id desc) where read_at is null;

create function public.enqueue_user_notification(
    p_recipient uuid,p_event_key text,p_type text,p_title text,p_message text,
    p_resource_type text,p_resource_id text,p_priority text default 'NORMAL'
) returns void language sql security definer set search_path='' as $$
    insert into public.user_notifications(
        recipient_id,event_key,type,title,message,resource_type,resource_id,priority
    ) values (
        p_recipient,p_event_key,p_type,p_title,p_message,p_resource_type,p_resource_id,p_priority
    ) on conflict(recipient_id,event_key) do nothing;
$$;

create function public.list_user_notifications(
    p_actor uuid,p_page integer default 1,p_page_size integer default 25,p_unread_only boolean default false
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
    profile public.user_profiles;
    result_items jsonb;
    result_total bigint;
    result_unread bigint;
begin
    select * into profile from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found then raise exception 'Active account required' using errcode='42501'; end if;
    if p_page<1 or p_page_size<1 or p_page_size>100 then
        raise exception 'Invalid notification page' using errcode='22023';
    end if;
    select count(*) into result_total from public.user_notifications n
        where n.recipient_id=p_actor and (not p_unread_only or n.read_at is null);
    select count(*) into result_unread from public.user_notifications n
        where n.recipient_id=p_actor and n.read_at is null;
    select coalesce(jsonb_agg(jsonb_build_object(
        'id',n.id,'type',n.type,'title',n.title,'message',n.message,'timestamp',n.created_at,
        'readAt',n.read_at,'resourceType',n.resource_type,'resourceId',n.resource_id,'priority',n.priority
    ) order by n.created_at desc,n.id desc),'[]'::jsonb) into result_items
    from (
        select * from public.user_notifications
        where recipient_id=p_actor and (not p_unread_only or read_at is null)
        order by created_at desc,id desc limit p_page_size offset ((p_page-1)*p_page_size)
    ) n;
    return jsonb_build_object('items',result_items,'total',result_total,'unread_count',result_unread,
        'page',p_page,'page_size',p_page_size);
end;
$$;

create function public.mark_user_notification_read(p_actor uuid,p_notification uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result public.user_notifications;
begin
    if not exists(select 1 from public.user_profiles where id=p_actor and account_status='ACTIVE') then
        raise exception 'Active account required' using errcode='42501';
    end if;
    update public.user_notifications set read_at=coalesce(read_at,clock_timestamp())
        where id=p_notification and recipient_id=p_actor returning * into result;
    if not found then raise exception 'Notification not found' using errcode='P0002'; end if;
    return jsonb_build_object('id',result.id,'readAt',result.read_at);
end;
$$;

create function public.mark_all_user_notifications_read(p_actor uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare changed integer;
begin
    if not exists(select 1 from public.user_profiles where id=p_actor and account_status='ACTIVE') then
        raise exception 'Active account required' using errcode='42501';
    end if;
    update public.user_notifications set read_at=clock_timestamp()
        where recipient_id=p_actor and read_at is null;
    get diagnostics changed = row_count;
    return jsonb_build_object('updated',changed);
end;
$$;

create function public.notify_high_risk_alert()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
    if new.severity<>'HIGH' then return new; end if;
    for recipient in
        select id from public.user_profiles where account_status='ACTIVE' and role in ('ADMIN','SUPERVISOR')
    loop
        perform public.enqueue_user_notification(recipient,'alert-created:'||new.id::text||':'||recipient::text,
            'HIGH_RISK_ALERT','High-risk alert created','A high-risk alert is available in the alerts queue.',
            'ALERT',new.id::text,'HIGH');
    end loop;
    return new;
end;
$$;
create trigger alerts_notify_high_risk after insert on public.alerts
    for each row execute function public.notify_high_risk_alert();

create function public.notify_alert_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; notification_type text; notification_title text;
begin
    if new.action='UNASSIGNED' then return new; end if;
    notification_type:=case when new.action='REASSIGNED' then 'ALERT_REASSIGNED' else 'ALERT_ASSIGNED' end;
    notification_title:=case when new.action='REASSIGNED' then 'Alert reassigned' else 'Alert assigned' end;
    if new.assignee_id is not null then
        perform public.enqueue_user_notification(new.assignee_id,
            'assignment:'||new.id::text||':'||new.assignee_id::text,notification_type,notification_title,
            'Alert '||new.alert_id||' was assigned to you.','ALERT',new.alert_id,'NORMAL');
    end if;
    for recipient in
        select t.supervisor_id from public.audit_teams t
        join public.user_profiles u on u.id=t.supervisor_id and u.account_status='ACTIVE'
        where t.id=new.team_id and t.is_active
    loop
        perform public.enqueue_user_notification(recipient,
            'assignment:'||new.id::text||':'||recipient::text,notification_type,notification_title,
            'Alert '||new.alert_id||' was assigned within your team.','ALERT',new.alert_id,'NORMAL');
    end loop;
    return new;
end;
$$;
create trigger alert_assignment_history_notify after insert on public.alert_assignment_history
    for each row execute function public.notify_alert_assignment();

create function public.notify_access_request()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; requester uuid;
begin
    if tg_op='INSERT' then
        for recipient in select id from public.user_profiles where role='ADMIN' and account_status='ACTIVE'
        loop
            perform public.enqueue_user_notification(recipient,'access-request-submitted:'||new.id::text||':'||recipient::text,
                'ACCESS_REQUEST_SUBMITTED','Access request submitted','A new access request is waiting for review.',
                'ACCESS_REQUEST',new.id::text,'NORMAL');
        end loop;
        insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
        values(null,'System','SYSTEM','ACCESS_REQUEST_SUBMITTED','ACCESS_REQUEST',new.id::text,'SUCCESS',
            jsonb_build_object('request_id',new.id));
        return new;
    end if;
    if old.status='PENDING' and new.status='APPROVED' then
        select id into requester from public.user_profiles where email=new.email;
        if requester is not null then
            perform public.enqueue_user_notification(requester,'access-request-decision:'||new.id::text,
                'ACCESS_REQUEST_APPROVED','Access request approved','Your access request was approved.',
                'ACCESS_REQUEST',new.id::text,'NORMAL');
        end if;
    end if;
    return new;
end;
$$;
create trigger access_requests_notify_insert after insert on public.access_requests
    for each row execute function public.notify_access_request();
create trigger access_requests_notify_decision after update of status on public.access_requests
    for each row execute function public.notify_access_request();

create function public.notify_account_unlock_request()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid;
begin
    if tg_op='INSERT' then
        for recipient in select id from public.user_profiles where role='ADMIN' and account_status='ACTIVE'
        loop
            perform public.enqueue_user_notification(recipient,'unlock-request-submitted:'||new.id::text||':'||recipient::text,
                'ACCOUNT_UNLOCK_REQUESTED','Account unlock requested','An account unlock request is waiting for review.',
                'ACCOUNT_UNLOCK_REQUEST',new.id::text,'HIGH');
        end loop;
        insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
        select u.id,u.name,u.role,'ACCOUNT_UNLOCK_REQUESTED','ACCOUNT_UNLOCK_REQUEST',new.id::text,'SUCCESS',
            jsonb_build_object('request_id',new.id)
        from public.user_profiles u where u.id=new.user_id;
    elsif old.status='PENDING' and new.status='REJECTED' then
        perform public.enqueue_user_notification(new.user_id,'unlock-request-decision:'||new.id::text,
            'ACCOUNT_UNLOCK_REJECTED','Account unlock request rejected',
            'Your account unlock request was not approved.','ACCOUNT_UNLOCK_REQUEST',new.id::text,'HIGH');
    end if;
    return new;
end;
$$;
create trigger account_unlock_requests_notify_insert after insert on public.account_unlock_requests
    for each row execute function public.notify_account_unlock_request();
create trigger account_unlock_requests_notify_decision after update of status on public.account_unlock_requests
    for each row execute function public.notify_account_unlock_request();

create function public.notify_account_lock_state()
returns trigger language plpgsql security definer set search_path='' as $$
declare recipient uuid; locked boolean; event_type text; event_title text; event_message text; event_key text;
begin
    if old.account_status=new.account_status then return new; end if;
    if new.account_status='LOCKED' then
        locked:=true; event_type:='ACCOUNT_LOCKED'; event_title:='Account locked';
        event_message:='Your account was locked after unsuccessful sign-in attempts.';
        event_key:='account-locked:'||new.id::text||':'||coalesce(new.locked_at::text,new.updated_at::text);
    elsif old.account_status='LOCKED' and new.account_status='ACTIVE' then
        locked:=false; event_type:='ACCOUNT_UNLOCKED'; event_title:='Account unlocked';
        event_message:='Your account is active again.';
        event_key:='account-unlocked:'||new.id::text||':'||new.updated_at::text;
    else return new;
    end if;
    perform public.enqueue_user_notification(new.id,event_key,event_type,event_title,event_message,'ACCOUNT',new.id::text,
        case when locked then 'HIGH' else 'NORMAL' end);
    for recipient in select id from public.user_profiles where role='ADMIN' and account_status='ACTIVE'
    loop
        perform public.enqueue_user_notification(recipient,event_key||':'||recipient::text,event_type,event_title,
            case when locked then 'An account was locked after repeated unsuccessful sign-in attempts.' else 'A locked account was restored.' end,
            'ACCOUNT',new.id::text,case when locked then 'HIGH' else 'NORMAL' end);
    end loop;
    return new;
end;
$$;
create trigger user_profiles_notify_lock_state after update of account_status on public.user_profiles
    for each row execute function public.notify_account_lock_state();

alter table public.user_notifications enable row level security;
revoke all on public.user_notifications from anon,authenticated;
grant select on public.user_notifications to service_role;
revoke insert,update,delete on public.user_notifications from service_role;
revoke all on function public.enqueue_user_notification(uuid,text,text,text,text,text,text,text),
    public.notify_high_risk_alert(),public.notify_alert_assignment(),public.notify_access_request(),
    public.notify_account_unlock_request(),public.notify_account_lock_state(),
    public.list_user_notifications(uuid,integer,integer,boolean),
    public.mark_user_notification_read(uuid,uuid),public.mark_all_user_notifications_read(uuid)
    from public,anon,authenticated;
grant execute on function public.list_user_notifications(uuid,integer,integer,boolean),
    public.mark_user_notification_read(uuid,uuid),public.mark_all_user_notifications_read(uuid)
    to service_role;
