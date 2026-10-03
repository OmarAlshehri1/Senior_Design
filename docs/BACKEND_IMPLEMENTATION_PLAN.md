# Backend Implementation Plan — Team M004

Last updated: 2026-10-03
Owner scope: CS — C1, C3, and the CS portions of IS1 and IS3

## How to use this file

- `[x]` completed and verified.
- `[ ]` not completed yet.
- The item labeled **CURRENT** is the task being implemented now.
- Do not mark an item complete until its tests pass.
- Add the commit and pull-request number after each merged phase.
- Before starting new work: switch to `main`, pull with `--ff-only`, verify a clean status, then create a feature branch.

Preserve existing uncommitted work when preparing a branch; never reset, clean, or replace the worktree to satisfy the clean-status rule. The documentation PR uses `feature/backend-handoff-plan` and includes the reviewed handoff source document. The existing `backend/requirements.txt` change remains intact and is excluded from the documentation commit.

## Scope provenance and evidence baseline

Phases 0–12 retain their historical implementation records and evidence. Their live database counts, coverage, latency, and local E2E observations describe the recorded verification run, not a fresh inspection of the live database. Migrations 001–011 exist in the repository; their presence does not prove application to any live database.

Phases 13–24 implement the approved order for Omar's requests in [Backend_Final_Handoff_Tasks.docx](Backend_Final_Handoff_Tasks.docx). References below use its numbered sections. These requests define agreed project work; they do not establish formal rubric wording. No official rubric is present in the inspected repository. C1, C3, IS1, IS3, and numerical targets are recorded project references awaiting comparison with the official rubric in Phase 23. PDF remains conditional on a confirmed requirement.

Local inspection baseline on 2026-10-03 at `f9c7dd5`:

- Backend: Python 3.12.10, `129 passed`, one known Starlette TestClient deprecation warning; external services mocked in tests.
- Frontend: `204 passed`; `npm run lint` passed.
- `git diff --check` passed during inspection.
- Production build was not run during this inspection. Earlier build successes remain historical evidence; run build before any documentation or implementation commit and record the actual result.
- No new live database verification, model training, throughput benchmark, or deployment was performed.

Documentation pre-commit verification on 2026-10-03 (same application source at `f9c7dd5`): backend `129 passed` with the known Starlette TestClient warning; frontend `204 passed`; frontend lint and production build passed. The build was actually run with `npm run build` (Vite 8.2.2, 138 modules). `git diff --check` and the documentation/source secret scan passed. The handoff DOCX text, XML metadata, relationships, and archive contents were reviewed: no detected credentials or private contact/path data; metadata identifies a generic document generator, with no tracked revisions, external relationships, or embedded attachments. These checks supersede the build-not-run status of the earlier inspection, without changing its historical record. Tests used the existing local pinned-dependency environment; the `requirements.txt` change is excluded from this documentation commit.

Each phase (and each Phase 13 subphase) uses an independent branch and PR. Before commit: appropriate tests, frontend lint/build, `git diff --check`, secret scan, and review of the exact staged files; exclude `.env`, `dist`, and unrelated changes. Then commit, push, PR, merge, and verify on `main`. Record evidence and commit/PR identifiers only after they exist. Explain and obtain user approval before live database changes, deployment, or creation of external services.

## API implementation boundaries

Implemented REST routes: health; authenticated transaction list/detail/create; authenticated alert list/review; authenticated report list/generation/CSV download; identity/session/access-request/user management; and Phase 15 review history/audit-event reads. `/ws/alerts` authenticates bearer tokens after connection. Review writes are transactionally recorded by migration 014. The project owner confirmed migrations 013 and 014 applied successfully to Supabase; this is owner-reported evidence, not an independent live-schema inspection.

- `GET /api/v1/dashboard/summary`: documented shape only; no router implementation. Implement the agreed summary scope in Phase 20.
- `GET /api/v1/audit-rules`: documented shape only; no router implementation. Add authoritative read-only rule definitions in Phase 20; the five rule implementations already exist.
- Evaluation coverage: migration 006 and repository calculation exist, but no public analytics endpoint or activated frontend analytics service. Complete in Phase 20.
- Auth, Users, Access Requests, Reviews, Audit Log, Teams, Assignments, scoped activity, Notifications, and alert reconnect catch-up are implemented on `main` in Phases 14-17. The owner confirmed migrations 013-016 were applied in Supabase; there was no independent live-schema query.
- Local CORS preflight permits `Authorization`; Phase 24 configures and verifies the approved production origin.
- Phase 17 replaced first-page-only alert loading with paginated actor-scoped reconciliation and data-free WebSocket invalidation; PR #30 is merged. Migration 016 application is owner-reported.

## Target runtime architecture

```text
React frontend
    -> FastAPI REST API
    -> Supabase PostgreSQL
    -> audit-rule evaluation
    -> Isolation Forest anomaly scoring
    -> combined risk score (0-100)
    -> alerts, explanations, and reports
    -> FastAPI responses
    -> React frontend
```

The Excel dataset is not a runtime data source. It is retained only as a reproducible offline seed and evaluation tool. The website must read operational data from Supabase through FastAPI.

## Contract rules

- Backend JSON uses `snake_case`.
- Frontend adapters convert backend fields to React-friendly names.
- Backend is authoritative for rules, scores, risk levels, alerts, and explanations.
- Never expose `SUPABASE_SECRET_KEY` to the frontend.
- Never return `ground_truth` through the public API.
- Never use `ground_truth` as an Isolation Forest input feature.
- Do not change shared field names without coordinating frontend and backend.

## Current API transaction shape

The backend must return these fields even when future evaluation values are `null`:

```json
{
  "id": "EXP-2026-006253",
  "timestamp": "2026-09-28T08:00:00Z",
  "vendor_id": "VEN-001",
  "vendor_name": "Example Vendor",
  "vendor_monitoring_status": null,
  "category": "Inventory",
  "amount": 18750,
  "currency": "SAR",
  "rule_status": "NOT_EVALUATED",
  "rule_score": null,
  "ai_score": null,
  "risk_score": null,
  "risk_level": null,
  "data_quality_status": "PARTIAL",
  "missing_fields": ["approval_limit"],
  "rule_results": [],
  "explanation": null
}
```

Paginated collection:

```json
{
  "items": [],
  "total": 10000,
  "page": 1,
  "page_size": 25
}
```

## Phase 0 — Safe project workflow

- [x] Confirm GitHub authentication and repository push permission.
- [x] Confirm local `main` tracks `origin/main`.
- [x] Create Python 3.12 virtual environment under `backend/.venv`.
- [x] Install backend dependencies.
- [x] Establish feature-branch and pull-request workflow.
- [x] Keep `.env` ignored by Git.
- [x] Verify no real Supabase secret is staged.

Evidence:

- PR #3 merged.
- PR #4 merged.
- PR #5 merged.
- Baseline on 2026-10-01: `8 passed`.

## Phase 1 — Standardized ingestion and C1 foundation

- [x] Define the standardized transaction input schema.
- [x] Validate a single transaction with Pydantic.
- [x] Report `COMPLETE` or `PARTIAL` data quality.
- [x] Report missing fields instead of inventing values.
- [x] Create an adapter for the SME retail source schema.
- [x] Map all 10,000 source records into the standardized schema.
- [x] Accept 10,000 rows with zero rejected rows.
- [x] Keep source metadata separate from standardized fields.
- [x] Separate evaluation labels into `ground_truth`.

Evidence:

- PR #3: transaction ingestion endpoint.
- PR #4: Excel adapter and 10,000-row seed import.
- Local import result: 10,000 accepted, 0 rejected.

## Phase 2 — Supabase persistence

- [x] Create the `transactions` table migration.
- [x] Enable Row Level Security.
- [x] Grant server-side `service_role` access.
- [x] Store transactions using 500-row upsert batches.
- [x] Load all 10,000 seed records into Supabase.
- [x] Keep `ground_truth` separate from transaction metadata.
- [x] Add mocked repository tests.

Evidence:

- PR #5 merged.
- Live persistence verification: 10,000 records stored.

## Phase 3 — Supabase runtime transaction API

Branch: `feature/supabase-transaction-api`

- [x] Add repository functions for paginated reads and lookup by transaction ID.
- [x] Map database `transaction_timestamp` to API `timestamp`.
- [x] Map database `completeness_status` to API `data_quality_status`.
- [x] Exclude `ground_truth` from every public query and response.
- [x] Implement `GET /api/v1/transactions?page=1&page_size=25`.
- [x] Return `items`, `total`, `page`, and `page_size` exactly as expected by the frontend.
- [x] Implement `GET /api/v1/transactions/{transaction_id}`.
- [x] Return `404` for an unknown transaction ID.
- [x] Change `POST /api/v1/transactions` to return the transaction object directly.
- [x] Remove the duplicated `@router.post("")` decorator.
- [x] Add repository read tests using mocked Supabase responses.
- [x] Add API tests for pagination, lookup, `404`, and storage errors.
- [x] Perform a live read test against the 10,000 Supabase records.
- [x] Update `docs/API_CONTRACT.md`.
- [x] Run all backend tests.
- [x] Push, open PR, review, and merge (PR #6).

Acceptance criteria:

- Page 1 returns 25 records.
- `total` returns 10,000.
- Individual lookup returns the requested transaction.
- No API response contains `ground_truth`.
- Response field names match `transactionAdapter.js`.

## Phase 4 — Move Excel out of runtime

- [x] Remove `POST /api/v1/transactions/import` from the public runtime API.
- [x] Remove `File`, `UploadFile`, and multipart handling from the transaction router.
- [x] Move the SME adapter and workbook parser under an offline seed-tool location.
- [x] Add a command such as `python -m scripts.seed_transactions` for reproducible seeding.
- [x] Require an explicit confirmation flag before modifying Supabase.
- [x] Keep the 10,000-row dataset only as seed/evaluation evidence.
- [x] Move `openpyxl` out of production runtime requirements.
- [x] Remove `python-multipart` if no runtime endpoint needs it.
- [x] Replace endpoint tests with offline seed-tool tests.
- [x] Update API documentation to state that runtime data comes from Supabase.

- [x] Commit, push, open PR, review, and merge (PR #7).

Acceptance criteria:

- The website and runtime backend work without reading an Excel file.
- Seed tooling can rebuild the Supabase dataset when explicitly requested.

## Phase 5 — C3 missing-field rule eligibility

- [x] Define required fields for each audit rule.
- [x] Implement a shared eligibility checker.
- [x] Mark unavailable rules as `NOT_EVALUATED`.
- [x] Return the missing required fields in each rule result.
- [x] Add tests for complete, partial, and insufficient transactions.

- [x] Commit and merge the rule-eligibility foundation (PR #8).

Planned eligibility matrix:

| Rule key | Minimum required fields |
| --- | --- |
| `segregation_of_duties` | `created_by`, `approved_by` |
| `approval_limits` | `amount`, `approval_limit` |
| `duplicate_payment` | `vendor_id` or normalized vendor, `invoice_number`, `amount` |
| `invoice_splitting` | vendor identity, `amount`, `timestamp`, approval threshold/window configuration |
| `ghost_vendors` | vendor identity and vendor-master reference data |

The exact duplicate-payment and invoice-splitting definitions must be confirmed with the team before freezing the rules.

## Phase 6 — Five audit rules and rule score

- [x] Build the versioned rule-engine foundation and execute eligible rules independently.

- [x] Implement Segregation of Duties.
- [x] Implement Approval Limits.
- [x] Implement Duplicate Payment against Supabase history.

- [x] Commit and merge the Duplicate Payment rule (PR #10).
- [x] Implement Invoice Splitting against Supabase history.

- [x] Commit and merge the Invoice Splitting rule (PR #11).
- [x] Implement Ghost Vendors using a project-controlled authoritative vendor registry and manual-review workflow.
- [x] Commit and merge the Ghost Vendors rule (PR #12).
- [x] Connect the transaction page to live FastAPI and Supabase data with 100-row pagination.
- [x] Apply database-backed search and timestamp/amount sorting across the full transaction collection.
- [x] Commit and merge the live transaction-data integration (PR #13).
- [x] Store a version for every rule definition.
- [x] Produce `PASSED`, `FAILED`, or `NOT_EVALUATED` per rule.

- [x] Commit and merge the first Phase 6 rule-engine slice (PR #9).
- [x] Calculate authoritative `rule_score` from eligible rules only using equal weighting.
- [x] Commit and merge the authoritative rule-score calculation (PR #14).
- [x] Persist versioned rule results and rule scores in Supabase.
- [x] Commit and merge versioned transaction-evaluation persistence (PR #15).
- [x] Add unit tests and controlled labeled cases for all five rules.

## Phase 7 — IS1 automated evaluation coverage

- [x] Define the evaluation denominator precisely.
- [x] Record whether each posted transaction was automatically evaluated.
- [x] Calculate automated evaluation coverage.
- [x] Demonstrate 100% coverage across 10,001 stored transactions.
- [x] Document which transactions could not be evaluated and why; the verified backfill left zero unevaluated transactions.
- [x] Commit and merge automated evaluation coverage (PR #16).

Target:

```text
automated evaluation coverage >= 95%
```

## Phase 8 — Isolation Forest anomaly scoring

- [x] Define allowed ML input features.
- [x] Exclude identifiers, target labels, and `ground_truth` from training features.
- [x] Clean and encode the Supabase training data reproducibly.
- [x] Split training and evaluation data without label leakage.
- [x] Train an Isolation Forest baseline.
- [x] Convert anomaly output into `ai_score` from 0 to 100.
- [x] Select and document the anomaly threshold.
- [x] Version and persist the model artifact or model configuration.
- [x] Measure detection rate and false-positive rate against held-out labels.
- [x] Persist `ai_score` for evaluated transactions.
- [x] Commit and merge Isolation Forest anomaly scoring (PR #17).

Targets:

- Detection rate `>= 85%`.
- False-positive rate `<= 10%`.

## Phase 9 — IS3 combined risk score

- [x] Confirm score rounding and missing-score policy with the team.
- [x] Calculate `risk_score = 0.60 * rule_score + 0.40 * ai_score`.
- [x] Keep the final score within 0–100.
- [x] Classify `LOW` as 0–49.
- [x] Classify `MEDIUM` as 50–74.
- [x] Classify `HIGH` as 75–100.
- [x] Persist the combined score and scoring version.
- [x] Return rule results, anomaly score, combined score, and explanation inputs.
- [x] Add unit and integration tests.
- [x] Commit and merge combined risk scoring (PR #18).

## Phase 10 — Alerts and five-second latency

- [x] Generate an alert for qualifying high-risk transactions.
- [x] Persist alert status as `ACTIVE` or `REVIEWED`.
- [x] Implement alert list and review endpoints.
- [x] Implement the planned WebSocket alert stream.
- [x] Measure posting-to-alert latency.
- [x] Demonstrate alert latency `<= 5 seconds`; measured 3,556.213 ms to persistence and 4,660.189 ms end-to-end through WebSocket.
- [x] Commit and merge risk alerts and live WebSocket delivery (PR #19).

## Phase 11 — Reports and Gemini explanations

- [x] Generate daily audit summaries from stored evaluation results.
- [x] Implement report list, generation, and download endpoints.
- [x] Commit and merge daily audit reports (PR #20).
- [x] Generate explanations only after authoritative scoring.
- [x] Ensure Gemini explanations never modify scores or rule outcomes.
- [x] Handle unavailable Gemini service without losing audit results.
- [x] Commit and merge versioned Gemini explanations (PR #21).

## Phase 12 — Frontend integration and deployment coordination

- [x] Activate the API data source with the frontend implementation.
- [x] Configure `VITE_API_BASE_URL` and `VITE_WS_URL` for local integration.
- [ ] Configure the deployed frontend API and WebSocket environment variables.
- [ ] Configure backend CORS for the approved Vercel origin.
- [x] Map backend `missing_fields` into `dataQuality.missingFields`.
- [x] Display transaction and alert date/time values from authoritative timestamps.
- [x] Map authoritative rule, AI, combined-risk, and Gemini explanation fields.
- [x] Remove automatic mock transaction and alert fallback from API mode.
- [x] Integrate durable alert listing, review updates, and `alert.created` WebSocket delivery.
- [x] Integrate persisted daily report listing, generation, summaries, and CSV download.
- [ ] Deploy FastAPI to the selected backend host.
- [ ] Store secrets only in backend host environment variables.
- [x] Run a local end-to-end test: frontend -> FastAPI -> Supabase -> frontend. Live verification loaded persisted alerts, changed an alert from `ACTIVE` to `REVIEWED`, received a newly generated high-risk alert through WebSocket without refreshing, generated `RPT-2026-10-03`, and downloaded its CSV.
- [x] Commit and merge live frontend API integration (PR #22).
- [ ] Configure deployed frontend and backend environments, approved CORS origins, and production secrets (deferred to Phase 24).

Deployment items above remain incomplete. Render backend and Vercel frontend are selected; the Render free/paid plan is undecided. Complete Phase 12 deployment work in Phase 24 after approval. The recorded local E2E covers the core integration, not the final three-role workflow.

## Phase 13 — Transaction integrity

### Phase 13A — Safe transaction creation

Omar mapping: section 2 (overwrite protection/create-safe semantics), section 13 (overwrite tests); preserve section 11 transaction integration.

- [x] Introduce runtime create semantics separate from offline seed upsert.
- [x] Return `409 Conflict` for an existing transaction ID without changing any existing transaction or derived record.
- [x] Enforce uniqueness at the persistence boundary, including concurrent requests; a pre-read check alone is insufficient.
- [x] Preserve explicitly confirmed, idempotent seed upsert and existing API/adapters.

Acceptance criteria:

- A new valid ID returns `201` and retains the existing response contract.
- Repeated and concurrent submissions for the same ID produce exactly one creation; losing submissions return `409`, with no overwrite or duplicate downstream effects.
- Repository/API tests exercise duplicate conflict mapping and concurrent creation at the persistence boundary; validation and storage errors remain distinguishable.
- Seed tests still prove confirmation is required and repeated seeding uses the separate upsert path.

Evidence: branch `feature/safe-transaction-create`; backend `140 passed` (one known Starlette warning). `test_transaction_creation.py` drives sequential/concurrent API calls through the real insert repository with a constraint-backed SQLite HTTP transport; duplicate/error classification and no processing after insert failure are covered. Existing seed tests prove repeated confirmed calls use upsert. No PostgreSQL server/docker was available locally; the concurrency harness is not live PostgreSQL verification. Migration 001 already defines the primary key, so no new migration is required. PR #24; implementation `70b47f3`, merge `f470175`. Main verification: backend 140 passed, frontend 204 passed, lint/build and diff check passed.

### Phase 13B — Atomicity or durable recovery (locally verified; live activation pending)

Omar mapping: section 2 (creation/evaluation/scoring/alert integrity), section 13 (partial failures/rollback); dependency: Phase 13A.

- [x] Document and implement the selected database atomicity and/or durable recovery design for transaction, evaluation, anomaly score, combined score, and alert persistence.
- [x] Define response semantics, durable processing state, retry ownership, idempotency, and recovery after process restart.
- [x] Publish alerts only after durable alert persistence; preserve advisory Gemini failure isolation.

Acceptance criteria:

- Inject failures at each persistence boundary and verify either rollback or a durably recorded, recoverable state; errors cannot silently strand accepted work.
- Retry/restart tests prove eventual completion without duplicate evaluations, scores, or alerts for the same processing attempt, and without overwriting the source transaction.
- Temporary rule-context lookup failures have an explicit recovery policy that prevents unavailable context from becoming permanently accepted final results.
- The design explains concurrent historical-rule evaluation, commit/publication failure windows, and the actual delivery guarantee; manual backfill alone is insufficient recovery.

Evidence: migration 012, `transaction_processing` repository/service, `test_transaction_processing.py`, and [recovery design](TRANSACTION_RECOVERY_DESIGN.md). Backend 159 passed; 13 isolated PostgreSQL/PGlite tests passed against migrations 001–012, including failure injection, idempotent completion, lease fencing/backoff, and dump/restore. The project owner confirmed migration 012 applied successfully in Supabase; this was not independently queried by the agent. The runtime flag remains false; legacy processing while disabled has no recovery guarantee.

- [x] Project owner confirmed migration 012 was applied successfully in Supabase (not independently queried).
- [ ] Verify the migration's live grants/functions, then enable `TRANSACTION_RECOVERY_ENABLED` and verify recovery on the approved backend host in Phase 24. Do not treat local test evidence as live activation.

## Phase 14 — Authentication, users, and RBAC

Omar mapping: sections 1, 2, 11–13; dependency: Phase 13.

- [x] Integrate Supabase Auth, JWT validation, current profile/session, and AUDITOR/SUPERVISOR/ADMIN roles.
- [x] Persist ACTIVE/LOCKED/DISABLED status, login/security history, failed-login tracking, lockout policy, admin lifecycle actions, and password reset.
- [x] Persist access requests through pending, approve/reject, role assignment, and activation; require a provider-verified account-owner unlock request before an Admin can unlock a locked account.
- [x] Enforce endpoint/action and object-level authorization, including Supervisor/Admin-only transaction creation, WebSocket and authenticated report download; activate prepared frontend auth/user services.
- [x] Support `Authorization` in local CORS preflight and API transport; define token refresh/expiry and WebSocket authentication without leaking credentials.
- [x] Lock an active account after three consecutive failed sign-ins; only an active Admin may approve a pending unlock request. Document owner-only manual provisioning of the initial Admin.

Acceptance criteria:

- Missing/invalid/expired JWTs, locked/disabled accounts, prohibited roles, and unauthorized object access are rejected by the backend, including direct URLs and sockets.
- Tests verify role changes, access-request decisions, account transitions, login history/lockout, and reset/session behavior; UI visibility is not authorization evidence.
- Allowed local-origin preflight accepts authenticated requests; unknown origins remain disallowed. Supabase privileged keys remain backend-only.
- CSV download retains its UI behavior while using authenticated transport. Document contracts and local migration evidence without assuming live application.
- Three consecutive failed sign-ins lock an account; no direct Admin unlock is available without a provider-verified pending account-owner request, and only an active Admin may decide that request.
- `POST /transactions` is allowed to active Supervisor/Admin users only. Every new Auth profile is disabled; initial Admin provisioning follows [IDENTITY_BOOTSTRAP.md](IDENTITY_BOOTSTRAP.md) and requires the Supabase database owner.

Evidence: 179 backend tests passed (one existing Starlette/httpx deprecation warning), 16 isolated PGlite migration/recovery tests passed, 212 frontend tests passed, frontend lint passed, production build passed, `git diff --check` passed, and the changed-source secret scan found no matches. The project owner confirmed migration 013 applied successfully to Supabase; no independent live-schema inspection was performed.

## Phase 15 — Reviews and immutable accountability

Omar mapping: section 3, sections 11–13; dependency: Phase 14.

- [x] Project owner chose to allow reopening completed reviews, retaining each transition in history.
- [x] Persist transaction and full alert reviews with actor, role, notes, timestamps, and history.
- [x] Record audit events with actor/role/action/resource/resource_id/time/outcome/details, with searchable, filtered, paginated reads.
- [x] Activate review/audit/login-history services and enforce authorized scope.

Acceptance criteria:

- Review updates retain prior history and attributed notes; repeated/concurrent requests follow documented semantics.
- Important mutations record attributable outcomes; application callers cannot rewrite/delete accountability history.
- Tests verify query filters/pagination, unauthorized access, role scope, and preservation of history after state changes. Team scope is completed with Phase 16.
- Admins can query all audit events; until Phase 16 provides team relationships, Supervisors are restricted to events they performed. Auditors cannot query the audit log.

Phase 15 is complete on `main`: PR #27, merge `4d987ce`. Main verification on 2026-10-03 passed: backend `187 passed` (one known Starlette/httpx deprecation warning), 20 isolated PGlite migration tests, frontend `214 passed`, frontend lint, production build, and `git diff --check`. The project owner confirmed migrations 013 and 014 applied successfully to Supabase. Phase 16 later added team-scoped Supervisor audit visibility.

## Phase 16 — Teams and assignments (complete on main)

Omar mapping: section 4, sections 3 and 11–13; dependency: Phases 14–15.

- [x] Persist teams/membership and supervisor relationships; expose activity and workload through scoped API and frontend services.
- [x] Implement assign/reassign/unassign and immutable assignment history; activate the assignment dialog and team activity view.
- [x] Apply team scope to alert listing, review history, and audit events; preserve the documented API response shapes.

Acceptance criteria:

- Admin has global alert/team visibility. An Auditor sees only alerts currently assigned to that Auditor. A Supervisor sees that Supervisor's team queue and unclaimed alerts, and cannot access another team's assigned alerts.
- A Supervisor may assign an alert to an active Auditor or active Supervisor in the same team; Admin may assign across teams. Assignment mutations are serialized per alert, preserve append-only history, and record the actor in the audit log.
- Admin creates/updates/deactivates teams, manages global membership, and may transfer Auditors between teams. A Supervisor may add/remove active Auditors only in the Supervisor's own team; members with assigned alerts must be reassigned or unassigned first.
- Team workload/activity counts are based on current assignments and team-attributed review events, without double counting reassignment history.
- Tests cover cross-team denial, concurrent assignment, membership changes and restrictions, unassignment, activity/workload accuracy, review/audit team scope, API role gates, and CORS preflight for team-management DELETE requests.
Phase 16 is complete on `main`: PR #29, implementation `a65e5b7`, merge `3630bd9`. Main verification passed backend `195 passed` (one known Starlette/httpx warning), 23 isolated PGlite migration tests, frontend `214 passed`, frontend lint, production build, and `git diff --check`. The project owner confirmed Migration 015 applied successfully to Supabase; no independent live-schema inspection was performed.

## Phase 17 — Notifications and alert catch-up

Omar mapping: sections 5, 2 (WebSocket), 11 and 13; dependency: Phases 14–16.

- [x] Persist user/role-scoped notifications with list/read/unread/mark-one/mark-all operations (PR #30; Migration 016 owner-reported applied).
- [x] Connect alert, assignment, access-request, and account/security events. Case/SLA/closure notifications are handled in Phase 18.
- [x] Reconcile durable alerts after WebSocket reconnect with pagination and persisted-ID deduplication (PR #30).

- Owner-approved notification recipients: high-risk alerts go to active Admins and active Supervisors; assignment/reassignment goes to the target assignee and that team Supervisor; new access/unlock requests go to active Admins; approved access requests may notify the activated request owner. Rejected access requests stay in the Admin request/audit records and send no in-app notification until a safe delivery channel is selected; lock/unlock events go to the account owner and active Admins.
- An Auditor receives alert notification content only while that alert is within the Auditor current assignment scope. WebSocket messages carry no alert row or ID; REST reconciliation enforces the current server-side scope.
Acceptance criteria:

- Notifications survive restart and are inaccessible to other users; repeated event handling does not duplicate them.
- Tests verify read-state operations, event recipients, and audit/security linkage.
- Disconnect/create/reconnect tests recover missed alerts across more than one page without duplicate entries; review states reconcile from REST rather than stale socket state.

## Phase 18 — Cases, evidence, closure, and SLA (CURRENT)

Omar mapping: section 6, sections 11–13; dependency: Phases 14–17.

- [ ] Create cases only from explicit Alert or Transaction actions; implement OPEN, INVESTIGATING, ESCALATED, RESOLUTION_REQUESTED, RESOLVED, CLOSED and priority/reference/department where configured. This phase starts on `feature/cases-evidence-sla` after PR #30 and main verification; Migration 016 was then reported applied by the owner.
- [ ] Persist assignments, discussions, activity, resolution, and evidence metadata; validate authorized uploads/storage and scanning before enabling attachments.
- [ ] Implement auditor closure requests and policy-controlled supervisor/admin approval/rejection.
- [ ] Persist SLA deadlines and implement server-side overdue escalation with audit events and notifications.

- Owner-approved policy: LOW 72 hours, MEDIUM 48, HIGH 24, CRITICAL 8. An overdue case changes to ESCALATED and notifies its assignee, team Supervisor, and all active Admins. Closure is requested by an assigned Auditor; an active Supervisor may decide only for the same team, an active Admin may decide globally, and the requester cannot decide their own request. Rejected closure reopens investigation and restarts its SLA deadline.
- Evidence acceptance is fail-closed: PDF/PNG/JPEG only, maximum 10 MiB, signature/MIME checked, antivirus scanned, and stored in a private Supabase Storage bucket. Migration 017 stores metadata but does not create the bucket or scanner service. `CASE_EVIDENCE_BUCKET` and `CASE_ANTIVIRUS_EXECUTABLE` remain deployment configuration; the UI stays disabled until both are available and the bucket is private.
- Server-side escalation runs in the API lifespan when `CASE_SLA_ESCALATION_ENABLED=true`; the database batch RPC uses row locks and state predicates for multiple-instance retry safety. Phase 24 must enable/verify the worker on the chosen Render topology; a sleeping or stopped instance cannot run it.

Acceptance criteria:

- Alerts do not automatically become cases; transition/closure tests reject unauthorized or invalid actions and retain resolution/history.
- Evidence tests verify type/size validation, access restrictions, unsafe-upload handling, and metadata/storage consistency.
- SLA escalation works with no browser open, survives restart, and does not duplicate events on retry. Case notifications and audit events have verified recipients/actors.

Phase 17 complete: PR #30 (`d9fe6ee`, merge `1e7e311`). Main verification passed backend 198 tests, 24 isolated PGlite tests, frontend 217 tests, lint/build, and `git diff --check`; migration 016 application was reported by the owner.

## Phase 19 — Vendor monitoring workflows

Omar mapping: section 7, sections 11–13; dependency: Phases 14–18.

- [ ] Extend the approved-vendor registry with list/profile, transaction/alert/case/risk history, and monitoring state.
- [ ] Implement auditor watchlist request and supervisor decision; supervisor block request and admin decision/block/unblock; watchlist removal and history.

Acceptance criteria:

- Role and object-scope tests cover each decision and denied action; state changes preserve accountable history and integrate audit/notifications.
- Ghost Vendor behavior remains compatible with registry authority and unavailable states.
- Backend contracts and UI wording describe blocking in audit monitoring; no ERP payment prevention is claimed without a separate real integration.

## Phase 20 — Authoritative analytics and read endpoints

Omar mapping: section 8, sections 11–13; dependency: Phases 14–19.

- [ ] Expose overall evaluation coverage, per-rule coverage, and reasons for NOT_EVALUATED/insufficient data.
- [ ] Implement risk/violation trends and agreed dashboard summaries from authoritative data.
- [ ] Implement the documented dashboard summary and read-only audit-rule-definition endpoints; activate analytics services and preserve adapters.

Acceptance criteria:

- Tests verify denominators, latest-snapshot selection, period boundaries, empty datasets, per-rule missing/context reasons, and authorized scope.
- Overall coverage counts transactions with at least one executed rule; it does not imply all five rules executed for every transaction.
- Trends/summaries use defined time windows and full scoped data, not the current frontend page or fake records. Published endpoint contracts match implemented responses.

## Phase 21 — Settings persistence

Omar mapping: section 10, sections 11–13; dependency: Phase 14 and relevant domain implementations.

- [ ] Agree which existing frontend settings require persistence; implement authorized read/update and activate the settings service.

Acceptance criteria:

- Validation, unauthorized update, persistence/reload, and audit-history tests pass for each editable setting.
- The 60/40 policy, score boundaries, and model/rule methodology remain fixed unless a separate explicit project decision approves a versioned change.
- Unsupported settings retain truthful unavailable/read-only states.

## Phase 22 — Automatic daily reports

Omar mapping: section 9, sections 11–14; dependency: Phases 13B–14 and completed report integration.

- [ ] Add server-side daily scheduling, execution history, retry/catch-up, and duplicate-run handling while preserving stored authoritative summaries and CSV.
- [ ] Add PDF only if the official rubric or an explicit project decision confirms it is required.
- [ ] Preserve Gemini after authoritative scoring and its optional-failure behavior.

Acceptance criteria:

- With no browser open, a scheduled run generates the intended half-open UTC daily period and records success/failure.
- Tests cover restart, missed runs, repeated/concurrent runs, and partial failure without losing prior report history; document report regeneration/version semantics.
- Authorized list/generation/download still work; CSV stays available. PDF has separate acceptance evidence only if required.
- Scheduling infrastructure that creates an external service is explained and approved before creation; deployed scheduling is verified in Phase 24.

## Phase 23 — Performance and requirements evidence

Omar mapping: sections 13–14; dependency: Phases 13–22.

- [ ] Obtain the official rubric and map each applicable specification/integrated specification/constraint to wording, owner, test, artifact, and unresolved gaps.
- [ ] Package rule/schema/eligibility/coverage/model/combined-score evidence with versions, dates, dataset scope, and reproducible commands.
- [ ] Run actual throughput and alert-latency benchmarks; distinguish accepted, fully processed, and failed transactions.

Acceptance criteria:

- Report evidence for all five rules, coverage >= 95%, detection >= 85%, false positives <= 10%, combined 60/40 scoring, latency <= 5 seconds, throughput >= 10,000 transactions/day, and automatic daily reports as recorded project targets; confirm grading interpretation against the rubric.
- Benchmarks record environment, concurrency, duration, error rate, latency distribution, and Gemini-enabled/disabled behavior. Dataset row count is not throughput evidence, and one historical latency observation is not a load guarantee.
- Each claim distinguishes historical evidence from a current rerun. Missing rubric wording or failing targets remain unresolved, not marked complete.

## Phase 24 — Approved deployment and final three-role E2E

Omar mapping: sections 2, 11–15; dependency: Phases 13–23 and explicit deployment approval.

- [ ] Complete the unfinished Phase 12 hosting/env/CORS items on Render and Vercel after selecting and approving the Render plan.
- [ ] Explain and obtain approval for live migrations, deployment, and external services; configure approved origins and backend-only secrets without committing `.env` or `dist`.
- [ ] Document the chosen worker/instance topology and WebSocket delivery/recovery design; an in-process manager does not broadcast across workers/instances.
- [ ] Run deployed E2E for Auditor, Supervisor, and Admin, including direct URLs and denied backend actions.

Acceptance criteria:

- Verify login/role -> dashboard/transactions -> rules/AI/risk -> alerts/review/assignment -> case/evidence/discussion/closure -> vendor workflow -> audit log/notifications -> reports/analytics for each permitted role.
- Production Authorization/CORS, authenticated CSV/WebSocket, reconnect catch-up, restart behavior, deployed scheduling, and relevant performance targets pass on the selected hosting topology.
- Verify approved migrations and actual environment configuration; do not infer them from local files. Final handoff lists endpoints, migrations, env names without secrets, results/evidence, and remaining gaps.

## Specification verification checklist

The following entries are retained project targets, not independently verified official rubric wording. Final rubric mapping and evidence packaging belong to Phase 23; deployment evidence belongs to Phase 24.

- [ ] C1 evidence: source adapter, standardized mapping, tests, and seed tool.
- [ ] C3 evidence: missing-field eligibility matrix, source code, and tests.
- [ ] IS1 evidence: automated evaluation coverage `>= 95%`.
- [ ] IS3 evidence: rule + anomaly combined risk score for each evaluated transaction.
- [ ] Five-rule coverage `>= 90%` of the five named rules; implementation target is 5/5.
- [ ] Detection rate `>= 85%`.
- [ ] Throughput `>= 10,000 transactions/day`.
- [ ] Alert latency `<= 5 seconds`.
- [ ] False-positive rate `<= 10%`.
- [ ] Daily automated risk-summary report.

## Estimated attainment of the assigned CS scope

These are historical implementation estimates retained from Phases 0–12, not current completion percentages or final evaluation grades. They exclude Omar's newly planned operational domains and require rubric/evidence reconciliation in Phase 23.

| Requirement | Current estimate | What is already proven | Main remaining work |
| --- | ---: | --- | --- |
| C1 | 95% | standardized schema, offline SME adapter, and 10,000 rows mapped into Supabase | package final mapping and test evidence |
| C3 | 100% | all five versioned rules execute independently and missing fields remain isolated per rule | package final test and live-verification evidence |
| CS part of IS1 | 100% | all five rules and 100% automated evaluation coverage across the controlled dataset | package final test and live-verification evidence |
| CS part of IS3 | 100% | authoritative rule score, versioned Isolation Forest score, and persisted 60/40 combined risk score are implemented | package final test and live-verification evidence |

## Change log

| Date | Change | Evidence |
| --- | --- | --- |
| 2026-09-28 | Added standardized transaction ingestion | PR #3 |
| 2026-09-28 | Added SME dataset adapter and 10,000-row import | PR #4 |
| 2026-09-30 | Added Supabase persistence | PR #5 |
| 2026-10-01 | Added Supabase runtime transaction read API | PR #6 |
| 2026-10-01 | Moved Excel import out of runtime into an offline seed tool | PR #7 |
| 2026-10-01 | Added per-rule missing-field eligibility checks | PR #8 |
| 2026-10-01 | Added versioned rule engine with Segregation of Duties and Approval Limits | PR #9 |
| 2026-10-01 | Added Duplicate Payment detection against Supabase history | PR #10 |
| 2026-10-02 | Added Invoice Splitting detection with a 24-hour Supabase window | PR #11 |
| 2026-10-02 | Added Ghost Vendor detection with an authoritative approved-vendor registry | PR #12 |
| 2026-10-02 | Connected the frontend transaction view to live paginated Supabase data | PR #13 |
| 2026-10-02 | Added authoritative rule-score calculation across eligible rules | PR #14 |
| 2026-10-02 | Added versioned transaction-evaluation persistence | PR #15 |
| 2026-10-02 | Measured 100% automated evaluation coverage | PR #16 |
| 2026-10-02 | Added versioned Isolation Forest anomaly scoring | PR #17 |
| 2026-10-03 | Added persisted 60/40 combined risk scoring | PR #18 |
| 2026-10-03 | Added persisted real-time high-risk alerts | PR #19 |
| 2026-10-03 | Added persisted daily audit reports | PR #20 |
| 2026-10-03 | Added versioned advisory Gemini explanations after authoritative scoring | PR #21; `0d7c85a`, merge `3ad0831` |
| 2026-10-03 | Connected live alerts, authoritative risk/explanations, and persisted reports in the frontend | PR #22; `a8e1b8a`, `eb38337`, merge `f9c7dd5` |
| 2026-10-03 | Added approved handoff Phases 13–24, split 13A/13B, deferred deployment, and included reviewed handoff source | PR #23; `0aca9ed`, merge `3a07512` |
| 2026-10-03 | Added Supabase Auth/JWT, account/access requests, backend RBAC, and authenticated frontend transport | PR #26; `8e3bcf2`, merge `acb1996` |
| 2026-10-03 | Added attributable reopenable reviews and immutable audit history | PR #27; `2e4fefc`, merge `4d987ce`; owner confirmed migration 014 applied |
| 2026-10-03 | Added team-scoped assignments and activity | PR #29; `a65e5b7`, merge `3630bd9`; owner confirmed migration 015 applied |
| 2026-10-03 | Added durable notifications and paginated alert reconnect catch-up | PR #30; `d9fe6ee`, merge `1e7e311`; owner confirmed migration 016 applied |

## Next action

Phases 13A/13B and 14-17 are merged and verified on `main`. PR #30 (`d9fe6ee`, merge `1e7e311`) completed Notifications and alert reconnect catch-up. Main verification on 2026-10-03 passed backend 198 passed (known Starlette warning), 24 isolated PGlite migration tests, frontend 217 passed, lint/build, and `git diff --check`. The project owner confirmed migrations 013-016 applied successfully; this is owner-reported and was not independently queried. Phase 18 is current on `feature/cases-evidence-sla`; migration 017 is not applied. The user requirements change in `backend/requirements.txt` and backup stash remain preserved and excluded from phase commits.
