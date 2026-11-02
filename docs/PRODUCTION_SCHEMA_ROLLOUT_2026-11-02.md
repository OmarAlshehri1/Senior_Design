# Production schema-only rollout - 2 November 2026

**All 26 approved migrations were applied once, in order, and verified.**
The rollout completed verification at 16:52:55 UTC. Existing transactions and
alerts are unchanged. Application code was not deployed, PR #40 remains a draft,
and imports/AI were not activated.

## Execution record

- Production project: `sqiqspqfpbotmwrerbsi`.
- Approved SQL: the 26 files in the [reviewed manifest](evidence/production_release_migration_manifest_2026-11-02.json),
  pinned to source commit `b1ca6416d32454ae0218ed446bc0cda09b087331`.
- Each file's SHA-256 was checked against its Git blob before execution.
- Every migration returned success. Production history increased from 8 to 34
  entries, with exactly one new entry per approved name in the expected order.
- Actual production migration versions run from `20261102164324` through
  `20261102164722`; the [execution ledger](evidence/production_schema_rollout_2026-11-02.json)
  maps every file, checksum and name to its generated version.
- Baseline migrations were not replayed. No reset, seed, dataset reimport,
  simulated context, source registration or production test user was used.

**Do not rerun the 26-file schema step.** Consult the execution ledger and live
history before any future migration action. The original approval manifest is
retained unchanged; applied versions are recorded separately.

## Verification

| Check | Result |
| --- | --- |
| New private tables | 20 present, all with RLS enabled |
| Direct table privileges | None for anon, authenticated or service_role |
| New/replaced function privileges | 45 checked; none executable by anon/authenticated |
| Required backend RPCs | All 16 checked critical RPCs executable by service_role |
| Draft cleanup function | Owner-only; service_role cannot execute it |
| Function definitions | All 45 match staging after CRLF-to-LF normalization |
| New table contents | All 20 empty; no feed source, receipt, context, result or import batch created |
| Existing transaction table | 57,384 records; full-row aggregate digest unchanged |
| Existing alert table | 4,150 records; full-row aggregate digest unchanged |
| Production health | HTTP 200 |
| New company-import HTTP API | Absent from current production OpenAPI, as expected before code deployment |
| Draft-cleanup scheduling | No cron catalog/job created; cleanup function was not invoked |

Transaction and alert checksums cover complete stored rows, ordered by ID,
before and after the rollout. These are whole-table counts, not the dashboard's
active-dataset total. Native function comparison initially differed because
the earlier staging definitions retained Windows line endings; normalizing to
LF produced matching definitions for all 45 functions. No SQL repair was needed.

Permission checks used database catalog privileges and function-definition
comparison. No test records or account activations were used in production.
The previously tested staging/PGlite authorization flows remain the functional
evidence for those same definitions.

Post-rollout security advisors retain the same three pre-existing warning
categories: anon/authenticated execution of `rls_auto_enable`, and disabled
leaked-password protection. No new security warning appeared. The 20 new
service-only tables add informational RLS-without-policy notices; direct
public-role table access remains revoked. Existing advisory review and links
are in [the readiness assessment](PRODUCTION_READINESS_2026-11-02.md).
Performance advisors returned informational unindexed-foreign-key and unused-index
notices, without a performance warning; no unrelated index work was performed.

## Application and activation boundary

The existing production backend was left on its prior application revision.
Main remained `71ca4a0d5d12e1082ca3f415d5de7e99ca8f056f`; no merge or main push
occurred. No frontend deployment or application-environment/feature-flag update
was performed. In addition to the application boundary, empty source and import
tables mean this schema rollout registered no company or model approval.
No staging credential or simulation policy was copied into production.

The next step is the separately approved compatible code deployment, with new
features held off, followed by production-specific onboarding and controlled
activation. Continue at the application-deployment section of the
[rollout checklist](PRODUCTION_COMPANY_IMPORT_ROLLOUT_2026-11-02.md).
S4 remains partial; applying a schema does not establish alert-latency or
notification-delivery guarantees.

Evidence: [migration execution, privileges and checksums](evidence/production_schema_rollout_2026-11-02.json),
[read-only runtime check](evidence/production_schema_runtime_2026-11-02.json), and
[approved source manifest](evidence/production_release_migration_manifest_2026-11-02.json).
