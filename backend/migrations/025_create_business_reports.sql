-- Immutable business memoranda. Apply only after owner review; no live data updates.
create table public.business_reports (
    id uuid primary key default gen_random_uuid(),
    created_by uuid not null references public.user_profiles(id),
    team_id uuid references public.audit_teams(id),
    scope text not null check (scope in ('ORGANIZATION','TEAM')),
    period_start timestamptz not null,
    period_end timestamptz not null,
    created_at timestamptz not null default clock_timestamp(),
    document jsonb not null check (jsonb_typeof(document)='object'),
    check ((scope='ORGANIZATION' and team_id is null) or (scope='TEAM' and team_id is not null)),
    check (period_end-period_start=interval '24 hours'),
    check (period_start=date_trunc('day',period_start at time zone 'UTC') at time zone 'UTC')
);
create index business_reports_created_idx on public.business_reports(created_at desc,id);
alter table public.business_reports enable row level security;
revoke all on public.business_reports from public,anon,authenticated,service_role;

create function public.prevent_business_report_mutation() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'Business report revisions are immutable'; end; $$;
create trigger business_reports_immutable before update or delete on public.business_reports
for each row execute function public.prevent_business_report_mutation();

-- One SQL statement supplies a consistent evidence snapshot. Never read metadata/ground_truth.
-- NULL start selects the latest dated transaction in the caller's report cohort.
create function public.get_business_report_source(p_actor uuid,p_start timestamptz default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; team public.audit_teams; result jsonb;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found or actor.role not in ('ADMIN','SUPERVISOR') then
        raise exception 'Report access denied' using errcode='42501';
    end if;
    if actor.role='SUPERVISOR' then
        select * into team from public.audit_teams where supervisor_id=p_actor and is_active;
        if not found then raise exception 'Active supervising team required' using errcode='42501'; end if;
    end if;
    if p_start is not null and p_start<>date_trunc('day',p_start at time zone 'UTC') at time zone 'UTC' then
        raise exception 'UTC midnight required' using errcode='22023';
    end if;
    with cohort as materialized (
        select t.* from public.transactions t where actor.role='ADMIN' or exists (
            select 1 from public.alerts a join public.alert_assignments aa on aa.alert_id=a.id
            where a.transaction_id=t.id and aa.team_id=team.id
        ) or exists (select 1 from public.audit_cases c where c.transaction_id=t.id and c.team_id=team.id)
    ), bounds as (
        select coalesce(p_start,date_trunc('day',max(transaction_timestamp) at time zone 'UTC') at time zone 'UTC') as start_at from cohort
    ), period_rows as materialized (
        select t.* from cohort t cross join bounds b
        where t.transaction_timestamp>=b.start_at and t.transaction_timestamp<b.start_at+interval '24 hours'
    ), tx as (
        select t.id,t.transaction_timestamp as timestamp,t.vendor_name,t.amount,t.currency,
            t.completeness_status as data_quality_status,t.missing_fields,
            e.id as evaluation_id,e.evaluation_version,e.evaluated_at,
            coalesce(e.rule_results,'[]'::jsonb) as rule_results,
            r.id as risk_snapshot_id,r.scoring_version,r.rule_evaluation_version,r.anomaly_model_version,
            r.calculated_at,r.rule_score,r.ai_score,r.risk_score,r.risk_level
        from period_rows t
        left join lateral (select * from public.transaction_evaluations e where e.transaction_id=t.id
            order by e.evaluated_at desc,e.id desc limit 1) e on true
        left join lateral (select * from public.transaction_risk_scores r where r.transaction_id=t.id
            order by r.calculated_at desc,r.id desc limit 1) r on true
    ), scoped_alerts as (
        select a.id,a.transaction_id,a.severity,a.status,a.created_at,a.reviewed_at
        from public.alerts a join period_rows t on t.id=a.transaction_id
        where actor.role='ADMIN' or exists(select 1 from public.alert_assignments aa where aa.alert_id=a.id and aa.team_id=team.id)
    ), scoped_cases as (
        select c.id,c.case_number,c.transaction_id,c.status,c.priority,c.sla_status,c.sla_due_at,
            c.created_at,c.updated_at,c.closed_at,c.resolution_outcome
        from public.audit_cases c join period_rows t on t.id=c.transaction_id
        where actor.role='ADMIN' or c.team_id=team.id
    )
    select jsonb_build_object(
        'organization_name',(select organization_name from public.organization_settings where singleton),
        'prepared_by',jsonb_build_object('id',actor.id,'name',actor.name,'role',actor.role),
        'scope',case when actor.role='ADMIN' then 'ORGANIZATION' else 'TEAM' end,
        'team_id',team.id,'team_name',team.name,'as_of',statement_timestamp(),
        'period_start',b.start_at,'period_end',b.start_at+interval '24 hours',
        'undated_in_scope',(select count(*) from cohort where transaction_timestamp is null),
        'transactions',coalesce((select jsonb_agg(to_jsonb(tx) order by tx.timestamp,tx.id) from tx),'[]'::jsonb),
        'alerts',coalesce((select jsonb_agg(to_jsonb(a) order by a.id) from scoped_alerts a),'[]'::jsonb),
        'cases',coalesce((select jsonb_agg(to_jsonb(c) order by c.id) from scoped_cases c),'[]'::jsonb)
    ) into result from bounds b;
    if result->>'organization_name' is null then raise exception 'Organization settings unavailable'; end if;
    if result->>'period_start' is null then raise exception 'No dated transactions in scope' using errcode='22023'; end if;
    return result;
end; $$;

-- Historical team snapshots remain readable only while their evidence is still in scope.
create function public.can_read_business_report(p_actor uuid,p_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
    select exists(select 1 from public.user_profiles u join public.business_reports b on b.id=p_id
        where u.id=p_actor and u.account_status='ACTIVE' and (
            u.role='ADMIN' or (u.role='SUPERVISOR' and b.scope='TEAM'
            and exists(select 1 from public.audit_teams t where t.id=b.team_id and t.supervisor_id=u.id and t.is_active)
            and not exists(select 1 from jsonb_array_elements(b.document->'evidence'->'transactions') x
                where not exists(select 1 from public.alerts a join public.alert_assignments aa on aa.alert_id=a.id
                    where a.transaction_id=x->>'id' and aa.team_id=b.team_id)
                and not exists(select 1 from public.audit_cases c where c.transaction_id=x->>'id' and c.team_id=b.team_id))
            and not exists(select 1 from jsonb_array_elements(b.document->'evidence'->'alerts') x
                where not exists(select 1 from public.alert_assignments aa where aa.alert_id=x->>'id' and aa.team_id=b.team_id))
            and not exists(select 1 from jsonb_array_elements(b.document->'evidence'->'cases') x
                where not exists(select 1 from public.audit_cases c where c.id::text=x->>'id' and c.team_id=b.team_id))
        )))
$$;

create function public.save_business_report(p_actor uuid,p_document jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; team uuid; row public.business_reports;
begin
    select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or actor.role not in ('ADMIN','SUPERVISOR') then raise exception 'Report access denied' using errcode='42501'; end if;
    if actor.role='SUPERVISOR' then
        select id into team from public.audit_teams where supervisor_id=p_actor and is_active for share;
        if team is null then raise exception 'Team required' using errcode='42501'; end if;
    end if;
    if p_document->>'scope' is distinct from (case when team is null then 'ORGANIZATION' else 'TEAM' end)
        or p_document->>'team_id' is distinct from team::text
        or p_document->>'approval_status' is distinct from 'DRAFT'
        or p_document->>'schema_version' is distinct from '2.0.0'
        or jsonb_typeof(p_document->'evidence'->'transactions') is distinct from 'array'
        or jsonb_typeof(p_document->'evidence'->'alerts') is distinct from 'array'
        or jsonb_typeof(p_document->'evidence'->'cases') is distinct from 'array' then
        raise exception 'Invalid report snapshot' using errcode='22023';
    end if;
    insert into public.business_reports(created_by,scope,team_id,period_start,period_end,document)
        values(p_actor,p_document->>'scope',team,(p_document->>'period_start')::timestamptz,
            (p_document->>'period_end')::timestamptz,p_document) returning * into row;
    if not public.can_read_business_report(p_actor,row.id) then raise exception 'Evidence scope changed' using errcode='42501'; end if;
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
        values(actor.id,actor.name,actor.role,'BUSINESS_REPORT_CREATED','REPORT',row.id::text,'SUCCESS',
            jsonb_build_object('team_id',team,'scope',row.scope,'period_start',row.period_start,'period_end',row.period_end));
    return to_jsonb(row);
end; $$;

create function public.read_business_reports(p_actor uuid,p_id uuid default null,p_page integer default 1,p_page_size integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
    if not exists(select 1 from public.user_profiles where id=p_actor and account_status='ACTIVE' and role in ('ADMIN','SUPERVISOR')) then
        raise exception 'Report access denied' using errcode='42501'; end if;
    if p_page<1 or p_page_size<1 or p_page_size>100 then raise exception 'Invalid pagination' using errcode='22023'; end if;
    if p_id is not null then return (select to_jsonb(b) from public.business_reports b where b.id=p_id and public.can_read_business_report(p_actor,b.id)); end if;
    return (with visible as materialized (
        select b.* from public.business_reports b where public.can_read_business_report(p_actor,b.id)
    ), page_rows as (
        select id,scope,team_id,period_start,period_end,created_at,document->>'title' as title,
            document->>'organization_name' as organization_name,document->>'data_context' as data_context
        from visible order by created_at desc,id limit p_page_size offset (p_page-1)*p_page_size
    ) select jsonb_build_object('items',coalesce((select jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id) from page_rows p),'[]'::jsonb),
        'total',(select count(*) from visible),'page',p_page,'page_size',p_page_size));
end; $$;

revoke all on function public.get_business_report_source(uuid,timestamptz),public.can_read_business_report(uuid,uuid),
    public.save_business_report(uuid,jsonb),public.read_business_reports(uuid,uuid,integer,integer) from public,anon,authenticated;
grant execute on function public.get_business_report_source(uuid,timestamptz),public.can_read_business_report(uuid,uuid),
    public.save_business_report(uuid,jsonb),public.read_business_reports(uuid,uuid,integer,integer) to service_role;
