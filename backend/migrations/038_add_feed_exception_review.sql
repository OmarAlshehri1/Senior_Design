-- Workflow is separate from immutable rule results. No risk/model changes.
create table public.feed_exception_reviews (
    transaction_id uuid primary key references public.feed_audit_results(transaction_id),
    team_id uuid references public.audit_teams(id),
    status text not null default 'OPEN' check(status in ('OPEN','IN_REVIEW','CLOSED')),
    resolution text check(resolution in ('CONFIRMED_EXCEPTION','DISMISSED')),
    version integer not null default 0 check(version>=0),
    check((status='CLOSED')=(resolution is not null))
);
create table public.feed_exception_events (
    id uuid primary key default gen_random_uuid(),
    transaction_id uuid not null references public.feed_exception_reviews(transaction_id),
    version integer not null,
    actor_id uuid not null references public.user_profiles(id),
    actor_name text not null, actor_role text not null,
    action text not null, note text not null,
    team_id uuid references public.audit_teams(id),
    status text not null, resolution text,
    created_at timestamptz not null default clock_timestamp(),
    unique(transaction_id,version)
);
alter table public.feed_exception_reviews enable row level security;
alter table public.feed_exception_events enable row level security;
revoke all on public.feed_exception_reviews,public.feed_exception_events from public,anon,authenticated,service_role;
create trigger immutable_feed_exception_event before update or delete on public.feed_exception_events
    for each row execute function public.protect_ingestion_evidence();

create function public.can_review_feed_exception(p_actor uuid,p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
    select exists(select 1 from public.feed_transactions t
      join public.ingestion_sources s on s.id=t.source_id and s.organization_id=t.organization_id
      join public.feed_audit_results r on r.transaction_id=t.id
      join public.user_profiles u on u.id=p_actor
      left join public.feed_exception_reviews w on w.transaction_id=t.id
      where t.id=p_id and public.can_review_feed(p_actor,t.source_id)
      and r.bundle @> '{"rule_results":[{"status":"FAILED"}]}'::jsonb
      and (u.role='ADMIN'
        or (w.team_id is null and u.role='SUPERVISOR')
        or exists(select 1 from public.audit_teams team where team.id=w.team_id and team.is_active and (
          (u.role='SUPERVISOR' and team.supervisor_id=u.id)
          or (u.role='AUDITOR' and exists(select 1 from public.audit_team_memberships m
            where m.team_id=team.id and m.user_id=u.id))))));
$$;
revoke all on function public.can_review_feed_exception(uuid,uuid) from public,anon,authenticated,service_role;

create function public.list_feed_exception_teams(p_actor uuid,p_source text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
    if not public.can_review_feed(p_actor,p_source) then raise exception 'Denied' using errcode='42501'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',t.id,'name',t.name) order by t.name,t.id),'[]'::jsonb) into result
      from public.feed_review_teams g join public.audit_teams t on t.id=g.team_id
      join public.user_profiles u on u.id=p_actor
      where g.source_id=p_source and t.is_active and (u.role='ADMIN' or (u.role='SUPERVISOR' and t.supervisor_id=p_actor));
    return result;
end;
$$;

create function public.read_feed_exceptions(p_actor uuid,p_source text,p_page integer default 1,
    p_page_size integer default 25,p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; total bigint;
begin
    if not public.can_review_feed(p_actor,p_source) then raise exception 'Denied' using errcode='42501'; end if;
    if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
        raise exception 'Invalid pagination' using errcode='22023'; end if;
    select count(*) into total from public.feed_transactions t where t.source_id=p_source
        and (p_id is null or t.id=p_id) and public.can_review_feed_exception(p_actor,t.id);
    select coalesce(jsonb_agg(x.doc order by x.received_at desc,x.id desc),'[]'::jsonb) into result from (
      select t.id,t.received_at,
        ((public.read_review_feed(p_actor,p_source,1,1,t.id)->'items'->0) || jsonb_build_object(
          'verified_approval_limit',r.bundle->>'verified_approval_limit',
          'review',jsonb_build_object('team_id',w.team_id,'status',coalesce(w.status,'OPEN'),
            'resolution',w.resolution,'version',coalesce(w.version,0)),
          'evidence',case when p_id is null then null else (
            select coalesce(jsonb_agg(jsonb_build_object('rule_key',v->>'rule_key','status',v->>'status',
              'metrics',(select coalesce(jsonb_object_agg(e.key,e.value),'{}'::jsonb)
                from jsonb_each(case when jsonb_typeof(v->'evidence')='object' then v->'evidence' else '{}'::jsonb end) e where e.key in (
                  'gate_reasons','missing_fields','historical_context_available','historical_transaction_count',
                  'window_total_amount','window_hours','vendor_registry_available','vendor_registered','vendor_active',
                  'approval_limit','current_payment_below_limit','calculation_basis','matching_transaction_count',
                  'same_actor','amount_exceeds_limit','excess_amount')))
              order by n),'[]'::jsonb)
            from jsonb_array_elements(r.bundle->'rule_results') with ordinality a(v,n)
          ) end,
          'event_count',(select count(*) from public.feed_exception_events e where e.transaction_id=t.id),
          'events',case when p_id is null then null else (
            select coalesce(jsonb_agg(to_jsonb(h) order by h.version desc),'[]'::jsonb) from (
              select e.version,e.actor_name,e.actor_role,e.action,e.note,e.team_id,e.status,e.resolution,e.created_at
              from public.feed_exception_events e where e.transaction_id=t.id order by e.version desc limit 100
            ) h
          ) end)) doc
      from public.feed_transactions t join public.feed_audit_results r on r.transaction_id=t.id
      left join public.feed_exception_reviews w on w.transaction_id=t.id
      where t.source_id=p_source and (p_id is null or t.id=p_id) and public.can_review_feed_exception(p_actor,t.id)
      order by t.received_at desc,t.id desc limit p_page_size offset ((p_page::bigint-1)*p_page_size)
    ) x;
    return jsonb_build_object('items',result,'total',total,'page',p_page,'page_size',p_page_size);
end;
$$;

create function public.act_on_feed_exception(p_actor uuid,p_source text,p_id uuid,p_action text,
    p_expected_version integer,p_note text,p_team uuid default null,p_resolution text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; w public.feed_exception_reviews; t public.feed_transactions;
begin
    -- Serialize creation and every subsequent action on the same immutable transaction.
    select * into t from public.feed_transactions where id=p_id and source_id=p_source for update;
    if not found or not public.can_review_feed_exception(p_actor,p_id) then raise exception 'Denied' using errcode='42501'; end if;
    select * into actor from public.user_profiles where id=p_actor;
    if p_action is null or p_action not in ('ASSIGN','START_REVIEW','NOTE','CLOSE','REOPEN')
       or p_note is null or length(btrim(p_note)) not between 1 and 2000
       or translate(p_note,E'\n\r\t','') ~ '[[:cntrl:]]'
       or p_expected_version is null or p_expected_version<0 then
        raise exception 'Invalid review action' using errcode='22023'; end if;
    if p_action in ('ASSIGN','CLOSE','REOPEN') and actor.role not in ('ADMIN','SUPERVISOR') then
        raise exception 'Manager required' using errcode='42501'; end if;
    if (p_action<>'ASSIGN' and p_team is not null) or (p_action<>'CLOSE' and p_resolution is not null) then
        raise exception 'Unexpected action fields' using errcode='22023'; end if;
    insert into public.feed_exception_reviews(transaction_id) values(p_id) on conflict do nothing;
    select * into w from public.feed_exception_reviews where transaction_id=p_id for update;
    if w.version<>p_expected_version then raise exception 'Stale review version' using errcode='23505'; end if;
    if p_action='ASSIGN' then
        if not exists(select 1 from public.feed_review_teams g join public.audit_teams team on team.id=g.team_id
            where g.source_id=p_source and team.id=p_team and team.is_active
            and (actor.role='ADMIN' or team.supervisor_id=p_actor)) then
            raise exception 'Team not eligible' using errcode='42501'; end if;
        if w.status='CLOSED' then raise exception 'Reopen first' using errcode='22023'; end if;
        w.team_id:=p_team;
    elsif p_action='START_REVIEW' then
        if w.status<>'OPEN' then raise exception 'Review must be open' using errcode='22023'; end if;
        w.status:='IN_REVIEW';
    elsif p_action='CLOSE' then
        if w.status='CLOSED' or p_resolution is null or p_resolution not in ('CONFIRMED_EXCEPTION','DISMISSED') then
            raise exception 'Invalid resolution' using errcode='22023'; end if;
        w.status:='CLOSED'; w.resolution:=p_resolution;
    elsif p_action='REOPEN' then
        if w.status<>'CLOSED' then raise exception 'Review must be closed' using errcode='22023'; end if;
        w.status:='OPEN'; w.resolution:=null;
    end if;
    update public.feed_exception_reviews set team_id=w.team_id,status=w.status,resolution=w.resolution,version=w.version+1 where transaction_id=p_id;
    insert into public.feed_exception_events(transaction_id,version,actor_id,actor_name,actor_role,action,note,team_id,status,resolution)
      values(p_id,w.version+1,p_actor,actor.name,actor.role,p_action,btrim(p_note),w.team_id,w.status,w.resolution);
    return jsonb_build_object('version',w.version+1,'status',w.status,'resolution',w.resolution,'team_id',w.team_id);
end;
$$;
revoke all on function public.list_feed_exception_teams(uuid,text),public.read_feed_exceptions(uuid,text,integer,integer,uuid),
    public.act_on_feed_exception(uuid,text,uuid,text,integer,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.list_feed_exception_teams(uuid,text),public.read_feed_exceptions(uuid,text,integer,integer,uuid),
    public.act_on_feed_exception(uuid,text,uuid,text,integer,text,uuid,text) to service_role;
