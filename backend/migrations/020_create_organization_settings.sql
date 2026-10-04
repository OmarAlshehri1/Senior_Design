create table public.organization_settings (
    singleton boolean primary key default true check (singleton),
    organization_name text not null check (length(btrim(organization_name)) between 2 and 120),
    updated_by uuid references public.user_profiles(id) on delete set null,
    updated_at timestamptz not null default clock_timestamp()
);

insert into public.organization_settings(singleton, organization_name)
values (true, 'Retail Store Operations');

alter table public.organization_settings enable row level security;
revoke all on public.organization_settings from public, anon, authenticated, service_role;

create or replace function public.get_organization_settings(p_actor uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.user_profiles; setting_row public.organization_settings;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found or actor.role not in ('AUDITOR','SUPERVISOR','ADMIN') then
        raise exception 'Settings access denied' using errcode='42501';
    end if;
    select * into setting_row from public.organization_settings where singleton=true;
    if not found then raise exception 'Organization settings unavailable'; end if;
    return jsonb_build_object('organization_name',setting_row.organization_name,'updated_at',setting_row.updated_at);
end;
$$;

create or replace function public.update_organization_name(p_actor uuid,p_organization_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.user_profiles; setting_row public.organization_settings; next_name text; previous_name text;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role <> 'ADMIN' then
        raise exception 'Settings update denied' using errcode='42501';
    end if;
    next_name:=btrim(coalesce(p_organization_name,''));
    if length(next_name) not between 2 and 120 then
        raise exception 'Organization name must contain 2 to 120 characters' using errcode='22023';
    end if;

    select * into setting_row from public.organization_settings where singleton=true for update;
    if not found then raise exception 'Organization settings unavailable'; end if;
    previous_name := setting_row.organization_name;
    if setting_row.organization_name=next_name then
        return jsonb_build_object('organization_name',setting_row.organization_name,'updated_at',setting_row.updated_at);
    end if;

    update public.organization_settings
       set organization_name=next_name, updated_by=actor.id, updated_at=clock_timestamp()
     where singleton=true returning * into setting_row;

    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
    values(actor.id,actor.name,actor.role,'ORGANIZATION_SETTINGS_UPDATED','SETTINGS','organization','SUCCESS',
        jsonb_build_object('setting','organization_name','old_value',previous_name,'new_value',next_name));

    return jsonb_build_object('organization_name',setting_row.organization_name,'updated_at',setting_row.updated_at);
end;
$$;

revoke all on function public.get_organization_settings(uuid),
    public.update_organization_name(uuid,text) from public,anon,authenticated;
grant execute on function public.get_organization_settings(uuid),
    public.update_organization_name(uuid,text) to service_role;
