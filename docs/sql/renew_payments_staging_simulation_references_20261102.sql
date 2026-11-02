-- Operator action for staging gunvsnvxipetxavpajjv only; not an automatic migration.
-- Fictional prototype references. No real-company policy approval is asserted.
-- Old contexts, receipts, completed results, amounts, identities and model binding stay intact.
begin;
do $renewal$
declare source public.ingestion_sources; config jsonb; original jsonb; policies jsonb;
    expires text := '2026-11-09T00:00:00Z';
begin
    select * into source from public.ingestion_sources where id='payments-file-local' for update;
    if not found then raise exception 'Expected staging Payments source missing'; end if;
    if source.audit_context_version='payments-simulation-ai-20261102' then return; end if;
    if source.audit_context_version<>'payments-source-ai-20261102' then
        raise exception 'Unexpected source context; preserve current state';
    end if;
    select configuration into original from public.feed_audit_contexts
        where source_id=source.id and version=source.audit_context_version;
    if original->>'time_basis' is distinct from 'SIMULATED_ARRIVAL_TIME'
        or original->'model_approval'->>'model_version' is distinct from 'payments-primary-no-calendar-1.0.0'
        or coalesce(original->'history'->>'reference','') not like 'SIMULATED-%'
        or coalesce(original->'vendor_registry'->>'reference','') not like 'SIMULATED-%'
        then raise exception 'Only the existing explicit simulation context may be renewed'; end if;
    config:=jsonb_set(original,'{history,valid_to}',to_jsonb(expires));
    config:=jsonb_set(config,'{history,reference}',to_jsonb('SIMULATED complete delivered prefix; renewed 2026-11-02'::text));
    config:=jsonb_set(config,'{vendor_registry,valid_to}',to_jsonb(expires));
    config:=jsonb_set(config,'{vendor_registry,reference}',to_jsonb('SIMULATED selected-workbook registry; renewed 2026-11-02'::text));
    select jsonb_agg(jsonb_set(value,'{valid_to}',to_jsonb(expires)) ||
        jsonb_build_object('reference','SIMULATED approval policy; renewed 2026-11-02') order by n)
        into policies from jsonb_array_elements(original->'approval_policies') with ordinality a(value,n);
    config:=jsonb_set(config,'{approval_policies}',policies);
    if config->'model_approval' is distinct from original->'model_approval' then
        raise exception 'Model binding must not change'; end if;
    insert into public.feed_audit_contexts(source_id,version,configuration)
        values(source.id,'payments-simulation-ai-20261102',config);
    update public.ingestion_sources set audit_context_version='payments-simulation-ai-20261102' where id=source.id;
end;
$renewal$;
commit;
