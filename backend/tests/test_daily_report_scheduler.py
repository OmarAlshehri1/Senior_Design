from app.services import daily_report_scheduler as scheduler


def test_scheduled_report_claim_calculates_and_completes_authoritative_daily_summary(monkeypatch):
    claim = {
        "run_id": "run-1",
        "lease_token": "lease-1",
        "period_start": "2026-10-03T00:00:00Z",
        "period_end": "2026-10-04T00:00:00Z",
    }
    completed = []
    monkeypatch.setattr(scheduler.supabase_reports, "claim_scheduled_daily_report", lambda: claim)
    monkeypatch.setattr(scheduler, "get_daily_audit_summary", lambda **values: {"daily_summary": {}, **values})
    monkeypatch.setattr(scheduler.supabase_reports, "complete_scheduled_daily_report", lambda **values: completed.append(values) or {"report_id": "RPT-2026-10-03"})

    assert scheduler.process_one_scheduled_report() is True
    assert completed == [{
        "run_id": "run-1",
        "lease_token": "lease-1",
        "summary": {
            "daily_summary": {},
            "period_start": "2026-10-03T00:00:00Z",
            "period_end": "2026-10-04T00:00:00Z",
            "report_version": "1.0.0",
        },
    }]


def test_scheduled_report_failure_records_only_exception_type_and_retries(monkeypatch):
    claim = {
        "run_id": "run-2",
        "lease_token": "lease-2",
        "period_start": "2026-10-03T00:00:00Z",
        "period_end": "2026-10-04T00:00:00Z",
    }
    failures = []
    monkeypatch.setattr(scheduler.supabase_reports, "claim_scheduled_daily_report", lambda: claim)

    def fail_summary(**_values):
        raise RuntimeError("provider response contains private details")

    monkeypatch.setattr(scheduler, "get_daily_audit_summary", fail_summary)
    monkeypatch.setattr(scheduler.supabase_reports, "fail_scheduled_daily_report", lambda **values: failures.append(values) or True)

    assert scheduler.process_one_scheduled_report() is False
    assert failures == [{"run_id": "run-2", "lease_token": "lease-2", "error_code": "RuntimeError"}]


def test_scheduled_report_without_due_claim_does_not_contact_summary_or_mutate_state(monkeypatch):
    monkeypatch.setattr(scheduler.supabase_reports, "claim_scheduled_daily_report", lambda: None)
    monkeypatch.setattr(scheduler, "get_daily_audit_summary", lambda **_values: (_ for _ in ()).throw(AssertionError("no claim")))
    assert scheduler.process_one_scheduled_report() is False
