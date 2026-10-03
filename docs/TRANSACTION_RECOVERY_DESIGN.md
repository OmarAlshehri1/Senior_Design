# Phase 13B — Durable transaction processing

## Activation boundary

Migration `012_create_transaction_processing.sql` and the runtime path are locally tested. The project owner confirmed that migration 012 was applied successfully to Supabase; the agent has not independently queried the live database. `TRANSACTION_RECOVERY_ENABLED=false` remains the safe default until the migration's live grants/functions are verified and runtime activation is explicitly approved. With the flag off, Phase 13A insert-only protection remains active, but the legacy separate persistence steps still have no automatic recovery guarantee.

The rollout procedure, requiring approval for its live steps, is: verify the owner-applied migration's grants/functions/indexes, enable the flag in the approved backend environment, restart the backend, and verify new transaction -> job -> completed snapshots/alert plus recovery. Do not switch the flag off while jobs remain unfinished. No live action is part of the local test commands below.

## Persistence and failure semantics

1. `create_transaction_with_job` inserts the immutable runtime source and its PENDING job in one PostgreSQL transaction. Duplicate IDs fail with unique violation / HTTP 409; offline seed upsert is unchanged and does not enqueue jobs.
2. `claim_transaction_job` locks one job and grants a five-minute lease with a fresh token. Active leases return no claim; expired leases are reclaimable after process failure. An obsolete token cannot release or complete a replacement lease.
3. The processor reads stored source inputs and historical rule contexts, then computes the existing versioned rules, model score, and 60/40 result. Temporary context errors prevent final persistence and remain retryable. Missing source fields still produce legitimate NOT_EVALUATED results. Context is observed at processing time, including after retry; this does not promise serializable audit evaluation or retroactive rescoring across different transaction IDs.
4. `finish_transaction_job` locks/fences the job and atomically inserts evaluation, anomaly score, optional combined score, optional HIGH alert, saved result, and durable alert-event state. A failure at any insertion/update rolls back all derived writes. Completion replay returns the committed result without inserting duplicates or rescoring.
5. WebSocket publication happens after commit. Event state is acknowledged after a publication attempt; failed acknowledgements keep it pending for retry. A crash between commit and publication is recovered by the persisted event state. Duplicate events remain possible and are deduplicated by alert ID in the frontend. This guarantees retryable publication attempts, not delivery to every client: the existing manager is process-local and removes failed sockets. Offline/reconnecting clients still need REST catch-up (Phase 17); multiple-instance topology remains Phase 24 work.
6. Gemini remains advisory after the authoritative commit. Failure returns a null explanation without changing committed results. Worker recovery prioritizes authoritative results and alerts; automatic retry of optional explanations is not a processing guarantee.

The FastAPI lifespan starts the recovery poller only when enabled; it scans ready jobs and pending events every ten seconds. Failed work backs off 30 seconds per attempt, capped at five minutes, using database time; active/delayed jobs cannot occupy the ready-job page. Retry attempts are persisted and continue without a browser. A process crash during an outstanding lease is recovered after expiry. Source creation may survive an HTTP timeout; clients use GET to check results, while repeating POST for the same ID returns 409. Processing errors return 503 with recovery guidance; no success is returned before authoritative completion. There is no global distributed WebSocket broadcast in this phase.

Existing transactions from before activation are not automatically migrated into jobs, and historical backfill remains separate. Seed upsert must remain an explicitly approved offline operation, not run concurrently with runtime ingestion; it is not an immutable transaction-update API. Job/source history is retained; no live deletion or rewrites are introduced.

## Local evidence and reproducible checks

Python tests mock all remote services and exercise context failures, replay after a lost commit response, event acknowledgement retry, active leases, API conflict behavior, Gemini failure isolation, and worker startup/shutdown.

```powershell
Set-Location backend
.\.venv\Scripts\python.exe -B -m pytest -q -p no:cacheprovider
```

The separate test-support package runs actual migrations 001–012 and PL/pgSQL in isolated PGlite PostgreSQL, inside the Node process with no remote database or external service. It is a test-only dependency; Python requirements and frontend dependencies are unchanged. PGlite is an embedded PostgreSQL WASM build ([official documentation](https://pglite.dev/docs/about)); it is not evidence of live Supabase application or multi-worker production behavior.

```powershell
npm install --prefix backend/test-support --no-audit --no-fund
npm test --prefix backend/test-support
```

For an installation in a temporary directory, set `PGLITE_PACKAGE_JSON` to that directory's package.json and run `node --test backend/test-support/transaction-processing.test.mjs`. The test database is initialized entirely from repository migrations, with isolated roles and pgcrypto. It checks source/job rollback, duplicate IDs, injected failure at every snapshot/alert/job-completion boundary, retry/idempotency, fencing/backoff, nullable scoring, RPC access denial, and dump/restore persistence of event state.
