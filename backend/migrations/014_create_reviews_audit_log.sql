create table public.transaction_review_states (
    transaction_id text primary key references public.transactions(id) on delete cascade,
    status text not null check (status in ('REVIEWED')),
    updated_by uuid not null references public.user_profiles(id),
    updated_at timestamptz not null default clock_timestamp()
);

create table public.review_records (
    id bigint generated always as identity primary key,
    resource_type text not null check (resource_type in ('TRANSACTION','ALERT')),
    resource_id text not null,
    transaction_id text not null references public.transactions(id) on delete cascade,
    alert_id text references public.alerts(id) on delete cascade,
    actor_id uuid not null references public.user_profiles(id),
    actor_name text not null,
    actor_role text not null check (actor_role in ('AUDITOR','SUPERVISOR','ADMIN')),
    action text not null check (action in ('REVIEWED','REOPENED','NOTE_ADDED')),
    note text check (note is null or length(note) between 1 and 2000),
    created_at timestamptz not null default clock_timestamp(),
    constraint review_record_target_check check (
        (resource_type = 'TRANSACTION' and alert_id is null and resource_id = transaction_id)
        or (resource_type = 'ALERT' and alert_id is not null and resource_id = alert_id)
    )
);
create index review_records_target_idx on public.review_records(resource_type,resource_id,created_at desc,id desc);
create index review_records_actor_idx on public.review_records(actor_id,created_at desc,id desc);

create table public.audit_events (
    id bigint generated always as identity primary key,
    actor_id uuid references public.user_profiles(id),
    actor_name text not null,
    actor_role text not null check (actor_role in ('AUDITOR','SUPERVISOR','ADMIN','SYSTEM')),
    action text not null check (length(action) between 1 and 80),
    resource_type text not null check (length(resource_type) between 1 and 40),
    resource_id text not null,
    outcome text not null check (outcome in ('SUCCESS','FAILED','DENIED')),
    details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
    source_login_history_id uuid unique references public.login_history(id),
    created_at timestamptz not null default clock_timestamp()
);
create index audit_events_created_idx on public.audit_events(created_at desc,id desc);
create index audit_events_actor_idx on public.audit_events(actor_id,created_at desc,id desc);
create index audit_events_action_idx on public.audit_events(action,created_at desc,id desc);

create function public.prevent_accountability_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
    raise exception 'Accountability history is append-only';
end;
$$;
create trigger review_records_immutable before update or delete on public.review_records
    for each row execute function public.prevent_accountability_mutation();
create trigger audit_events_immutable before update or delete on public.audit_events
    for each row execute function public.prevent_accountability_mutation();

create function public.capture_login_history_audit_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare subject public.user_profiles; actor public.user_profiles; event_action text;
begin
    if new.user_id is not null then select * into subject from public.user_profiles where id=new.user_id; end if;
    if new.actor_id is not null then select * into actor from public.user_profiles where id=new.actor_id; end if;
    if new.actor_id is null and new.action='SIGN_IN' then actor := subject; end if;
    event_action := case
        when new.action='SIGN_IN' and new.outcome='SUCCESS' then 'LOGIN_SUCCESS'
        when new.action='SIGN_IN' then 'LOGIN_FAILED'
        when new.action='ACCOUNT_UNLOCK' and new.outcome='APPROVED' then 'ACCOUNT_UNLOCKED'
        when new.action='ACCOUNT_UNLOCK' then 'ACCOUNT_UNLOCK_REJECTED'
        when new.action='ROLE' then 'USER_ROLE_CHANGED'
        when new.action='DISABLE' then 'ACCOUNT_DISABLED'
        when new.action='ENABLE' then 'ACCOUNT_ENABLED'
        when new.action='ACCESS_REQUEST' and new.outcome='APPROVED' then 'ACCESS_REQUEST_APPROVED'
        when new.action='ACCESS_REQUEST' then 'ACCESS_REQUEST_REJECTED'
        else new.action end;
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details,source_login_history_id)
    values(coalesce(new.actor_id,case when new.action='SIGN_IN' then subject.id else null end),
        coalesce(actor.name,'System'),coalesce(actor.role,'SYSTEM'),event_action,
        case when new.action='ACCESS_REQUEST' then 'ACCESS_REQUEST' when new.action='SIGN_IN' then 'ACCOUNT' else 'USER' end,
        coalesce(subject.id::text,new.id::text),
        case when new.action='SIGN_IN' and new.outcome='SUCCESS' then 'SUCCESS'
             when new.action='SIGN_IN' then 'FAILED'
             when new.outcome in ('SUCCESS','APPROVED','ENABLED') then 'SUCCESS'
             when new.outcome='FAILED' then 'FAILED' else 'DENIED' end,
        jsonb_build_object('login_history_id',new.id,'subject_user_id',subject.id,'source_outcome',new.outcome),new.id);
    return new;
end;
$$;
create trigger login_history_audit_event after insert on public.login_history
    for each row execute function public.capture_login_history_audit_event();

create function public.record_review_action(
    p_actor uuid, p_resource_type text, p_resource_id text, p_action text, p_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
    u public.user_profiles;
    t public.transactions;
    a public.alerts;
    current_status text;
    mapped_action text;
    record_row public.review_records;
begin
    select * into u from public.user_profiles where id=p_actor for share;
    if not found or u.account_status <> 'ACTIVE' or u.role not in ('AUDITOR','SUPERVISOR','ADMIN') then
        raise exception 'Review permission denied' using errcode='42501';
    end if;
    if p_resource_type not in ('TRANSACTION','ALERT') or p_action not in ('REVIEWED','REOPENED','NOTE_ADDED') then
        raise exception 'Invalid review action' using errcode='22023';
    end if;
    if p_note is not null and length(p_note)>2000 then
        raise exception 'Review note is too long' using errcode='22023';
    end if;
    if p_action='NOTE_ADDED' and coalesce(length(btrim(p_note)),0)=0 then
        raise exception 'A review note is required' using errcode='22023';
    end if;

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
            delete from public.transaction_review_states where transaction_id=p_resource_id;
        end if;
        insert into public.review_records(resource_type,resource_id,transaction_id,actor_id,actor_name,actor_role,action,note)
        values('TRANSACTION',p_resource_id,p_resource_id,p_actor,u.name,u.role,p_action,nullif(btrim(p_note),'')) returning * into record_row;
        mapped_action := case p_action when 'REVIEWED' then 'TRANSACTION_REVIEWED' when 'REOPENED' then 'TRANSACTION_REOPENED' else 'REVIEW_NOTE_ADDED' end;
    else
        select * into a from public.alerts where id=p_resource_id for update;
        if not found then raise exception 'Review target not found' using errcode='P0002'; end if;
        current_status := a.status;
        if p_action='REVIEWED' then
            if current_status='REVIEWED' then raise exception 'Review is already complete' using errcode='23505'; end if;
            update public.alerts set status='REVIEWED',reviewed_at=clock_timestamp() where id=p_resource_id returning * into a;
        elsif p_action='REOPENED' then
            if current_status<>'REVIEWED' then raise exception 'Review is not complete' using errcode='23505'; end if;
            update public.alerts set status='ACTIVE',reviewed_at=null where id=p_resource_id returning * into a;
        end if;
        insert into public.review_records(resource_type,resource_id,transaction_id,alert_id,actor_id,actor_name,actor_role,action,note)
        values('ALERT',p_resource_id,a.transaction_id,p_resource_id,p_actor,u.name,u.role,p_action,nullif(btrim(p_note),'')) returning * into record_row;
        mapped_action := case p_action when 'REVIEWED' then 'ALERT_REVIEWED' when 'REOPENED' then 'ALERT_REOPENED' else 'REVIEW_NOTE_ADDED' end;
    end if;

    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(p_actor,u.name,u.role,mapped_action,p_resource_type,p_resource_id,'SUCCESS',jsonb_build_object('review_record_id',record_row.id,'action',p_action));
    if p_resource_type='ALERT' then
        return jsonb_build_object('record',to_jsonb(record_row),'alert',to_jsonb(a));
    end if;
    return jsonb_build_object('record',to_jsonb(record_row),'transaction_review_status',
        case when p_action='REOPENED' then 'NOT_REVIEWED' else 'REVIEWED' end);
end;
$$;

alter table public.transaction_review_states enable row level security;
alter table public.review_records enable row level security;
alter table public.audit_events enable row level security;
revoke all on public.transaction_review_states,public.review_records,public.audit_events from anon,authenticated;
grant select on public.review_records,public.audit_events to service_role;
revoke insert,update,delete on public.transaction_review_states,public.review_records,public.audit_events from service_role;
revoke all on function public.prevent_accountability_mutation(),
    public.capture_login_history_audit_event(),public.record_review_action(uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_review_action(uuid,text,text,text,text) to service_role;
