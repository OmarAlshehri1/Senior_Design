# Bounded feed worker concurrency

The validation and audit stages support independently configurable worker pools:

- `INGESTION_VALIDATION_CONCURRENCY`: default 1, range 1-8.
- `INGESTION_AUDIT_CONCURRENCY`: default 1, range 1-8.

Non-integer/out-of-range settings fail startup when that stage is enabled. Stage
enable flags remain required. Set both values to 4 for the initial staging trial.
This uses the existing service and does not require a paid instance or extra
service. Production retains its existing configuration.

Each worker uses the existing single-job claim/finish RPCs and existing 25-job
drain passes. Database leases, `FOR UPDATE SKIP LOCKED`, source authorization,
snapshot capture, audit calculations and retry limits remain unchanged. This
improvement overlaps network waiting; it does not reduce the number of RPCs per
record or introduce bulk claim/finish RPCs. Later batching should be separately
verified against those same invariants.

Application shutdown cancels all feed tasks, awaits them together, then drains
the shared RPC client before closing its pool. An interrupted lease remains
recoverable through the existing expiration mechanism. Each worker subscribes
to the existing wake-up hints; durable polling remains authoritative.

Local checks cover limits/defaults, concurrent startup of both stages, task
cleanup before closing the RPC pool, and four real worker passes over 50
synthetic imported receipts in isolated PostgreSQL. Every receipt must complete
once, source boundaries must hold, unapproved risk must remain unavailable, and
reconfirming the batch must create no extra feed records.

Staging acceptance compares completed-record deltas over measured intervals.
Record the deploy interval separately: overlap/draining during rollout can
temporarily distort the rate. Do not extrapolate a speedup solely from worker
count. Check blocked/rejected counts and host health alongside throughput.

Rollback: set both concurrency values to 1 on the staging backend and redeploy.
No schema rollback, dataset replay, or queue deletion is needed.
