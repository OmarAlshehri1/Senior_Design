"""Optional durable validation worker; never invokes canonical processing or Gemini."""
import asyncio
import logging
import os

from pydantic import ValidationError
from starlette.concurrency import run_in_threadpool

from app.services.ingestion_payload import parse_envelope
from app.repositories import ingestion as repository
from app.repositories.supabase_transactions import SupabaseConfigurationError, SupabasePersistenceError
from app.services.ingestion_mapping import MappingConfiguration, validate_record
from app.services.feed_worker_wakeup import listen, notify, wait

logger = logging.getLogger(__name__)


def enabled() -> bool:
    return all(os.getenv(key, "false").lower() == "true"
               for key in ("INGESTION_ENABLED", "INGESTION_VALIDATION_ENABLED"))


async def validate_once(limit: int = 25) -> int:
    if not enabled():
        return 0
    completed = 0
    for _ in range(max(0, min(limit, 25))):
        job = await run_in_threadpool(repository.rpc, "claim_ingestion_validation", {})
        if job is None:
            break
        if not isinstance(job, dict):
            raise SupabasePersistenceError("Invalid validation claim.")
        if job.get("blocked"):
            continue
        if (not all(isinstance(job.get(key), str) for key in
                    ("receipt_id", "lease_token", "source_id", "original_payload"))
                or "configuration" not in job):
            raise SupabasePersistenceError("Invalid validation claim.")
        receipt_id, token = job["receipt_id"], job["lease_token"]
        code = None
        try:
            if job["configuration"] is None:
                code = "MAPPING_NOT_CONFIGURED"
            else:
                configuration = MappingConfiguration.model_validate(job["configuration"])
                envelope = parse_envelope(job["original_payload"].encode("utf-8"))
                if envelope["source_id"] != job["source_id"]:
                    code = "SOURCE_RECORD_INVALID"
                else:
                    result = validate_record(envelope["original_record"], configuration)
                    saved = await run_in_threadpool(repository.rpc, "finish_ingestion_validation", {
                        "p_receipt_id": receipt_id, "p_lease_token": token, "p_result": result})
                    if isinstance(saved, dict) and saved.get("validation_status") == "COMPLETED":
                        completed += 1
                        if result["intake_status"] in {"ACCEPTED", "PARTIAL"}:
                            notify("audit")
                    else:
                        code = "VALIDATION_UNAVAILABLE"
        except ValidationError:
            code = "MAPPING_INVALID"
        except (ValueError, UnicodeError, OverflowError, RecursionError):
            code = "SOURCE_RECORD_INVALID"
        except (SupabaseConfigurationError, SupabasePersistenceError):
            code = "VALIDATION_UNAVAILABLE"
        if code:
            await run_in_threadpool(repository.rpc, "release_ingestion_validation", {
                "p_receipt_id": receipt_id, "p_lease_token": token, "p_code": code})
    return completed


async def validation_loop() -> None:
    with listen("validation") as wake:
        while enabled():
            # Clear before querying durable jobs, not after: retain hints arriving mid-scan.
            wake.clear()
            try:
                completed = await validate_once()
            except (SupabaseConfigurationError, SupabasePersistenceError):
                logger.warning("Ingestion validation storage unavailable; pending leases will recover.")
                await asyncio.sleep(2)
                continue
            if completed == 25:
                await asyncio.sleep(0)
            else:
                await wait(wake)
