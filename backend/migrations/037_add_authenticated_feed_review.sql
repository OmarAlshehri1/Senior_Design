-- Explicit source assignments: no global role or organization UUID implies access.
create table public.feed_review_users (
    source_id text not null references public.ingestion_sources(id),
    user_id uuid not null references public.user_profiles(id),
    primary key(source_id,user_id)
);
create table public.feed_review_teams (
    source_id text not null references public.ingestion_sources(id),
    team_id uuid not null references public.audit_teams(id),
    primary key(source_id,team_id)
);
alter table public.feed_review_users enable row level security;
alter table public.feed_review_teams enable row level security;
revoke all on public.feed_review_users,public.feed_review_teams from public,anon,authenticated,service_role;

create function public.can_review_feed(p_actor uuid,p_source text)
returns boolean language sql stable security definer set search_path='' as $$
    select exists (
        select 1 from public.user_profiles u
        where u.id=p_actor and u.account_status='ACTIVE' and u.role in ('ADMIN','SUPERVISOR','AUDITOR')
        and (exists(select 1 from public.feed_review_users g where g.source_id=p_source and g.user_id=u.id)
          or exists(select 1 from public.feed_review_teams g join public.audit_teams t on t.id=g.team_id
            where g.source_id=p_source and t.is_active and (
                (u.role='SUPERVISOR' and t.supervisor_id=u.id)
                or (u.role='AUDITOR' and exists(select 1 from public.audit_team_memberships m
                    where m.team_id=t.id and m.user_id=u.id)))))
    );
$$;
revoke all on function public.can_review_feed(uuid,text) from public,anon,authenticated,service_role;

create function public.list_review_feed_sources(p_actor uuid)
returns jsonb language sql stable security definer set search_path='' as $$
    select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'active',s.active) order by s.id),'[]'::jsonb)
    from public.ingestion_sources s where public.can_review_feed(p_actor,s.id);
$$;

create function public.read_review_feed(p_actor uuid,p_source text,p_page integer default 1,
    p_page_size integer default 25,p_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb; total bigint;
begin
    if not public.can_review_feed(p_actor,p_source) then
        raise exception 'Feed access denied' using errcode='42501';
    end if;
    if p_page is null or p_page not between 1 and 1000000 or p_page_size is null or p_page_size not between 1 and 100 then
        raise exception 'Invalid pagination' using errcode='22023';
    end if;
    select count(*) into total from public.feed_transactions t
        join public.ingestion_sources s on s.id=t.source_id and s.organization_id=t.organization_id
        where t.source_id=p_source and (p_id is null or t.id=p_id);
    select coalesce(jsonb_agg(x.document order by x.received_at desc,x.id desc),'[]'::jsonb) into items from (
        select t.id,t.received_at,jsonb_build_object(
            'id',t.id,'source_id',t.source_id,'record_id',t.record_id,
            'amount',t.amount::text,'currency',t.currency,'vendor_name',t.canonical->>'vendor_name',
            'invoice_number',t.invoice_number,'source_date',t.canonical->>'source_date',
            'transaction_timestamp',t.transaction_timestamp,'received_at',t.received_at,
            'time_basis',r.bundle->>'time_basis','processing_status',j.status,
            'evaluated_at',r.evaluated_at,'coverage',r.bundle->'coverage',
            'rule_score',r.bundle->'rule_score','risk_score',r.bundle->'risk_score',
            'risk_level',r.bundle->>'risk_level','anomaly_status',r.bundle->'anomaly'->>'status',
            'unscored_reason',r.bundle->'anomaly'->>'reason',
            'rules',case when p_id is null then null else (
                select coalesce(jsonb_agg(jsonb_build_object('rule_key',v->>'rule_key',
                    'status',v->>'status','detail',v->>'detail',
                    'gate_reasons',v->'evidence'->'gate_reasons') order by n),'[]'::jsonb)
                from jsonb_array_elements(r.bundle->'rule_results') with ordinality a(v,n)
            ) end
        ) document
        from public.feed_transactions t
        join public.ingestion_sources s on s.id=t.source_id and s.organization_id=t.organization_id
        left join public.feed_audit_jobs j on j.transaction_id=t.id
        left join public.feed_audit_results r on r.transaction_id=t.id
        where t.source_id=p_source and (p_id is null or t.id=p_id)
        order by t.received_at desc,t.id desc limit p_page_size offset ((p_page::bigint-1)*p_page_size)
    ) x;
    return jsonb_build_object('items',items,'total',total,'page',p_page,'page_size',p_page_size);
end;
$$;
revoke all on function public.list_review_feed_sources(uuid),public.read_review_feed(uuid,text,integer,integer,uuid)
    from public,anon,authenticated,service_role;
grant execute on function public.list_review_feed_sources(uuid),public.read_review_feed(uuid,text,integer,integer,uuid)
    to service_role;
