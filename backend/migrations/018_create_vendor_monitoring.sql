-- Vendor monitoring is an audit workflow; it never changes an ERP payment state.
alter table public.approved_vendors
    add column if not exists monitoring_status text not null default 'NORMAL'
        check (monitoring_status in ('NORMAL','WATCHLISTED','BLOCKED'));

create table public.vendor_monitoring_requests (
    id uuid primary key default gen_random_uuid(),
    vendor_id bigint not null references public.approved_vendors(id) on delete restrict,
    request_type text not null check (request_type in ('WATCHLIST','BLOCK')),
    status text not null default 'PENDING' check (status in ('PENDING','APPROVED','REJECTED')),
    reason text not null check (length(btrim(reason)) between 1 and 2000),
    requested_by uuid not null references public.user_profiles(id) on delete restrict,
    requested_at timestamptz not null default clock_timestamp(),
    requester_team_id uuid references public.audit_teams(id) on delete restrict,
    reviewed_by uuid references public.user_profiles(id) on delete restrict,
    reviewed_at timestamptz,
    decision_note text check (decision_note is null or length(btrim(decision_note)) between 1 and 2000),
    constraint vendor_request_review_state check (
        (status='PENDING' and reviewed_by is null and reviewed_at is null)
        or (status<>'PENDING' and reviewed_by is not null and reviewed_at is not null)
    )
);
create index vendor_monitoring_requests_queue_idx
    on public.vendor_monitoring_requests(request_type,status,requested_at,id);
create index vendor_monitoring_requests_vendor_idx
    on public.vendor_monitoring_requests(vendor_id,requested_at desc,id desc);

create table public.vendor_monitoring_history (
    id bigint generated always as identity primary key,
    vendor_id bigint not null references public.approved_vendors(id) on delete restrict,
    request_id uuid references public.vendor_monitoring_requests(id) on delete restrict,
    actor_id uuid not null references public.user_profiles(id) on delete restrict,
    actor_name text not null,
    actor_role text not null check (actor_role in ('AUDITOR','SUPERVISOR','ADMIN')),
    action text not null check (action in ('WATCHLIST_REQUESTED','WATCHLIST_APPROVED','WATCHLIST_REJECTED','WATCHLIST_REMOVED','BLOCK_REQUESTED','BLOCK_APPROVED','BLOCK_REJECTED','UNBLOCKED')),
    previous_status text not null check (previous_status in ('NORMAL','WATCHLISTED','BLOCKED')),
    new_status text not null check (new_status in ('NORMAL','WATCHLISTED','BLOCKED')),
    note text,
    created_at timestamptz not null default clock_timestamp()
);
create index vendor_monitoring_history_vendor_idx on public.vendor_monitoring_history(vendor_id,created_at desc,id desc);
create function public.prevent_vendor_monitoring_history_mutation()
returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Vendor monitoring history is append-only'; end;
$$;
create trigger vendor_monitoring_history_immutable before update or delete on public.vendor_monitoring_history
    for each row execute function public.prevent_vendor_monitoring_history_mutation();

alter table public.vendor_monitoring_requests enable row level security;
alter table public.vendor_monitoring_history enable row level security;
revoke all on public.vendor_monitoring_requests, public.vendor_monitoring_history from public,anon,authenticated;
grant select,insert,update on public.vendor_monitoring_requests to service_role;
grant select,insert on public.vendor_monitoring_history to service_role;
grant usage,select on sequence public.vendor_monitoring_history_id_seq to service_role;

create or replace function public.list_vendor_monitoring(p_actor uuid,p_page integer default 1,p_page_size integer default 25,p_status text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.user_profiles; items jsonb; total bigint;
begin
    select * into profile from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found or profile.role not in ('AUDITOR','SUPERVISOR','ADMIN') then raise exception 'Active account required' using errcode='42501'; end if;
    if p_page<1 or p_page_size<1 or p_page_size>100 or (p_status is not null and p_status not in ('NORMAL','WATCHLISTED','BLOCKED')) then raise exception 'Invalid vendor query' using errcode='22023'; end if;
    select count(*) into total from public.approved_vendors v where p_status is null or v.monitoring_status=p_status;
    select coalesce(jsonb_agg(x.item order by x.vendor_name),'[]'::jsonb) into items from (
        select v.vendor_name, jsonb_build_object('id',coalesce(v.vendor_id,v.id::text),'vendorId',v.vendor_id,'name',v.vendor_name,'monitoringStatus',v.monitoring_status,
          'riskLevel',coalesce(r.risk_level,'LOW'),'averageRiskScore',r.average_score,'transactionCount',coalesce(t.tx_count,0),
          'totalTransactionValue',coalesce(t.tx_total,0),'activeAlerts',coalesce(a.alert_count,0),'openCases',coalesce(c.case_count,0),
          'ruleViolations',coalesce(r.violation_count,0)) as item
        from public.approved_vendors v
        left join lateral (select count(*) tx_count,coalesce(sum(amount),0) tx_total from public.transactions tx where (v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))) ) t on true
        left join lateral (select count(*) alert_count from public.alerts al join public.transactions tx on tx.id=al.transaction_id where al.status='ACTIVE' and (profile.role='ADMIN' or public.can_access_team_alert(p_actor,al.id)) and ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) a on true
        left join lateral (select count(*) case_count from public.audit_cases ca join public.transactions tx on tx.id=ca.transaction_id where ca.status not in ('CLOSED','RESOLVED') and public.can_access_case(p_actor,ca.id) and ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) c on true
        left join lateral (select avg(latest.risk_score)::numeric(5,2) average_score,(array_agg(latest.risk_level order by latest.calculated_at desc))[1] risk_level,count(*) filter(where latest.risk_level in ('HIGH','MEDIUM')) violation_count from public.transactions tx join lateral (select rs.risk_score,rs.risk_level,rs.calculated_at from public.transaction_risk_scores rs where rs.transaction_id=tx.id order by rs.calculated_at desc,rs.id desc limit 1) latest on true where ((v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name))))) r on true
        where p_status is null or v.monitoring_status=p_status order by v.vendor_name limit p_page_size offset ((p_page-1)*p_page_size)
    ) x;
    return jsonb_build_object('items',items,'total',total,'page',p_page,'page_size',p_page_size);
end;
$$;

create or replace function public.get_vendor_monitoring_bundle(p_actor uuid,p_vendor text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.user_profiles; v public.approved_vendors; txs jsonb; history jsonb; requests jsonb; risk_history jsonb;
begin
    select * into profile from public.user_profiles where id=p_actor and account_status='ACTIVE';
    if not found then raise exception 'Active account required' using errcode='42501'; end if;
    select * into v from public.approved_vendors where vendor_id=p_vendor or id::text=p_vendor or lower(btrim(vendor_name))=lower(btrim(p_vendor)) limit 1;
    if not found then raise exception 'Vendor not found' using errcode='P0002'; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',tx.id,'timestamp',tx.transaction_timestamp,'amount',tx.amount,'currency',tx.currency,'vendor_name',tx.vendor_name,'risk_score',rs.risk_score,'risk_level',rs.risk_level,'alerts',coalesce(al.alerts,'[]'::jsonb),'cases',coalesce(ca.cases,'[]'::jsonb)) order by tx.transaction_timestamp desc),'[]'::jsonb)
      into txs from public.transactions tx left join lateral(select risk_score,risk_level from public.transaction_risk_scores where transaction_id=tx.id order by calculated_at desc limit 1) rs on true
      left join lateral(select jsonb_agg(jsonb_build_object('id',al.id,'severity',al.severity,'status',al.status,'created_at',al.created_at)) alerts from public.alerts al where al.transaction_id=tx.id and (profile.role='ADMIN' or public.can_access_team_alert(p_actor,al.id))) al on true
      left join lateral(select jsonb_agg(jsonb_build_object('id',ca.id,'case_number',ca.case_number,'status',ca.status,'priority',ca.priority)) cases from public.audit_cases ca where ca.transaction_id=tx.id and public.can_access_case(p_actor,ca.id)) ca on true
      where (v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name)));
    select coalesce(jsonb_agg(jsonb_build_object('transaction_id',rs.transaction_id,'risk_score',rs.risk_score,'risk_level',rs.risk_level,'scoring_version',rs.scoring_version,'calculated_at',rs.calculated_at) order by rs.calculated_at desc,rs.id desc),'[]'::jsonb)
      into risk_history from public.transaction_risk_scores rs join public.transactions tx on tx.id=rs.transaction_id
      where (v.vendor_id is not null and tx.vendor_id=v.vendor_id) or (v.vendor_id is null and lower(btrim(tx.vendor_name))=lower(btrim(v.vendor_name)));
    select coalesce(jsonb_agg(to_jsonb(h) order by h.created_at desc,h.id desc),'[]'::jsonb) into history
      from public.vendor_monitoring_history h where h.vendor_id=v.id and
        (profile.role='ADMIN' or h.actor_id=p_actor or exists(select 1 from public.vendor_monitoring_requests q
          where q.id=h.request_id and (q.requested_by=p_actor or profile.role='SUPERVISOR' and q.requester_team_id in
            (select t.id from public.audit_teams t where t.supervisor_id=p_actor and t.is_active))));
    select coalesce(jsonb_agg(to_jsonb(q) order by q.requested_at desc),'[]'::jsonb) into requests from public.vendor_monitoring_requests q where q.vendor_id=v.id and
      (profile.role='ADMIN' or q.requested_by=p_actor or profile.role='SUPERVISOR' and q.requester_team_id in (select t.id from public.audit_teams t where t.supervisor_id=p_actor and t.is_active));
    return jsonb_build_object('vendor',jsonb_build_object('id',coalesce(v.vendor_id,v.id::text),'vendorId',v.vendor_id,'name',v.vendor_name,'monitoringStatus',v.monitoring_status,'active',v.is_active),'transactions',txs,'risk_history',risk_history,'history',history,'requests',requests);
end;
$$;

create or replace function public.request_vendor_monitoring(p_actor uuid,p_vendor text,p_type text,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.user_profiles; v public.approved_vendors; team uuid; req public.vendor_monitoring_requests; old_status text; action_name text;
begin
    select * into profile from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found or not ((p_type='WATCHLIST' and profile.role='AUDITOR') or (p_type='BLOCK' and profile.role='SUPERVISOR')) then raise exception 'Forbidden' using errcode='42501'; end if;
    if length(btrim(coalesce(p_reason,''))) not between 1 and 2000 then raise exception 'Invalid request reason' using errcode='22023'; end if;
    select * into v from public.approved_vendors where vendor_id=p_vendor or id::text=p_vendor limit 1 for update;
    if not found then raise exception 'Vendor not found' using errcode='P0002'; end if;
    if (p_type='WATCHLIST' and v.monitoring_status<>'NORMAL') or (p_type='BLOCK' and v.monitoring_status='BLOCKED') then raise exception 'Vendor state does not allow this request' using errcode='22023'; end if;
    if exists(select 1 from public.vendor_monitoring_requests where vendor_id=v.id and status='PENDING') then raise exception 'Pending request exists' using errcode='23505'; end if;
    if profile.role='SUPERVISOR' then
      select id into team from public.audit_teams where supervisor_id=p_actor and is_active;
    else
      select team_id into team from public.audit_team_memberships where user_id=p_actor;
    end if;
    if team is null then raise exception 'Active team required' using errcode='42501'; end if;
    old_status:=v.monitoring_status;
    insert into public.vendor_monitoring_requests(vendor_id,request_type,reason,requested_by,requester_team_id) values(v.id,p_type,btrim(p_reason),p_actor,team) returning * into req;
    action_name:=case when p_type='WATCHLIST' then 'WATCHLIST_REQUESTED' else 'BLOCK_REQUESTED' end;
    insert into public.vendor_monitoring_history(vendor_id,request_id,actor_id,actor_name,actor_role,action,previous_status,new_status,note)
      values(v.id,req.id,p_actor,profile.name,profile.role,action_name,old_status,old_status,btrim(p_reason));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
      values(p_actor,profile.name,profile.role,action_name,'VENDOR',coalesce(v.vendor_id,v.id::text),'SUCCESS',
        jsonb_build_object('request_id',req.id,'request_type',p_type,'reason',btrim(p_reason),'monitoring_status',old_status));
    if p_type='WATCHLIST' then
      insert into public.user_notifications(recipient_id,event_key,type,title,message,resource_type,resource_id,priority)
        select t.supervisor_id,'vendor-request:'||req.id::text||':submitted','VENDOR_WATCHLIST_REQUEST','Vendor watchlist review requested',
          coalesce(v.vendor_name,v.vendor_id),'VENDOR',coalesce(v.vendor_id,v.id::text),'NORMAL'
        from public.audit_teams t where t.is_active and t.id=team
        on conflict(recipient_id,event_key) do nothing;
    else
      insert into public.user_notifications(recipient_id,event_key,type,title,message,resource_type,resource_id,priority)
        select u.id,'vendor-request:'||req.id::text||':submitted','VENDOR_BLOCK_REQUEST','Vendor block request submitted',
          coalesce(v.vendor_name,v.vendor_id),'VENDOR',coalesce(v.vendor_id,v.id::text),'HIGH'
        from public.user_profiles u where u.role='ADMIN' and u.account_status='ACTIVE'
        on conflict(recipient_id,event_key) do nothing;
    end if;
    return jsonb_build_object('request',to_jsonb(req),'vendor_status',old_status);
end;
$$;

create or replace function public.decide_vendor_monitoring(p_actor uuid,p_request uuid,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.user_profiles; req public.vendor_monitoring_requests; v public.approved_vendors; target_role text; next_status text; action_name text;
begin
    select * into profile from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found then raise exception 'Active account required' using errcode='42501'; end if;
    select * into req from public.vendor_monitoring_requests where id=p_request for update;
    if not found or req.status<>'PENDING' then raise exception 'Pending request not found' using errcode='P0002'; end if;
    if (req.request_type='WATCHLIST' and profile.role<>'SUPERVISOR') or (req.request_type='BLOCK' and profile.role<>'ADMIN') then raise exception 'Forbidden' using errcode='42501'; end if;
    if req.request_type='WATCHLIST' and not exists(select 1 from public.audit_teams t where t.supervisor_id=p_actor and t.is_active and t.id=req.requester_team_id) then raise exception 'Request outside supervisor team' using errcode='42501'; end if;
    select * into v from public.approved_vendors where id=req.vendor_id for update;
    if p_approve and ((req.request_type='WATCHLIST' and v.monitoring_status<>'NORMAL') or (req.request_type='BLOCK' and v.monitoring_status='BLOCKED')) then raise exception 'Vendor state changed while request was pending' using errcode='40001'; end if;
    target_role:=case when p_approve and req.request_type='WATCHLIST' then 'WATCHLISTED' when p_approve then 'BLOCKED' else v.monitoring_status end;
    action_name:=case when req.request_type='WATCHLIST' then (case when p_approve then 'WATCHLIST_APPROVED' else 'WATCHLIST_REJECTED' end) else (case when p_approve then 'BLOCK_APPROVED' else 'BLOCK_REJECTED' end) end;
    update public.vendor_monitoring_requests set status=case when p_approve then 'APPROVED' else 'REJECTED' end,reviewed_by=p_actor,reviewed_at=clock_timestamp(),decision_note=nullif(btrim(p_note),'') where id=req.id returning * into req;
    if p_approve then update public.approved_vendors set monitoring_status=target_role,updated_at=clock_timestamp() where id=v.id; end if;
    insert into public.vendor_monitoring_history(vendor_id,request_id,actor_id,actor_name,actor_role,action,previous_status,new_status,note)
      values(v.id,req.id,p_actor,profile.name,profile.role,action_name,v.monitoring_status,target_role,coalesce(nullif(btrim(p_note),''),req.reason));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
      values(p_actor,profile.name,profile.role,action_name,'VENDOR',coalesce(v.vendor_id,v.id::text),'SUCCESS',
        jsonb_build_object('request_id',req.id,'request_type',req.request_type,'approved',p_approve,'previous_status',v.monitoring_status,'new_status',target_role));
    if p_approve then
      perform public.enqueue_user_notification(req.requested_by,'vendor-request:'||req.id::text||':approved',
        case when req.request_type='WATCHLIST' then 'VENDOR_WATCHLIST_APPROVED' else 'VENDOR_BLOCKED' end,
        case when req.request_type='WATCHLIST' then 'Vendor watchlist request approved' else 'Vendor monitoring block approved' end,
        coalesce(v.vendor_name,v.vendor_id),'VENDOR',coalesce(v.vendor_id,v.id::text),'HIGH');
    end if;
    return jsonb_build_object('request',to_jsonb(req),'monitoring_status',target_role);
end;
$$;

create or replace function public.change_vendor_monitoring(p_actor uuid,p_vendor text,p_action text,p_note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare profile public.user_profiles; v public.approved_vendors; next_status text; action_name text;
begin
    select * into profile from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
    if not found then raise exception 'Active account required' using errcode='42501'; end if;
    if (p_action='UNBLOCK' and profile.role<>'ADMIN') or (p_action='REMOVE_WATCHLIST' and profile.role not in ('SUPERVISOR','ADMIN')) then raise exception 'Forbidden' using errcode='42501'; end if;
    select * into v from public.approved_vendors where vendor_id=p_vendor or id::text=p_vendor limit 1 for update;
    if not found then raise exception 'Vendor not found' using errcode='P0002'; end if;
    if p_action='UNBLOCK' and v.monitoring_status<>'BLOCKED' then raise exception 'Vendor is not blocked' using errcode='22023'; end if;
    if p_action='REMOVE_WATCHLIST' and (v.monitoring_status<>'WATCHLISTED' or profile.role='SUPERVISOR' and not exists(
      select 1 from public.vendor_monitoring_history h join public.vendor_monitoring_requests q on q.id=h.request_id
      join public.audit_teams t on t.id=q.requester_team_id
      where h.vendor_id=v.id and h.action='WATCHLIST_APPROVED' and t.supervisor_id=p_actor and t.is_active
        and h.id=(select latest.id from public.vendor_monitoring_history latest where latest.vendor_id=v.id and latest.action='WATCHLIST_APPROVED' order by latest.created_at desc,latest.id desc limit 1)
    )) then raise exception 'Vendor is outside supervisor scope' using errcode='42501'; end if;
    next_status:='NORMAL'; action_name:=case when p_action='UNBLOCK' then 'UNBLOCKED' else 'WATCHLIST_REMOVED' end;
    update public.approved_vendors set monitoring_status=next_status,updated_at=clock_timestamp() where id=v.id;
    insert into public.vendor_monitoring_history(vendor_id,actor_id,actor_name,actor_role,action,previous_status,new_status,note)
      values(v.id,p_actor,profile.name,profile.role,action_name,v.monitoring_status,next_status,nullif(btrim(p_note),''));
    insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
      values(p_actor,profile.name,profile.role,action_name,'VENDOR',coalesce(v.vendor_id,v.id::text),'SUCCESS',
        jsonb_build_object('previous_status',v.monitoring_status,'new_status',next_status,'note',nullif(btrim(p_note),'')));
    return jsonb_build_object('vendor_id',coalesce(v.vendor_id,v.id::text),'monitoring_status',next_status);
end;
$$;

revoke all on function public.list_vendor_monitoring(uuid,integer,integer,text),public.get_vendor_monitoring_bundle(uuid,text),public.request_vendor_monitoring(uuid,text,text,text),public.decide_vendor_monitoring(uuid,uuid,boolean,text),public.change_vendor_monitoring(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.list_vendor_monitoring(uuid,integer,integer,text),public.get_vendor_monitoring_bundle(uuid,text),public.request_vendor_monitoring(uuid,text,text,text),public.decide_vendor_monitoring(uuid,uuid,boolean,text),public.change_vendor_monitoring(uuid,text,text,text) to service_role;
