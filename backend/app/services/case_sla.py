"""Server-side case SLA escalation worker; database RPC owns locking and idempotency."""

import asyncio
import logging

from starlette.concurrency import run_in_threadpool

from app.repositories.cases import escalate_overdue

logger = logging.getLogger(__name__)


async def escalation_loop() -> None:
    while True:
        try:
            await run_in_threadpool(escalate_overdue, batch=100)
        except Exception:
            # Multiple API instances may poll concurrently. PostgreSQL SKIP LOCKED
            # and the due-state predicate make retries safe when the migration exists.
            logger.warning("Case SLA worker could not reach the case store; retrying.")
        await asyncio.sleep(60)
