-- LOCAL REVIEW PROPOSAL ONLY. Not part of the approved registry/revisions wrapper.
-- Materialize as a NEW migration with `supabase migration new` only after review.
-- Existing CLEAN evidence and existing RPC signatures are preserved.
alter table public.case_evidence drop constraint case_evidence_scan_status_check;
alter table public.case_evidence add constraint case_evidence_scan_status_check
 check(scan_status in ('PENDING','ERROR','INFECTED','CLEAN'));
alter table public.case_evidence add column content_sha256 text
 check(content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$');

-- Preserve append-only metadata and terminal evidence. Only pending/error scan
-- disposition may change; existing CLEAN records remain completely immutable.
create function public.protect_case_evidence_scan() returns trigger
language plpgsql set search_path='' as $$
begin
 if tg_op<>'UPDATE' then raise exception 'Case evidence is append-only'; end if;
 if old.scan_status not in ('PENDING','ERROR') or new.scan_status not in ('ERROR','INFECTED','CLEAN')
 or (to_jsonb(new)-'scan_status') is distinct from (to_jsonb(old)-'scan_status')
 then raise exception 'Case evidence metadata is immutable'; end if;
 return new;
end $$;
drop trigger case_evidence_immutable on public.case_evidence;
create trigger case_evidence_immutable before update or delete on public.case_evidence
 for each row execute function public.protect_case_evidence_scan();
revoke all on function public.protect_case_evidence_scan() from public,anon,authenticated,service_role;

create function public.reserve_case_evidence(p_actor uuid,p_case uuid,p_file_name text,p_file_size bigint,
 p_mime_type text,p_category text,p_description text,p_storage_key text,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; case_row public.audit_cases; item public.case_evidence;
begin
 select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
 if not found or actor.role not in ('AUDITOR','SUPERVISOR','ADMIN') or not public.can_access_case(p_actor,p_case)
 then raise exception 'Evidence denied' using errcode='42501'; end if;
 select * into case_row from public.audit_cases where id=p_case for update;
 if not found then raise exception 'Case not found' using errcode='P0002'; end if;
 if case_row.status='CLOSED' then raise exception 'Closed case' using errcode='23505'; end if;
 if p_file_size is null or p_file_size not between 1 and 5242880
 or p_file_name is null or length(p_file_name) not between 1 and 240
 or p_mime_type is null or p_mime_type not in ('application/pdf','image/png','image/jpeg')
 or p_category is null or p_category not in ('DOCUMENT','SCREENSHOT','INVOICE','APPROVAL_RECORD','OTHER')
 or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
 or p_storage_key is null or p_storage_key !~ ('^quarantine/'||p_case::text||'/[0-9a-f-]{36}\.(pdf|png|jpg)$')
 then raise exception 'Invalid evidence' using errcode='22023'; end if;
 -- Atomic local reservation budget: 256 MiB/project, at most 100 files/case.
 -- All statuses count; missing objects/errors never silently release reservations.
 perform pg_advisory_xact_lock(413414,261);
 if (select coalesce(sum(file_size),0) from public.case_evidence)+p_file_size>268435456
 or (select count(*) from public.case_evidence where case_id=p_case)>=100
 then raise exception 'Evidence quota reached' using errcode='22023'; end if;
 insert into public.case_evidence(case_id,file_name,file_size,mime_type,category,description,storage_key,
 scan_status,uploaded_by,content_sha256)
 values(p_case,p_file_name,p_file_size,p_mime_type,p_category,nullif(btrim(p_description),''),p_storage_key,
 'PENDING',p_actor,p_sha256) returning * into item;
 insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
 values(p_case,p_actor,actor.name,actor.role,'EVIDENCE_ADDED',jsonb_build_object('evidence_id',item.id,'scan_status','PENDING'));
 insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
 values(p_actor,actor.name,actor.role,'EVIDENCE_ADDED','CASE',p_case::text,'SUCCESS',
 jsonb_build_object('evidence_id',item.id,'scan_status','PENDING'));
 return to_jsonb(item);
end $$;

create function public.read_case_evidence_for_scan(p_actor uuid,p_case uuid,p_evidence uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item public.case_evidence;
begin
 if not public.can_access_case(p_actor,p_case) then raise exception 'Denied' using errcode='42501'; end if;
 if exists(select 1 from public.audit_cases where id=p_case and status='CLOSED')
 then raise exception 'Closed case' using errcode='23505'; end if;
 select * into item from public.case_evidence where id=p_evidence and case_id=p_case;
 if not found then raise exception 'Evidence not found' using errcode='P0002'; end if;
 return to_jsonb(item);
end $$;

create function public.finish_case_evidence_scan(p_actor uuid,p_case uuid,p_evidence uuid,p_status text,p_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor public.user_profiles; item public.case_evidence;
begin
 select * into actor from public.user_profiles where id=p_actor and account_status='ACTIVE' for share;
 if not found or actor.role not in ('AUDITOR','SUPERVISOR','ADMIN') or not public.can_access_case(p_actor,p_case)
 then raise exception 'Denied' using errcode='42501'; end if;
 if p_status is null or p_status not in ('CLEAN','ERROR','INFECTED') then raise exception 'Invalid scan status' using errcode='22023'; end if;
 select * into item from public.case_evidence where id=p_evidence and case_id=p_case for update;
 if not found then raise exception 'Evidence not found' using errcode='P0002'; end if;
 -- A stale failed scan must never demote a completed CLEAN result. A detected
 -- infection is terminal; no retry can publish an infected object's bytes.
 if item.scan_status in ('CLEAN','INFECTED') then return to_jsonb(item); end if;
 if p_sha256 is null or item.content_sha256 is distinct from p_sha256
 then raise exception 'Evidence digest mismatch' using errcode='22023'; end if;
 update public.case_evidence set scan_status=p_status where id=p_evidence returning * into item;
 insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
 values(p_actor,actor.name,actor.role,'EVIDENCE_SCAN','CASE',p_case::text,'SUCCESS',
 jsonb_build_object('evidence_id',item.id,'scan_status',p_status));
 return to_jsonb(item);
end $$;

-- Existing get_case_evidence only returns CLEAN. Direct table/object access must
-- remain revoked; no signed/public object URLs or client Storage policies added.
revoke all on function public.reserve_case_evidence(uuid,uuid,text,bigint,text,text,text,text,text),
 public.read_case_evidence_for_scan(uuid,uuid,uuid),
 public.finish_case_evidence_scan(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.reserve_case_evidence(uuid,uuid,text,bigint,text,text,text,text,text),
 public.read_case_evidence_for_scan(uuid,uuid,uuid),
 public.finish_case_evidence_scan(uuid,uuid,uuid,text,text) to service_role;

-- Additive automatic scanning queue. Backend service-only; worker has a separate scoped API token.
create table public.case_evidence_scan_jobs (
 evidence_id uuid primary key references public.case_evidence(id),
 status text not null default 'PENDING' check(status in ('PENDING','SCANNING','COMPLETE','FAILED')),
 attempts integer not null default 0 check(attempts between 0 and 6),
 available_at timestamptz not null default clock_timestamp(),
 lease_token uuid, lease_until timestamptz, last_lease_token uuid,
 last_result text check(last_result in ('CLEAN','INFECTED','ERROR')),
 scanner_proof jsonb, created_at timestamptz not null default clock_timestamp(),
 check((status='SCANNING' and lease_token is not null and lease_until is not null)
    or (status<>'SCANNING' and lease_token is null and lease_until is null))
);
alter table public.case_evidence_scan_jobs enable row level security;
revoke all on public.case_evidence_scan_jobs from public,anon,authenticated,service_role;
create index case_evidence_scan_jobs_ready on public.case_evidence_scan_jobs(available_at,created_at)
 where status='PENDING';

alter table public.case_activity drop constraint case_activity_action_check;
alter table public.case_activity add constraint case_activity_action_check check(action in
 ('CASE_CREATED','CASE_ASSIGNED','CASE_REASSIGNED','CASE_STATUS_CHANGED','CASE_ESCALATED',
  'CASE_COMMENT_ADDED','EVIDENCE_ADDED','EVIDENCE_REJECTED','CASE_CLOSURE_REQUESTED',
  'CASE_CLOSURE_APPROVED','CASE_CLOSURE_REJECTED','SLA_OVERDUE','EVIDENCE_SCAN'));

create function public.queue_case_evidence_scan(p_actor uuid,p_case uuid,p_evidence uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare item public.case_evidence;
begin
 if not public.can_access_case(p_actor,p_case) then raise exception 'Denied' using errcode='42501'; end if;
 select * into item from public.case_evidence where id=p_evidence and case_id=p_case for update;
 if not found then raise exception 'Evidence not found' using errcode='P0002'; end if;
 if item.scan_status in ('CLEAN','INFECTED') then return to_jsonb(item); end if;
 insert into public.case_evidence_scan_jobs(evidence_id) values(item.id)
 on conflict(evidence_id) do update set status='PENDING',attempts=0,available_at=clock_timestamp()
 where case_evidence_scan_jobs.status='FAILED';
 return to_jsonb(item)||jsonb_build_object('scan_queued',true);
end $$;

create function public.claim_case_evidence_scan_job()
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.case_evidence_scan_jobs; item public.case_evidence;
begin
 -- Expired work is retryable only within its finite attempt budget.
 update public.case_evidence_scan_jobs set
  status=case when attempts>=6 then 'FAILED' else 'PENDING' end,
  available_at=clock_timestamp()+interval '15 seconds',last_result='ERROR',
  last_lease_token=lease_token,lease_token=null,lease_until=null
 where status='SCANNING' and lease_until<=clock_timestamp();
 update public.case_evidence e set scan_status='ERROR'
 from public.case_evidence_scan_jobs j
 where j.evidence_id=e.id and j.status='FAILED' and e.scan_status='PENDING';
 -- A terminal result produced by an authorized inline scanner is never rescanned.
 update public.case_evidence_scan_jobs j set status='COMPLETE',last_result=e.scan_status,
  last_lease_token=j.lease_token,lease_token=null,lease_until=null
 from public.case_evidence e where j.evidence_id=e.id and e.scan_status in ('CLEAN','INFECTED')
  and j.status in ('PENDING','SCANNING');
 select j.* into job from public.case_evidence_scan_jobs j join public.case_evidence e on e.id=j.evidence_id
 where j.status='PENDING' and j.attempts<6 and j.available_at<=clock_timestamp()
  and e.scan_status in ('PENDING','ERROR')
 order by j.available_at,j.created_at for update of j skip locked limit 1;
 if not found then return null; end if;
 update public.case_evidence_scan_jobs set status='SCANNING',attempts=attempts+1,
  lease_token=gen_random_uuid(),lease_until=clock_timestamp()+interval '120 seconds'
 where evidence_id=job.evidence_id returning * into job;
 select * into item from public.case_evidence where id=job.evidence_id;
 return to_jsonb(item)||jsonb_build_object('lease_token',job.lease_token,
  'lease_until',job.lease_until,'scan_attempt',job.attempts);
end $$;

create function public.read_claimed_case_evidence_scan(p_evidence uuid,p_lease uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item public.case_evidence;
begin
 select e.* into item from public.case_evidence e join public.case_evidence_scan_jobs j on j.evidence_id=e.id
 where e.id=p_evidence and j.status='SCANNING' and j.lease_token=p_lease
  and j.lease_until>clock_timestamp() and e.scan_status in ('PENDING','ERROR');
 if not found then raise exception 'No live matching lease' using errcode='23505'; end if;
 return to_jsonb(item);
end $$;

create function public.finish_claimed_case_evidence_scan(p_evidence uuid,p_lease uuid,
 p_sha256 text,p_status text,p_proof jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare job public.case_evidence_scan_jobs; item public.case_evidence;
begin
 if p_status is null or p_status not in ('CLEAN','INFECTED','ERROR') or p_sha256 !~ '^[0-9a-f]{64}$'
  or jsonb_typeof(p_proof) is distinct from 'object' or octet_length(p_proof::text)>4096
  or coalesce(p_proof->>'engine_sha256','') !~ '^[0-9a-f]{64}$'
 then raise exception 'Invalid scanner result' using errcode='22023'; end if;
 select * into job from public.case_evidence_scan_jobs where evidence_id=p_evidence for update;
 if not found then raise exception 'Scan job not found' using errcode='P0002'; end if;
 select * into item from public.case_evidence where id=p_evidence for update;
 if item.content_sha256 is distinct from p_sha256 then raise exception 'Evidence digest mismatch' using errcode='22023'; end if;
 if job.status='COMPLETE' and job.last_lease_token=p_lease and item.scan_status in ('CLEAN','INFECTED')
 then return jsonb_build_object('id',item.id,'scan_status',item.scan_status,'reused',true); end if;
 if job.status<>'SCANNING' or job.lease_token is distinct from p_lease or job.lease_until<=clock_timestamp()
 then raise exception 'No live matching lease' using errcode='23505'; end if;
 -- An out-of-order error cannot demote an already terminal clean/infected result.
 if item.scan_status not in ('CLEAN','INFECTED') then
  update public.case_evidence set scan_status=p_status where id=p_evidence returning * into item;
  insert into public.audit_events(actor_id,actor_name,actor_role,action,resource_type,resource_id,outcome,details)
  values(null,'Evidence scanner','SYSTEM','EVIDENCE_SCAN','CASE',item.case_id::text,'SUCCESS',
   jsonb_build_object('evidence_id',item.id,'scan_status',p_status,'attempt',job.attempts,'scanner',p_proof));
  insert into public.case_activity(case_id,actor_id,actor_name,actor_role,action,details)
  values(item.case_id,null,'Evidence scanner','SYSTEM','EVIDENCE_SCAN',
   jsonb_build_object('evidence_id',item.id,'scan_status',p_status));
 end if;
 update public.case_evidence_scan_jobs set
  status=case when item.scan_status in ('CLEAN','INFECTED') then 'COMPLETE' when attempts>=6 then 'FAILED' else 'PENDING' end,
  available_at=clock_timestamp()+make_interval(secs=>least(300,15*(2^attempts)::integer)),
  last_result=item.scan_status,scanner_proof=p_proof,last_lease_token=lease_token,lease_token=null,lease_until=null
 where evidence_id=p_evidence;
 return jsonb_build_object('id',item.id,'scan_status',item.scan_status,'reused',false);
end $$;

revoke all on function public.queue_case_evidence_scan(uuid,uuid,uuid),
 public.claim_case_evidence_scan_job(),public.read_claimed_case_evidence_scan(uuid,uuid),
 public.finish_claimed_case_evidence_scan(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.queue_case_evidence_scan(uuid,uuid,uuid),
 public.claim_case_evidence_scan_job(),public.read_claimed_case_evidence_scan(uuid,uuid),
 public.finish_claimed_case_evidence_scan(uuid,uuid,text,text,jsonb) to service_role;

-- Independent restrictive policy keeps this bucket inaccessible to all browser
-- sessions even if an older permissive storage policy covers unrelated buckets.
create policy case_evidence_private_server_only on storage.objects as restrictive
 for all to anon,authenticated
 using(bucket_id<>'case-evidence-private') with check(bucket_id<>'case-evidence-private');
