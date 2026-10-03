-- Local implementation only. Live application/bootstrap require approval.
create table public.user_profiles (
    id uuid primary key references auth.users(id),
    email text not null unique check (email = lower(email)),
    name text not null default '',
    role text not null default 'AUDITOR' check (role in ('AUDITOR','SUPERVISOR','ADMIN')),
    account_status text not null default 'DISABLED' check (account_status in ('ACTIVE','LOCKED','DISABLED')),
    failed_sign_in_attempts integer not null default 0,
    last_login_at timestamptz, locked_at timestamptz, disabled_at timestamptz,
    status_reason text,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.login_history (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references public.user_profiles(id),
    action text not null, outcome text not null,
    actor_id uuid references public.user_profiles(id),
    created_at timestamptz not null default now()
);
create index login_history_user_time_idx on public.login_history(user_id, created_at desc, id);
create table public.app_sessions (
    token_hash text primary key check (length(token_hash) = 64),
    user_id uuid not null references public.user_profiles(id),
    expires_at timestamptz not null, revoked_at timestamptz,
    created_at timestamptz not null default now()
);
create index app_sessions_user_idx on public.app_sessions(user_id);
create table public.access_requests (
    id uuid primary key default gen_random_uuid(),
    email text not null check (email = lower(email)), full_name text not null,
    department text not null, employee_id text, reason text not null check (length(reason) between 1 and 500),
    status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
    assigned_role text check (assigned_role in ('AUDITOR','SUPERVISOR','ADMIN')),
    user_id uuid references public.user_profiles(id),
    decided_by uuid references public.user_profiles(id), decision_reason text,
    requested_at timestamptz not null default now(), decided_at timestamptz
);
create table public.account_unlock_requests (
    id uuid primary key default gen_random_uuid(),
    email text not null check (email = lower(email)),
    user_id uuid not null references public.user_profiles(id),
    status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
    decided_by uuid references public.user_profiles(id),
    decision_reason text,
    requested_at timestamptz not null default now(),
    decided_at timestamptz
);
create unique index account_unlock_pending_user_idx on public.account_unlock_requests(user_id) where status='PENDING';
create unique index access_requests_pending_email_idx on public.access_requests(email) where status='PENDING';
create table public.auth_rate_limits (
    bucket text primary key, attempts integer not null, resets_at timestamptz not null
);
create index auth_rate_limits_reset_idx on public.auth_rate_limits(resets_at);
create function public.consume_auth_limit(p_bucket text,p_limit integer,p_seconds integer)
returns boolean language plpgsql security invoker set search_path='' as $$
declare n integer;
begin
    delete from public.auth_rate_limits where resets_at<clock_timestamp()-interval '1 hour';
    insert into public.auth_rate_limits(bucket,attempts,resets_at) values(p_bucket,1,clock_timestamp()+p_seconds*interval '1 second')
    on conflict(bucket) do update set attempts=case when auth_rate_limits.resets_at<=clock_timestamp() then 1 else auth_rate_limits.attempts+1 end,
        resets_at=case when auth_rate_limits.resets_at<=clock_timestamp() then excluded.resets_at else auth_rate_limits.resets_at end
    returning attempts into n;
    return n<=p_limit;
end;
$$;

-- Auth creation never grants application access. Approval/bootstrap is explicit.
create function public.initialize_user_profile() returns trigger
language plpgsql security definer set search_path='' as $$
begin
    insert into public.user_profiles(id,email,name)
    values(new.id,lower(new.email),coalesce(new.raw_user_meta_data->>'full_name',''));
    return new;
end;
$$;
revoke all on function public.initialize_user_profile() from public, anon, authenticated;
create trigger initialize_user_profile after insert on auth.users
for each row when (new.email is not null) execute function public.initialize_user_profile();
insert into public.user_profiles(id,email,name)
select id,lower(email),coalesce(raw_user_meta_data->>'full_name','') from auth.users where email is not null;

create function public.record_login(p_email text, p_success boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u public.user_profiles;
begin
    select * into u from public.user_profiles where email=lower(p_email) for update;
    if not found then return null; end if;
    if u.account_status='ACTIVE' then
        if p_success then
            update public.user_profiles set failed_sign_in_attempts=0,last_login_at=clock_timestamp(),updated_at=clock_timestamp()
            where id=u.id returning * into u;
        else
            update public.user_profiles set failed_sign_in_attempts=failed_sign_in_attempts+1,
                account_status=case when failed_sign_in_attempts+1>=3 then 'LOCKED' else 'ACTIVE' end,
                locked_at=case when failed_sign_in_attempts+1>=3 then clock_timestamp() else null end,
                status_reason=case when failed_sign_in_attempts+1>=3 then 'Three consecutive unsuccessful application sign-ins' else status_reason end,
                updated_at=clock_timestamp() where id=u.id returning * into u;
            if u.account_status='LOCKED' then
                update public.app_sessions set revoked_at=clock_timestamp() where user_id=u.id and revoked_at is null;
            end if;
        end if;
    end if;
    insert into public.login_history(user_id,action,outcome)
    values(u.id,'SIGN_IN',case when p_success and u.account_status='ACTIVE' then 'SUCCESS' else 'DENIED' end);
    return to_jsonb(u);
end;
$$;

create function public.start_app_session(p_user_id uuid, p_hash text, p_expires timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u public.user_profiles;
begin
    select * into u from public.user_profiles where id=p_user_id for update;
    if not found or u.account_status<>'ACTIVE' or p_expires<=clock_timestamp() then raise exception 'Session denied'; end if;
    -- A revoked token cannot be reactivated through a replay/exchange.
    insert into public.app_sessions(token_hash,user_id,expires_at) values(p_hash,p_user_id,p_expires)
    on conflict(token_hash) do nothing;
    if not exists(select 1 from public.app_sessions where token_hash=p_hash and user_id=p_user_id and revoked_at is null and expires_at>clock_timestamp()) then
        raise exception 'Session denied';
    end if;
    return to_jsonb(u);
end;
$$;

create function public.check_app_session(p_hash text)
returns jsonb language sql stable security invoker set search_path='' as $$
    select to_jsonb(u) from public.app_sessions s join public.user_profiles u on u.id=s.user_id
    where s.token_hash=p_hash and s.revoked_at is null and s.expires_at>now();
$$;

create function public.rotate_app_session(p_old_hash text,p_user_id uuid,p_hash text,p_expires timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u jsonb;
begin
    perform 1 from public.user_profiles where id=p_user_id for update;
    perform 1 from public.app_sessions where token_hash=p_old_hash and user_id=p_user_id and revoked_at is null for update;
    if not found then raise exception 'Session denied'; end if;
    if p_old_hash=p_hash then raise exception 'Session rotation required'; end if;
    u := public.start_app_session(p_user_id,p_hash,p_expires);
    update public.app_sessions set revoked_at=clock_timestamp() where token_hash=p_old_hash;
    return u;
end;
$$;

create function public.admin_user_action(p_actor uuid,p_user_id uuid,p_action text,p_role text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare u public.user_profiles;
begin
    -- Serialize lifecycle decisions, including concurrent last-admin changes.
    perform pg_advisory_xact_lock(14001);
    if not exists(select 1 from public.user_profiles where id=p_actor and role='ADMIN' and account_status='ACTIVE') then raise exception 'Administrator required'; end if;
    select * into u from public.user_profiles where id=p_user_id for update;
    if not found then raise exception 'User missing'; end if;
    if p_action not in ('role','disable','enable') then raise exception 'Invalid action'; end if;
    if p_action='role' and (p_role is null or p_role not in ('AUDITOR','SUPERVISOR','ADMIN')) then raise exception 'Invalid role'; end if;
    if p_action='enable' and u.account_status<>'DISABLED' then raise exception 'Invalid transition'; end if;
    if u.role='ADMIN' and u.account_status='ACTIVE' and (p_action='disable' or (p_action='role' and p_role<>'ADMIN'))
       and (select count(*) from public.user_profiles where role='ADMIN' and account_status='ACTIVE')<=1 then raise exception 'Last active administrator'; end if;
    update public.user_profiles set
        role=case when p_action='role' then p_role else role end,
        account_status=case when p_action='disable' then 'DISABLED' when p_action='enable' then 'ACTIVE' else account_status end,
        failed_sign_in_attempts=case when p_action='enable' then 0 else failed_sign_in_attempts end,
        locked_at=case when p_action='enable' then null else locked_at end,
        disabled_at=case when p_action='disable' then clock_timestamp() when p_action='enable' then null else disabled_at end,
        status_reason=case when p_action='disable' then 'Disabled by administrator' when p_action='enable' then null else status_reason end,
        updated_at=clock_timestamp() where id=p_user_id returning * into u;
    update public.app_sessions set revoked_at=clock_timestamp() where user_id=p_user_id and revoked_at is null;
    insert into public.login_history(user_id,actor_id,action,outcome) values(p_user_id,p_actor,upper(p_action),'SUCCESS');
    return to_jsonb(u);
end;
$$;

create function public.request_account_unlock(p_email text)
returns void language plpgsql security invoker set search_path='' as $$
declare u public.user_profiles;
begin
    select * into u from public.user_profiles where email=lower(p_email) and account_status='LOCKED';
    if found then
        insert into public.account_unlock_requests(email,user_id) values(u.email,u.id)
        on conflict (user_id) where status='PENDING' do nothing;
    end if;
end;
$$;

create function public.decide_account_unlock(p_actor uuid,p_request uuid,p_approve boolean,p_reason text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.account_unlock_requests; u public.user_profiles;
begin
    perform pg_advisory_xact_lock(14001);
    if not exists(select 1 from public.user_profiles where id=p_actor and role='ADMIN' and account_status='ACTIVE') then raise exception 'Administrator required'; end if;
    select * into r from public.account_unlock_requests where id=p_request for update;
    if not found or r.status<>'PENDING' then raise exception 'Unlock request missing or already decided'; end if;
    select * into u from public.user_profiles where id=r.user_id for update;
    if not found or u.account_status<>'LOCKED' or u.email<>r.email then raise exception 'Account is not eligible for unlock'; end if;
    if p_approve then
        update public.user_profiles set account_status='ACTIVE',failed_sign_in_attempts=0,locked_at=null,status_reason=null,updated_at=clock_timestamp()
        where id=u.id;
        update public.app_sessions set revoked_at=clock_timestamp() where user_id=u.id and revoked_at is null;
    end if;
    update public.account_unlock_requests set status=case when p_approve then 'APPROVED' else 'REJECTED' end,
        decided_by=p_actor,decision_reason=p_reason,decided_at=clock_timestamp() where id=p_request returning * into r;
    insert into public.login_history(user_id,actor_id,action,outcome) values(u.id,p_actor,'ACCOUNT_UNLOCK',r.status);
    return to_jsonb(r);
end;
$$;

create function public.decide_access_request(p_actor uuid,p_request uuid,p_approve boolean,p_user_id uuid default null,p_role text default null,p_reason text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.access_requests; u public.user_profiles;
begin
    perform pg_advisory_xact_lock(14001);
    if not exists(select 1 from public.user_profiles where id=p_actor and role='ADMIN' and account_status='ACTIVE') then raise exception 'Administrator required'; end if;
    select * into r from public.access_requests where id=p_request for update;
    if not found then raise exception 'Request missing'; end if;
    if r.status<>'PENDING' then raise exception 'Request already decided'; end if;
    if p_approve then
        select * into u from public.user_profiles where id=p_user_id for update;
        if not found or u.email<>r.email or u.account_status<>'DISABLED' or p_role is null or p_role not in ('AUDITOR','SUPERVISOR','ADMIN') then raise exception 'Invalid activation'; end if;
        update public.user_profiles set name=r.full_name,role=p_role,account_status='ACTIVE',failed_sign_in_attempts=0,
            status_reason=null,disabled_at=null,updated_at=clock_timestamp() where id=p_user_id;
    end if;
    update public.access_requests set status=case when p_approve then 'APPROVED' else 'REJECTED' end,
        assigned_role=case when p_approve then p_role else null end,user_id=case when p_approve then p_user_id else null end,
        decided_by=p_actor,decision_reason=p_reason,decided_at=clock_timestamp() where id=p_request returning * into r;
    insert into public.login_history(user_id,actor_id,action,outcome)
    values(case when p_approve then p_user_id else null end,p_actor,'ACCESS_REQUEST',r.status);
    return to_jsonb(r);
end;
$$;

alter table public.user_profiles enable row level security;
alter table public.login_history enable row level security;
alter table public.app_sessions enable row level security;
alter table public.access_requests enable row level security;
alter table public.account_unlock_requests enable row level security;
alter table public.auth_rate_limits enable row level security;
revoke all on public.auth_rate_limits from anon,authenticated;
grant select,insert,update,delete on public.auth_rate_limits to service_role;
revoke all on public.user_profiles,public.login_history,public.app_sessions,public.access_requests,public.account_unlock_requests from anon,authenticated;
grant select,insert,update on public.user_profiles,public.app_sessions,public.access_requests to service_role;
grant select,insert,update on public.account_unlock_requests to service_role;
grant select,insert on public.login_history to service_role;
revoke update,delete on public.login_history from service_role;
revoke all on function public.record_login(text,boolean),public.start_app_session(uuid,text,timestamptz),
    public.check_app_session(text),public.admin_user_action(uuid,uuid,text,text),
    public.decide_access_request(uuid,uuid,boolean,uuid,text,text) from public,anon,authenticated;
revoke all on function public.request_account_unlock(text),public.decide_account_unlock(uuid,uuid,boolean,text) from public,anon,authenticated;
grant execute on function public.record_login(text,boolean),public.start_app_session(uuid,text,timestamptz),
    public.check_app_session(text),public.admin_user_action(uuid,uuid,text,text),
    public.decide_access_request(uuid,uuid,boolean,uuid,text,text) to service_role;
grant execute on function public.request_account_unlock(text),public.decide_account_unlock(uuid,uuid,boolean,text) to service_role;
revoke all on function public.rotate_app_session(text,uuid,text,timestamptz),public.consume_auth_limit(text,integer,integer) from public,anon,authenticated;
grant execute on function public.rotate_app_session(text,uuid,text,timestamptz),public.consume_auth_limit(text,integer,integer) to service_role;
