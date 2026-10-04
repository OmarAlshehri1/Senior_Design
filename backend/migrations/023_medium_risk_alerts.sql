-- Allow medium-risk events through the notification pipeline.
alter table public.user_notifications
    drop constraint if exists user_notifications_type_check;

alter table public.user_notifications
    add constraint user_notifications_type_check check (type in (
        'HIGH_RISK_ALERT', 'MEDIUM_RISK_ALERT', 'ALERT_ASSIGNED', 'ALERT_REASSIGNED', 'REVIEW_REQUIRED',
        'ACCESS_REQUEST_SUBMITTED', 'ACCESS_REQUEST_APPROVED',
        'ACCOUNT_LOCKED', 'ACCOUNT_UNLOCKED', 'ACCOUNT_UNLOCK_REQUESTED', 'ACCOUNT_UNLOCK_REJECTED',
        'SECURITY_ALERT', 'SYSTEM_NOTICE', 'CASE_ASSIGNED', 'CASE_ESCALATED',
        'CASE_CLOSURE_REQUESTED', 'CASE_CLOSURE_APPROVED', 'CASE_CLOSURE_REJECTED',
        'SLA_DUE_SOON', 'SLA_OVERDUE', 'VENDOR_WATCHLIST_REQUEST', 'VENDOR_WATCHLIST_APPROVED',
        'VENDOR_BLOCK_REQUEST', 'VENDOR_BLOCKED'
    ));

create or replace function public.notify_high_risk_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    recipient uuid;
    notification_type text;
    notification_title text;
    notification_message text;
    notification_priority text;
begin
    if new.severity not in ('MEDIUM', 'HIGH') then
        return new;
    end if;

    if new.severity = 'HIGH' then
        notification_type := 'HIGH_RISK_ALERT';
        notification_title := 'High-risk alert created';
        notification_message := 'A high-risk transaction requires priority review.';
        notification_priority := 'HIGH';
    else
        notification_type := 'MEDIUM_RISK_ALERT';
        notification_title := 'Medium-risk alert created';
        notification_message := 'A medium-risk transaction is available for review.';
        notification_priority := 'NORMAL';
    end if;

    for recipient in
        select id
        from public.user_profiles
        where account_status = 'ACTIVE'
          and role in ('ADMIN', 'SUPERVISOR')
    loop
        perform public.enqueue_user_notification(
            recipient,
            'alert-created:' || new.id::text || ':' || recipient::text,
            notification_type,
            notification_title,
            notification_message,
            'ALERT',
            new.id::text,
            notification_priority
        );
    end loop;
    return new;
end;
$$;

create or replace function public.finish_transaction_job(
    p_id text,
    p_token uuid,
    p_bundle jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
    j public.transaction_processing_jobs;
    r jsonb;
    a jsonb;
    alert_record public.alerts;
    alert_severity text;
    alert_title text;
    alert_description text;
    alert_reason text;
begin
    select * into j
    from public.transaction_processing_jobs
    where transaction_id = p_id
    for update;
    if not found then
        raise exception 'Processing job missing';
    end if;

    -- Completed jobs are immutable; retries never duplicate alerts or snapshots.
    if j.status = 'COMPLETED' then
        return to_jsonb(j);
    end if;
    if j.status <> 'PROCESSING'
       or j.lease_token is distinct from p_token
       or j.lease_until <= clock_timestamp() then
        raise exception 'Processing lease expired';
    end if;

    r := p_bundle -> 'result';
    a := p_bundle -> 'anomaly';
    if r ->> 'id' is distinct from p_id then
        raise exception 'Result identity mismatch';
    end if;
    if (r ->> 'risk_score')::numeric is distinct from
       round(0.60 * (r ->> 'rule_score')::numeric + 0.40 * (r ->> 'ai_score')::numeric, 2) then
        raise exception 'Risk policy mismatch';
    end if;

    insert into public.transaction_evaluations(
        transaction_id, evaluation_version, rule_status, rule_score, rule_results
    ) values (
        p_id, p_bundle ->> 'rule_version', r ->> 'rule_status',
        (r ->> 'rule_score')::numeric, r -> 'rule_results'
    );
    insert into public.transaction_anomaly_scores(
        transaction_id, model_version, ai_score, threshold, is_anomalous
    ) values (
        p_id, p_bundle ->> 'model_version', (r ->> 'ai_score')::numeric,
        (a ->> 'threshold')::numeric, (a ->> 'is_anomalous')::boolean
    );

    if r ->> 'risk_score' is not null then
        insert into public.transaction_risk_scores(
            transaction_id, scoring_version, rule_evaluation_version, anomaly_model_version,
            rule_score, ai_score, risk_score, risk_level
        ) values (
            p_id, p_bundle ->> 'risk_version', p_bundle ->> 'rule_version',
            p_bundle ->> 'model_version', (r ->> 'rule_score')::numeric,
            (r ->> 'ai_score')::numeric, (r ->> 'risk_score')::numeric, r ->> 'risk_level'
        );
    end if;

    alert_severity := case
        when r ->> 'risk_level' = 'HIGH' then 'HIGH'
        when r ->> 'risk_level' = 'MEDIUM' then 'MEDIUM'
        else null
    end;
    if alert_severity is not null then
        alert_title := case when alert_severity = 'HIGH'
            then 'High-risk transaction detected'
            else 'Medium-risk transaction detected' end;
        alert_description := case when alert_severity = 'HIGH'
            then 'The transaction requires auditor review.'
            else 'The transaction should be reviewed according to policy.' end;
        alert_reason := 'Rule and anomaly results entered the ' || lower(alert_severity) || '-risk range.';

        insert into public.alerts(
            transaction_id, severity, title, description, reason,
            risk_score, risk_scoring_version, request_received_at
        ) values (
            p_id, alert_severity, alert_title, alert_description, alert_reason,
            (r ->> 'risk_score')::numeric, p_bundle ->> 'risk_version', j.request_received_at
        ) returning * into alert_record;
    end if;

    update public.transaction_processing_jobs
    set status = 'COMPLETED',
        result = r,
        alert_event = case when alert_record.id is not null then to_jsonb(alert_record) else null end,
        event_pending = alert_record.id is not null,
        completed_at = clock_timestamp(),
        lease_token = null,
        lease_until = null
    where transaction_id = p_id
    returning * into j;
    return to_jsonb(j);
end;
$$;

revoke all on function public.notify_high_risk_alert() from public, anon, authenticated;
grant execute on function public.notify_high_risk_alert() to service_role;
revoke all on function public.finish_transaction_job(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.finish_transaction_job(text, uuid, jsonb) to service_role;
