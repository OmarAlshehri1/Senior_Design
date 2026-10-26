-- Operator-only, archive-bound retention. Application credentials cannot unseal datasets.
create table public.primary_dataset_reductions (
 id bigint generated always as identity primary key,
 dataset_id smallint not null references public.primary_datasets(id),
 original_metadata jsonb not null,
 archive_ids_sha256 text not null,
 retained_ids_sha256 text not null,
 result jsonb not null,
 performed_by text not null default current_user,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.primary_dataset_reductions enable row level security;
revoke all on public.primary_dataset_reductions from public,anon,authenticated,service_role;

create table public.primary_dataset_reduction_archive (
 reduction_id bigint not null references public.primary_dataset_reductions(id),
 kind text not null check(kind in('TRANSACTION','VENDOR','ALERT')),
 batch integer not null,
 payload jsonb not null check(jsonb_typeof(payload)='array'),
 primary key(reduction_id,kind,batch)
);
alter table public.primary_dataset_reduction_archive enable row level security;
revoke all on public.primary_dataset_reduction_archive from public,anon,authenticated,service_role;

create or replace function public.protect_sealed_primary_dataset() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if old.state='READY' and to_jsonb(old) is distinct from to_jsonb(new)
   and not(current_user='postgres' and coalesce(current_setting('app.primary_dataset_reduction',true),'')=old.id::text) then
   raise exception 'Ready dataset metadata is sealed' using errcode='55000'; end if;
 return new;
end; $$;

create function public.reduce_primary_payments(
 p_target integer,p_expected_count integer,p_archive_source_sha text,
 p_archive_ids_sha text,p_expected_retained_sha text,p_apply boolean default false
) returns jsonb language plpgsql security invoker set search_path='' as $$
<<retention>>
declare d public.primary_datasets; original jsonb; actual bigint; protected_count bigint;
 full_sha text; retained_sha text; total numeric; vendor_count bigint; s jsonb; result jsonb;
 reduction_id bigint; batch_row record;
 removed bigint:=0; removed_vendors bigint:=0; alerts_before bigint; alerts_after bigint;
begin
 if current_user<>'postgres' then raise exception 'Database operator required' using errcode='42501'; end if;
 if p_target<1 or p_target>=p_expected_count then raise exception 'Smaller positive target required'; end if;
 if p_apply then
   lock table public.transactions,public.approved_vendors,public.alerts in exclusive mode;
   lock table public.review_records,public.transaction_review_states,public.audit_cases,
     public.alert_assignments,public.alert_assignment_history,public.transaction_processing_jobs,
     public.business_reports,public.audit_reports,public.vendor_monitoring_requests,public.vendor_monitoring_history in share mode;
 end if;
 select * into d from public.primary_datasets where id=public.primary_dataset_id() for update;
 if not found or d.id=0 or d.state<>'READY' or d.source_schema<>'PAYMENTS_SIMULATION_WORKBOOK'
   or d.source_sha256 is distinct from p_archive_source_sha then raise exception 'Source archive binding changed'; end if;
 original:=to_jsonb(d);
 select count(*),encode(sha256(convert_to(string_agg(t.id,E'\n' order by t.id),'UTF8')),'hex')
   into actual,full_sha from public.transactions t where t.dataset_id=d.id;
 if actual<>p_expected_count or full_sha is distinct from p_archive_ids_sha then
   raise exception 'Archived population does not match Production'; end if;
 if exists(select 1 from public.transactions where dataset_id=d.id and primary_rule_mask is null) then
   raise exception 'Manual transactions require a separate retention review'; end if;

 drop table if exists pg_temp.reduction_keep;
 create temporary table reduction_keep(id text primary key,protected boolean not null) on commit drop;
 insert into pg_temp.reduction_keep
 select t.id,true from public.transactions t join (
   select transaction_id id from public.review_records
   union select transaction_id from public.transaction_review_states
   union select transaction_id from public.audit_cases
   union select transaction_id from public.transaction_processing_jobs
   union select a.transaction_id from public.alerts a join public.alert_assignments aa on aa.alert_id=a.id
   union select a.transaction_id from public.alerts a join public.alert_assignment_history ah on ah.alert_id=a.id
   union select resource_id from public.audit_events where resource_type='TRANSACTION'
   union select a.transaction_id from public.alerts a join public.audit_events e on e.resource_type='ALERT' and e.resource_id=a.id
   union select x->>'id' from public.business_reports b cross join lateral jsonb_array_elements(coalesce(b.document->'evidence'->'transactions','[]'))x
   union select x->>'id' from public.audit_reports r cross join lateral jsonb_array_elements(coalesce(r.summary->'high_risk_transactions','[]'))x
 ) links on links.id=t.id where t.dataset_id=d.id;
 select count(*) into protected_count from pg_temp.reduction_keep;
 if protected_count>p_target then raise exception 'Linked workflow records exceed target'; end if;
 insert into pg_temp.reduction_keep
 select t.id,false from public.transactions t where t.dataset_id=d.id
   and not exists(select 1 from pg_temp.reduction_keep k where k.id=t.id)
 order by t.transaction_timestamp desc,t.id desc limit(p_target-protected_count);
 select encode(sha256(convert_to(string_agg(id,E'\n' order by id),'UTF8')),'hex') into retained_sha from pg_temp.reduction_keep;
 if retained_sha is distinct from p_expected_retained_sha then
   raise exception 'Retention selection changed; preview again before applying'; end if;
 select jsonb_build_object('total',count(*),'amount_total',sum(t.amount),
   'risk_sum_scaled',coalesce(sum(t.primary_risk_scaled::bigint),0),
   'high',count(*) filter(where t.primary_risk_scaled>=7500),
   'medium',count(*) filter(where t.primary_risk_scaled>=5000 and t.primary_risk_scaled<7500),
   'low',count(*) filter(where t.primary_risk_scaled<5000),
   'failed_by_rule',jsonb_build_array(count(*) filter(where(t.primary_rule_mask&1)<>0),count(*) filter(where(t.primary_rule_mask&2)<>0),
     count(*) filter(where(t.primary_rule_mask&4)<>0),count(*) filter(where(t.primary_rule_mask&8)<>0),count(*) filter(where(t.primary_rule_mask&16)<>0)),
   'latest_source_timestamp',max(t.transaction_timestamp)) into s
 from public.transactions t join pg_temp.reduction_keep k on k.id=t.id;
 if (s->>'total')::bigint<>p_target then raise exception 'Incomplete retention selection'; end if;
 result:=jsonb_build_object('applied',false,'dataset_id',d.id,'original_rows',actual,'retained_rows',p_target,
   'rows_to_remove',actual-p_target,'protected_records',protected_count,'retained_ids_sha256',retained_sha,
   'selection','Latest payments, preserving workflow and saved-report references','summary',s,
   'results_context','Frozen original-population evaluation; scores and review evidence are unchanged');
 if not p_apply then return result; end if;

 insert into public.primary_dataset_reductions(dataset_id,original_metadata,archive_ids_sha256,retained_ids_sha256,result)
 values(d.id,original,full_sha,retained_sha,result) returning id into reduction_id;
 for batch_row in
   select array_agg(id) ids,chunk from(
     select t.id,((row_number()over(order by t.id))-1)/1000 chunk from public.transactions t
     where t.dataset_id=d.id and not exists(select 1 from pg_temp.reduction_keep k where k.id=t.id)
   ) q group by chunk
 loop
   insert into public.primary_dataset_reduction_archive values(reduction_id,'TRANSACTION',batch_row.chunk,
     (select jsonb_agg(to_jsonb(t) order by t.id) from public.transactions t where t.id=any(batch_row.ids)));
 end loop;
 for batch_row in
   select array_agg(id) ids,chunk from(
     select a.id,((row_number()over(order by a.id))-1)/1000 chunk from public.alerts a
     join public.transactions t on t.id=a.transaction_id where t.dataset_id=d.id
     and not exists(select 1 from pg_temp.reduction_keep k where k.id=t.id)
   ) q group by chunk
 loop
   insert into public.primary_dataset_reduction_archive values(reduction_id,'ALERT',batch_row.chunk,
     (select jsonb_agg(to_jsonb(a) order by a.id) from public.alerts a where a.id=any(batch_row.ids)));
 end loop;
 if pg_database_size(current_database())>440000000 then raise exception 'Rollback archive requires additional headroom'; end if;
 perform set_config('app.primary_dataset_reduction',d.id::text,true);
 update public.primary_datasets set state='IMPORTING' where id=d.id;
 select count(*) into alerts_before from public.alerts a join public.transactions t on t.id=a.transaction_id where t.dataset_id=d.id;
 delete from public.transactions t where t.dataset_id=d.id and not exists(select 1 from pg_temp.reduction_keep k where k.id=t.id);
 get diagnostics removed=row_count;
 if removed<>actual-p_target then raise exception 'Removal count mismatch'; end if;
 for batch_row in
   select array_agg(id) ids,chunk from(
     select v.id,((row_number()over(order by v.id))-1)/1000 chunk from public.approved_vendors v
     where v.dataset_id=d.id and v.monitoring_status='NORMAL'
     and not exists(select 1 from public.transactions t where t.dataset_id=d.id and t.vendor_id=v.vendor_id)
     and not exists(select 1 from public.vendor_monitoring_requests r where r.vendor_id=v.id)
     and not exists(select 1 from public.vendor_monitoring_history h where h.vendor_id=v.id)
   ) q group by chunk
 loop
   insert into public.primary_dataset_reduction_archive values(reduction_id,'VENDOR',batch_row.chunk,
     (select jsonb_agg(to_jsonb(v) order by v.id) from public.approved_vendors v where v.id=any(batch_row.ids)));
 end loop;
 delete from public.approved_vendors v where v.dataset_id=d.id and v.monitoring_status='NORMAL'
   and not exists(select 1 from public.transactions t where t.dataset_id=d.id and t.vendor_id=v.vendor_id)
   and not exists(select 1 from public.vendor_monitoring_requests r where r.vendor_id=v.id)
   and not exists(select 1 from public.vendor_monitoring_history h where h.vendor_id=v.id);
 get diagnostics removed_vendors=row_count;
 select count(*) into vendor_count from public.approved_vendors where dataset_id=d.id;
 select count(*) into alerts_after from public.alerts a join public.transactions t on t.id=a.transaction_id where t.dataset_id=d.id;
 result:=result||jsonb_build_object('applied',true,'removed_rows',removed,'removed_alerts',alerts_before-alerts_after,
   'reduction_id',reduction_id,'rollback_archive','PRIVATE_COMPRESSED_DATABASE_ARCHIVE',
   'retained_alerts',alerts_after,'removed_vendors',removed_vendors,'retained_vendors',vendor_count);
 update public.primary_datasets set state='READY',expected_rows=p_target,
   expected_amount=(s->>'amount_total')::numeric,expected_vendors=vendor_count,summary=s,
   label='Payments ('||p_target::text||' recent records; simulation-enriched)',
   provenance=provenance||jsonb_build_object('retention',jsonb_build_object('target_rows',p_target,
     'original_rows',actual,'retained_ids_sha256',retained_sha,'archive_ids_sha256',full_sha,
     'selection','LATEST_WITH_WORKFLOW_REFERENCES','reduced_at',clock_timestamp(),
     'evaluation_context_rows',actual,'scores_recomputed',false))
 where id=d.id;
 update public.primary_dataset_reductions set result=retention.result where id=reduction_id;
 perform set_config('app.primary_dataset_reduction','',true);
 return result;
end; $$;
revoke all on function public.reduce_primary_payments(integer,integer,text,text,text,boolean) from public,anon,authenticated,service_role;

-- Restores archived rows atomically without replacing surviving workflow records.
create function public.restore_primary_payment_reduction(p_reduction bigint) returns jsonb
language plpgsql security invoker set search_path='' as $$
<<restoration>>
declare r public.primary_dataset_reductions; d public.primary_datasets; item record;
 columns_sql text; values_sql text; restored bigint; result jsonb;
begin
 if current_user<>'postgres' then raise exception 'Database operator required' using errcode='42501'; end if;
 lock table public.transactions,public.approved_vendors,public.alerts in exclusive mode;
 select * into r from public.primary_dataset_reductions where id=p_reduction for update;
 if not found then raise exception 'Reduction not found'; end if;
 select * into d from public.primary_datasets where id=public.primary_dataset_id() for update;
 if d.id<>r.dataset_id or d.provenance->'retention'->>'retained_ids_sha256' is distinct from r.retained_ids_sha256 then
   raise exception 'Current retention binding differs'; end if;
 perform set_config('app.primary_dataset_reduction',d.id::text,true);
 update public.primary_datasets set state='IMPORTING' where id=d.id;
 for item in select * from(values('VENDOR','approved_vendors'),('TRANSACTION','transactions'),('ALERT','alerts')) q(kind,table_name)
 loop
   select string_agg(quote_ident(attname),',' order by attnum),string_agg('x.'||quote_ident(attname),',' order by attnum)
   into columns_sql,values_sql from pg_attribute where attrelid=('public.'||item.table_name)::regclass
     and attnum>0 and not attisdropped and attgenerated='';
   execute format('insert into public.%I(%s) overriding system value select %s from public.primary_dataset_reduction_archive a cross join lateral jsonb_populate_recordset(null::public.%I,a.payload)x where a.reduction_id=$1 and a.kind=$2',
     item.table_name,columns_sql,values_sql,item.table_name) using p_reduction,item.kind;
 end loop;
 update public.primary_datasets set state='READY',label=r.original_metadata->>'label',
   expected_rows=(r.original_metadata->>'expected_rows')::integer,
   expected_amount=(r.original_metadata->>'expected_amount')::numeric,
   expected_vendors=(r.original_metadata->>'expected_vendors')::integer,
   summary=r.original_metadata->'summary',provenance=r.original_metadata->'provenance' where id=d.id;
 result:=jsonb_build_object('restored',true,'dataset_id',d.id,'reduction_id',p_reduction,
   'active_rows',(select count(*) from public.transactions where dataset_id=d.id));
 update public.primary_dataset_reductions set result=primary_dataset_reductions.result||jsonb_build_object('restoration',restoration.result,'restored_at',clock_timestamp()) where id=p_reduction;
 perform set_config('app.primary_dataset_reduction','',true);
 return result;
end; $$;
revoke all on function public.restore_primary_payment_reduction(bigint) from public,anon,authenticated,service_role;
