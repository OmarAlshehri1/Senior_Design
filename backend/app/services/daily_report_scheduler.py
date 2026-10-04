"""Durable UTC daily report worker; database leases coordinate API instances."""

import asyncio
import logging

from starlette.concurrency import run_in_threadpool

from app.repositories import supabase_reports
from app.repositories.supabase_reports import get_daily_audit_summary
from app.services.audit_reports import REPORT_VERSION

logger = logging.getLogger(__name__)


def process_one_scheduled_report() -> bool:
    claim = supabase_reports.claim_scheduled_daily_report()
    if claim is None:
        return False

    run_id = claim["run_id"]
    lease_token = claim["lease_token"]
    try:
        summary = get_daily_audit_summary(
            period_start=claim["period_start"],
            period_end=claim["period_end"],
        )
        if not isinstance(summary, dict):
            raise ValueError("Invalid daily summary")
        summary["report_version"] = REPORT_VERSION
        supabase_reports.complete_scheduled_daily_report(
            run_id=run_id,
            lease_token=lease_token,
            summary=summary,
        )
        return True
    except Exception as exc:
        error_code = type(exc).__name__
        logger.warning("Scheduled daily report failed (%s); it will retry.", error_code)
        try:
            supabase_reports.fail_scheduled_daily_report(
                run_id=run_id,
                lease_token=lease_token,
                error_code=error_code,
            )
        except Exception as failure_exc:
            logger.warning("Could not record scheduled report failure (%s); the lease will expire.", type(failure_exc).__name__)
        return False


async def daily_report_loop() -> None:
    while True:
        try:
            await run_in_threadpool(process_one_scheduled_report)
        except Exception as exc:
            logger.warning("Daily report scheduler could not reach its store (%s); retrying.", type(exc).__name__)
        await asyncio.sleep(60)
