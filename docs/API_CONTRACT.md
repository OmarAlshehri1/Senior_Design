# Shared API Contract

This document is the preliminary contract between the React frontend and FastAPI backend. It defines planned field names and payload shapes so frontend and backend development can proceed independently.

The documented health, transaction, alert, report, CSV-download, identity, team, accountability, notification, alert WebSocket, case, vendor, Phase 20 analytics, and Phase 21 settings endpoints are implemented on `main`. The owner reported migrations 012-020 applied successfully; this was not independently queried. Shapes may be extended through team agreement, but existing names should not be changed without coordinating both branches.

Implementation status: runtime transaction creation is insert-only and returns `409` for an existing ID without overwriting it; offline seed upsert remains separate. The owner reported migrations 012-020 applied successfully in Supabase; this was not independently queried. `TRANSACTION_RECOVERY_ENABLED` remains disabled. Phase 14 adds API identity, bearer authentication, role checks, authenticated report download and WebSocket subscriptions, plus local `Authorization` CORS support. The owner confirmed `POST /transactions` is Supervisor/Admin-only; account lockout follows three consecutive failed sign-ins, and an active Admin may unlock only after the account owner verifies their email and submits an unlock request. Initial Admin provisioning is manual by the Supabase database owner as documented in [IDENTITY_BOOTSTRAP.md](IDENTITY_BOOTSTRAP.md). Phase 15 adds actor-attributed reviews and immutable audit events through migration 014. Phase 16 adds persisted teams and assignments, team-scoped alert/review/audit visibility, and team activity. Phase 17 adds durable private notifications and paginated alert catch-up. Phase 18 implements cases/evidence/closure/SLA, Phase 19 implements vendor monitoring workflows, Phase 20 implements dashboard summaries, the read-only audit-rule catalog, and authoritative analytics, and Phase 21 adds Admin-managed Organization Name settings. Automatic daily report scheduling remains Phase 22. Approved production origins and the worker/instance delivery topology are completed in Phase 24. Live measurements below are historical observations, not newly verified database state.

## Conventions

- Base REST path: `/api/v1`
- Payload field names: `snake_case`
- Content type: `application/json`
- Timestamps: RFC 3339 strings in UTC, such as `2026-09-20T14:42:03Z`
- Currency: ISO 4217 code, such as `SAR`
- Risk levels: `HIGH`, `MEDIUM`, `LOW`
- The backend is authoritative for audit decisions, scores, risk levels, alerts, and explanations.
- The frontend must not calculate or overwrite the authoritative risk score.

## Risk policy

Planned classification boundaries:

- `HIGH`: `risk_score >= 75`
- `MEDIUM`: `risk_score >= 50` and `< 75`
- `LOW`: `risk_score < 50`

The backend will eventually calculate:

```text
risk_score = (0.60 * rule_score) + (0.40 * ai_score)
```

This calculation is implemented as scoring version `1.0.0`. Both component scores must be available and valid; otherwise `risk_score` and `risk_level` remain `null` rather than assuming a missing score is zero or changing the agreed weights. Results are constrained to 0–100 and rounded to two decimal places. Risk levels are `LOW` for scores below 50, `MEDIUM` for scores from 50 to below 75, and `HIGH` for scores from 75 to 100.

## Core resource shapes

### Transaction

```json
{
  "id": "TX-10496",
  "timestamp": "2026-09-20T14:42:03Z",
  "vendor_id": "VEN-0012",
  "vendor_name": "Example Retail Supplier",
  "category": "Inventory",
  "amount": 18750.00,
  "currency": "SAR",
  "rule_status": "REVIEW",
  "rule_score": 90,
  "ai_score": 80,
  "risk_score": 86,
  "risk_level": "HIGH",
  "data_quality_status": "COMPLETE",
  "rule_results": [],
  "explanation": null
}
```

Preliminary enums:

- `rule_status`: `PASSED`, `REVIEW`, `NOT_EVALUATED`
- `data_quality_status`: `COMPLETE`, `PARTIAL`, `INSUFFICIENT`
- Scores use the inclusive range `0` through `100` when available and may be `null` while processing or when evaluation is not possible.

### RuleResult

```json
{
  "rule_key": "duplicate_payment",
  "rule_name": "Duplicate Payment",
  "rule_version": "1.0.0",
  "status": "FAILED",
  "score_contribution": 20,
  "detail": "Possible duplicate payment detected.",
  "evidence": {}
}
```

`status` is one of `PASSED`, `FAILED`, or `NOT_EVALUATED`. The final contents of `evidence` will be rule-specific and must avoid unnecessary sensitive data.

All five versioned audit rules currently execute when their required transaction fields and evaluation context are available: `segregation_of_duties`, `approval_limits`, `duplicate_payment`, `invoice_splitting`, and `ghost_vendors`. Every result includes `rule_version`.

`duplicate_payment` fails when another stored transaction has the same vendor identity, invoice number, and amount. The current transaction ID is excluded from matching. Its public evidence reports only `historical_context_available` and `matching_transaction_count`; matching transaction identifiers and private `ground_truth` labels are not exposed.

`invoice_splitting` fails when the current transaction and at least one earlier transaction for the same vendor and currency occur within the preceding 24 hours, each individual amount does not exceed the current transaction's `approval_limit`, and their combined amount exceeds that limit. A transaction without `approval_limit` remains `NOT_EVALUATED`; the backend does not invent missing approval limits. Public evidence reports only `historical_context_available`, `historical_transaction_count`, `window_total_amount`, and `window_hours`. Matching transaction identifiers and private `ground_truth` labels are not exposed.

`ghost_vendors` checks the transaction vendor against the authoritative `approved_vendors` registry. An active registered vendor passes. An unregistered or inactive vendor fails the rule and requires manual review; failure means "unregistered or inactive" and does not confirm fraud. A reviewer may approve a legitimate new vendor by adding it to the registry. If the registry is unavailable or not authoritative, the rule remains `NOT_EVALUATED`. Public evidence reports only `vendor_registry_available`, `vendor_registered`, `vendor_active`, and `manual_review_required`.

The initial approved-vendor registry is a project-controlled experimental reference prepared before runtime evaluation. Dataset labels were used only to construct and validate the experimental setup; the runtime rule and RPC never read `violation_type`, `is_anomaly`, or stored `ground_truth`.

The `evidence` object includes `eligible`, `missing_fields`, and `missing_any_of`. An ineligible rule remains `NOT_EVALUATED` without blocking other eligible rules. Rule-specific evidence must not expose unnecessary sensitive identifiers.

The overall `rule_status` is `REVIEW` when any executed rule fails, `PASSED` when at least one rule passes and none fail, and `NOT_EVALUATED` when no rule can be executed.

The authoritative `rule_score` uses equal weighting across evaluated rules only: `failed evaluated rules / all evaluated rules * 100`. `NOT_EVALUATED` rules are excluded from both numerator and denominator. The score is rounded to two decimal places, is `0` when all evaluated rules pass, and is `null` when no rule can be evaluated. A failed rule receives its equal share in `score_contribution`, a passed rule receives `0`, and a non-evaluated rule receives `null`.

Each completed evaluation is stored as a versioned snapshot in `transaction_evaluations`. Transaction reads return the latest persisted snapshot when available; transactions created before evaluation persistence continue to use safe runtime evaluation as a fallback. Evaluation storage and lookup use the service role, and persisted rule evidence never includes private `ground_truth` labels.

Automated evaluation coverage is calculated as transactions whose latest snapshot contains at least one `PASSED` or `FAILED` rule divided by all stored transactions, multiplied by 100. Rules marked `NOT_EVALUATED` do not count as executed. The controlled 10,011-transaction database currently achieves 100% coverage after the idempotent evaluation backfill; no transactions remain unevaluated.

The final Isolation Forest model `1.0.0` uses 400 isolation trees, increased from the initial 150-tree design configuration after prototype tuning, and produces `ai_score` values from 0 to 100 using transaction attributes and rule-derived runtime context only. Identifiers, `violation_type`, `is_anomaly`, and `ground_truth` are excluded from model inputs. The reproducible stratified split contains 7,000 training, 1,500 validation, and 1,500 held-out test transactions. The selected threshold is `90.6`; held-out detection rate is `87.04%` and false-positive rate is `3.45%`. Versioned scores are stored in `transaction_anomaly_scores`; the initial backfill stored 10,001 scores and classified 945 transactions above the threshold. POST evaluates and persists new scores immediately, while GET collection and detail responses return the latest persisted `ai_score`.

Combined risk scoring version `1.0.0` calculates `risk_score = (0.60 * rule_score) + (0.40 * ai_score)`. Versioned component scores, the combined score, and `risk_level` are stored in `transaction_risk_scores`; reads prefer the latest persisted snapshot and use the same deterministic formula as a safe fallback. The verified backfill stored 10,002 scores: 9,362 LOW, 640 MEDIUM, and 0 HIGH, with an observed range of 0.00–60.00. The absence of HIGH transactions reflects the controlled dataset rather than an adjustment to the agreed 75-point threshold.

### DashboardSummary

```json
{
  "total_transactions": 1248,
  "transactions_evaluated": 1231,
  "high_risk_transactions": 17,
  "medium_risk_transactions": 45,
  "low_risk_transactions": 1169,
  "average_risk_score": 28,
  "active_alerts": 5,
  "generated_at": "2026-09-20T15:00:00Z"
}
```

### Alert

```json
{
  "id": "AL-0001",
  "transaction_id": "TX-10496",
  "created_at": "2026-09-20T14:42:03Z",
  "severity": "HIGH",
  "title": "High-risk transaction detected",
  "description": "The transaction requires auditor review.",
  "reason": "Rule and anomaly results exceeded the high-risk threshold.",
  "status": "ACTIVE",
  "reviewed_at": null,
  "assignment": null
}
```

Alert `status` is `ACTIVE` or `REVIEWED`. Alerts are generated only for transactions authoritatively classified as `HIGH`. Each alert stores the combined risk score, risk-scoring version, request-received timestamp, creation timestamp, and measured `latency_ms`.

### AuditRule

```json
{
  "key": "duplicate_payment",
  "name": "Duplicate Payment",
  "description": "Detects potentially repeated payments.",
  "enabled": true,
  "version": "1.0"
}
```

The planned rule keys are `segregation_of_duties`, `approval_limits`, `duplicate_payment`, `invoice_splitting`, and `ghost_vendors`.

### RiskExplanation

The transaction `explanation` field is either a plain explanatory string or `null`. Prompt version `1.0.0` uses `gemini-3.8-flash` only after authoritative rule, anomaly, and combined-risk scoring has completed. Gemini receives sanitized transaction attributes, public rule evidence, and the already-calculated scores; identifiers, employee fields, `violation_type`, `is_anomaly`, and private `ground_truth` labels are excluded.

The generated explanation is advisory only and cannot alter rule outcomes, component scores, the combined risk score, or the risk level. Completed explanations and their model, prompt, and authoritative source versions are stored in `transaction_explanations`, and transaction reads return the latest persisted explanation. Incomplete Gemini responses are rejected. When Gemini or explanation storage is unavailable, the transaction and all authoritative audit results remain successfully stored and `explanation` is returned as `null`.

Live verification generated and persisted a 426-character explanation for `TX-GEMINI-20261003080425`; POST and subsequent GET returned identical text while preserving `risk_score` 12.0 and `risk_level` `LOW`. The measured POST duration including Gemini generation and persistence was 8,417 ms.
### Report

```json
{
  "id": "RPT-2026-09-20",
  "type": "DAILY",
  "status": "COMPLETED",
  "period_start": "2026-09-20T00:00:00Z",
  "period_end": "2026-09-21T00:00:00Z",
  "created_at": "2026-09-21T00:05:00Z",
  "download_url": "/api/v1/reports/RPT-2026-09-20/download"
}
```

Report `status` is `PENDING`, `COMPLETED`, or `FAILED`.

Daily reports use an exact half-open UTC period from midnight `period_start` through, but not including, the following midnight `period_end`. Version `1.0.0` summaries are generated synchronously from the latest stored evaluation, risk-score, and alert snapshots; scores and rule outcomes are never recalculated during reporting, and private `ground_truth` labels are never included. Live verification generated `RPT-2026-10-03` with 3 evaluated transactions, an average risk score of 75.21, a distribution of 1 LOW and 2 HIGH transactions, and 2 alerts.

## REST endpoints

### `GET /api/v1/health`

Implemented service health check.

Response `200 OK`:

```json
{
  "status": "ok",
  "service": "continuous-auditing-api"
}
```

### Identity and session endpoints

All routes below are implemented in this branch. Protected routes require `Authorization: Bearer <access_token>`. Supabase Auth validates provider tokens; the application checks an opaque token hash against `app_sessions` and the active account profile on protected requests. Tokens are returned to the authenticated client and kept in tab-scoped session storage by the frontend. The Supabase service-role key remains backend-only.

| Method and path | Access | Behavior |
|---|---|---|
| `POST /api/v1/auth/login` | Public, rate-limited | Verify credentials; return provider access/refresh tokens and current active user. |
| `POST /api/v1/auth/refresh` | Public, rate-limited | Rotate provider and application sessions; revoke the previous application token. |
| `POST /api/v1/auth/exchange` | Public, rate-limited | Verify provider-issued invitation/recovery tokens and start an application session. |
| `GET /api/v1/auth/me` | Any active session | Return current application profile. |
| `POST /api/v1/auth/logout` | Any active session | Revoke application sessions and request provider logout. |
| `POST /api/v1/auth/password-reset` | Public, rate-limited | Request provider reset instructions with a neutral response. |
| `POST /api/v1/auth/password` | Any active session | Update the provider password and revoke current application sessions. |
| `POST /api/v1/auth/unlock-request` | Public, rate-limited | Send a provider verification link; response does not disclose whether an account exists. |
| `POST /api/v1/auth/unlock-request/confirm` | Public, rate-limited, provider-verified token | Submit the verified account owner's unlock request for Admin review; this does not create an application session. |
| `POST /api/v1/access-requests` | Public, rate-limited | Create a pending request; requesters cannot choose a role. |
| `GET /api/v1/users`, `GET /api/v1/users/{id}` | Admin | List or read account profiles. |
| `PATCH /api/v1/users/{id}` | Admin | `role`, `disable`, or `enable`; lifecycle changes revoke existing sessions. Unlocks require the separate request workflow. |
| `GET /api/v1/users/{id}/login-history` | Self or Admin | Read paginated sign-in/security history. |
| `GET /api/v1/access-requests` | Admin | List pending and decided requests. |
| `POST /api/v1/access-requests/{id}/decision` | Admin | Approve with a role or reject with an optional reason. |
| `GET /api/v1/account-unlock-requests` | Admin | List account-owner unlock requests. |
| `POST /api/v1/account-unlock-requests/{id}/decision` | Admin | Approve or reject a pending unlock request; approval resets failed attempts and revokes old sessions. |

Login, refresh, exchange, access-request, password-reset, and unlock-request bodies use the frontend's established form fields. Login returns `{access_token, refresh_token, expires_in, user}`. Access-request approval requires a pending row and an already-created Auth profile with a matching email; the provider invitation is issued by the backend. Reset, invitation, and unlock-verification links use server-configured `SUPABASE_AUTH_REDIRECT_URL` (the local example is `/auth/callback`); the chosen URL must also be allowlisted in Supabase Auth. Configure the production URL in Phase 24. Three consecutive failed sign-ins lock an active account; only an active Admin can decide the account owner's provider-verified pending unlock request. The project owner confirmed identity migration 013 is applied in the live database; this is owner-reported, not independently queried.

Protected role policy grants transaction reads and alert review to active Auditor/Supervisor/Admin users, report operations and `POST /transactions` to Supervisor/Admin, and user administration to Admin. `GET /alerts` is team-scoped: Auditors see only their current assignments, Supervisors see their active team's alerts plus unclaimed alerts, and Admins see all alerts. A Supervisor may assign only to an active Auditor or Supervisor from that same team; Admin may assign across teams. All authorization is enforced by the backend; frontend visibility alone does not grant access.

### `GET /api/v1/dashboard/summary`

Implemented in Phase 20; the owner reported Migration 019 applied, without independent live-schema inspection. Returns database-wide transaction counts and latest persisted risk summary. `transactions_evaluated` counts transactions with a persisted risk classification; rule-evaluation coverage is reported separately by `/analytics`. Active alerts are filtered to the caller's authorized team/assignment scope (Admin sees all). Requires an active Auditor, Supervisor, or Admin. This endpoint is not a time-period query.

```json
{"total_transactions":0,"transactions_evaluated":0,"high_risk_transactions":0,"medium_risk_transactions":0,"low_risk_transactions":0,"average_risk_score":0,"active_alerts":0,"generated_at":"2026-10-03T00:00:00Z"}
```

### `GET /api/v1/analytics?period=7_DAYS|30_DAYS|90_DAYS`

Implemented in Phase 20; the owner reported Migration 019 applied, without independent live-schema inspection. Requires an active Auditor, Supervisor, or Admin. Coverage uses every transaction and its latest evaluation snapshot; a transaction is evaluated when at least one of five rules is `PASSED` or `FAILED`. Full evaluation requires all five rules to have executed. Exclusions identify missing required fields, unavailable rule context, or missing evaluation snapshots. Risk and alert trends use UTC calendar-day buckets for the selected period; case outcomes and alert trends follow the caller's case/alert scope. Rule violation trends count failed results from latest snapshots evaluated within the period.

### `GET /api/v1/transactions`

Returns a database-backed paginated transaction collection from Supabase. The default page size is 25 and the maximum page size is 100.

Implemented query parameters are `page`, `page_size`, `search`, and `sort_by`. `search` matches transaction ID, vendor name, or category across the full Supabase collection. `sort_by` accepts `newest`, `oldest`, `highest-amount`, or `lowest-amount`. Risk-score sorting and rule-status filtering are not currently implemented.

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 25
}
```

Each item has the `Transaction` shape.

The query excludes the private `ground_truth` evaluation labels.

### `GET /api/v1/transactions/{transaction_id}`

Returns one Supabase-backed `Transaction`, including its current `rule_results`, latest persisted `ai_score`, latest persisted `risk_score` and `risk_level`, and optional `explanation`. Returns `404` when the transaction does not exist or is not accessible to the caller. The response never includes `ground_truth`.

### `POST /api/v1/transactions`

Accepts one standardized transaction for schema validation and data-quality assessment. The transaction `id` is required. The remaining fields are optional so incomplete source transactions can be accepted and reported instead of silently rejected.
Requires an active Supervisor or Admin bearer session. Auditor and unauthenticated callers are rejected by the backend. A duplicate transaction ID returns `409 Conflict`; this endpoint never overwrites an existing transaction.

Request example:

```json
{
  "id": "TX-TEST-001",
  "timestamp": "2026-09-28T08:00:00Z",
  "vendor_id": "VEN-001",
  "vendor_name": "Riyadh Wholesale Trading",
  "invoice_number": "INV-1001",
  "category": "Inventory",
  "amount": 18750,
  "currency": "SAR",
  "created_by": "EMP-101",
  "approved_by": "MGR-201",
  "approver_role": "Store Manager",
  "approval_limit": 20000
}
```

Response `201 Created`:

```json
{
  "id": "TX-TEST-001",
  "timestamp": "2026-09-28T08:00:00Z",
  "vendor_id": "VEN-001",
  "vendor_name": "Riyadh Wholesale Trading",
  "vendor_monitoring_status": null,
  "invoice_number": "INV-1001",
  "category": "Inventory",
  "amount": 18750,
  "currency": "SAR",
  "created_by": "EMP-101",
  "approved_by": "MGR-201",
  "approver_role": "Store Manager",
  "approval_limit": 20000,
  "data_quality_status": "COMPLETE",
  "missing_fields": [],
  "rule_status": "NOT_EVALUATED",
  "rule_score": null,
  "ai_score": null,
  "risk_score": null,
  "risk_level": null,
  "rule_results": [],
  "explanation": null
}
```

A transaction with missing optional fields returns `data_quality_status` as `PARTIAL` and lists the unavailable fields in `missing_fields`. Unknown fields or invalid values return `422 Unprocessable Entity`.

Duplicate transaction IDs return `409 Conflict` with `detail: "Transaction ID already exists."`. The existing primary key arbitrates concurrent inserts; losing requests do not start evaluation/scoring/alert processing. Runtime insert never uses `on_conflict` or a read-before-write existence check. Storage/configuration errors retain `502`/`503`; unknown fields or invalid values retain `422`.

The transaction is validated, assessed for missing fields, persisted to Supabase PostgreSQL, evaluated by the eligible audit rules, assigned an authoritative rule score, and stored with a versioned evaluation snapshot. Isolation Forest anomaly scoring is performed and persisted immediately. Combined risk scoring is performed and persisted immediately. Qualifying `HIGH` transactions generate a durable active alert and a WebSocket event. Live verification measured 3,556.213 ms from request receipt to persisted alert creation and 4,660.189 ms from request start to WebSocket receipt, satisfying the five-second target. Gemini 3.8 Flash generates and persists a sanitized advisory explanation after authoritative scoring. If explanation generation is unavailable or incomplete, the transaction and audit results remain stored and `explanation` is `null`.

### Durable processing (Phase 13B, opt-in)

`TRANSACTION_RECOVERY_ENABLED=true` requires approved migration 012. Source and recovery-job creation are atomic; evaluation, anomaly score, combined score, HIGH alert, result, and pending event state commit atomically in a second RPC. PostgreSQL leases fence stale workers; startup polling retries incomplete work. Duplicate POST still returns 409. Processing failure returns 503; an accepted source/job remains durably retryable, and GET exposes optional `processing_status` (`PENDING`, `PROCESSING`, `COMPLETED`). Pending/processing reads return NOT_EVALUATED and null scores rather than runtime fallback findings. A failure before source/job commit may mean nothing was accepted; clients check GET before deciding what to do.

WebSocket publication follows commit and can retry after an acknowledgement failure; publication attempts may duplicate. It does not guarantee offline-client delivery or broadcast between processes. Gemini is optional after authoritative completion. With the flag false, Phase 13A protection is active but legacy separate persistence retains its partial-failure limitation. See [the recovery design](TRANSACTION_RECOVERY_DESIGN.md) for activation and delivery boundaries.

## Offline seed utility

Excel is not a runtime API or website data source. Runtime transaction reads come from Supabase through the REST endpoints documented above.

The reproducible offline seed tool is run from the `backend` directory only when the database must be initialized or rebuilt:

```powershell
python -m scripts.seed_transactions --confirm
```

The command requires the development dependencies from `requirements-dev.txt` and refuses to modify Supabase unless `--confirm` is supplied. Upserts are idempotent by transaction ID.

The seed utility supports the standardized transaction schema and the SME retail workbook stored under `backend/data/samples`. The SME adapter maps source fields into the standardized schema, assigns `SAR` as the currency, and retains branch, employee-role, and payment-method values as source metadata.

`violation_type` and `is_anomaly` are stored separately as private `ground_truth` evaluation labels. They are excluded from public API queries and must never be used as Isolation Forest input features.

The current SME retail dataset does not provide `approval_limit`, so its seeded transactions remain `PARTIAL`. The seed tool does not invent missing approval limits.

### `GET /api/v1/alerts`

Returns a paginated collection of `Alert` objects. The optional `status` query parameter accepts `ACTIVE` or `REVIEWED`. Each alert includes `assignment: null` if never assigned, or a summary with team, assignee, actor, timestamp, and `ASSIGNED`/`UNASSIGNED` state.

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 25
}
```

### `PATCH /api/v1/alerts/{alert_id}/review`

Requires an active Auditor, Supervisor, or Admin bearer session. `REVIEWED` marks the alert complete; `ACTIVE` reopens a completed review. Both return the updated `Alert`. Repeating the current transition returns `409 Conflict` and does not append a duplicate event. The optional note is limited to 2,000 characters.

Request:

```json
{
  "status": "REVIEWED"
}
```

Full actor-attributed alert and transaction review history, notes, and immutable audit events are implemented by backend-plan Phase 15. The project owner confirmed migration 014 is applied in Supabase; isolated tests do not independently verify the live schema.

### `POST /api/v1/reviews/{resource_type}/{resource_id}` and `GET /api/v1/reviews/{resource_type}/{resource_id}`

`resource_type` is `TRANSACTION` or `ALERT`. Active Auditors, Supervisors, and Admins may review. Alert review and alert review history follow the same Auditor/Supervisor/Admin team visibility scope as `GET /alerts`; transaction review access follows the authenticated role policy. POST accepts `{"action":"REVIEWED"}`, `{"action":"REOPENED"}`, or `{"action":"NOTE_ADDED","note":"..."}`. Reviews can be reopened; each action appends a review record with actor ID, actor name/role snapshot, note, and timestamp. Repeated or invalid state transitions return `409 Conflict`. Notes cannot be empty and are limited to 2,000 characters. GET returns filtered-by-resource history in newest-first pages of 25, up to 100 per page.

### `GET /api/v1/audit-events`

Supervisor and Admin access only. Supports `page`, `page_size`, `search`, `actor`, `action`, `resource_type`, `outcome`, `date` (UTC calendar day), and `sort` (`NEWEST` or `OLDEST`). Admins see all retained activity; Supervisors see their own events and events attributed to their active team. Review transitions/notes and identity events captured from `login_history` are append-only; application roles cannot update or delete accountability records. `GET /api/v1/users/{id}/login-history` remains scoped to the user or Admin.

### Team and alert-assignment endpoints

- `GET /api/v1/teams`: Admin sees all teams; Supervisor sees the Supervisor's active team.
- `GET /api/v1/teams/activity?team_id=...`: authorized team overview, workload, and recent activity. A Supervisor cannot query another team.
- `POST /api/v1/teams` and `PATCH /api/v1/teams/{team_id}`: Admin creates or updates a team.
- `DELETE /api/v1/teams/{team_id}`: Admin deactivates an empty team; active memberships or assignment history prevent deactivation.
- `POST /api/v1/teams/{team_id}/members`: Supervisor adds/removes active Auditors from the Supervisor's own team; only Admin may transfer Auditors between teams. An Auditor with assigned alerts must first have them reassigned or unassigned.
- `GET /api/v1/teams/{team_id}/member-candidates`: lists active Auditor candidates visible to Admin or the owning Supervisor; the response includes the current team so Admin can make an authorized transfer.
- `GET /api/v1/alerts/{alert_id}/assignment`: returns current assignment, immutable history, and eligible assignees to users who can access the alert. Auditor results contain no eligible-assignee list.
- `POST /api/v1/alerts/{alert_id}/assignment`: Supervisor/Admin performs `ASSIGNED`, `REASSIGNED`, or `UNASSIGNED`; each accepted change is serialized per alert and records history and an audit event.

Assignment request example:

```json
{"action":"ASSIGNED","assignee_id":"00000000-0000-4000-8000-000000000001","note":"Initial review"}
```

Cross-team or role denial returns `403`, invalid state transitions return `409`, and invalid payloads return `422`. Team and assignment runtime behavior depends on migration 015; the migration is tested only in isolated local PostgreSQL and is not applied to the live database by this change.

### `GET /api/v1/audit-rules`

Implemented in Phase 20; the owner reported Migration 019 applied, without independent live-schema inspection. Requires an active Auditor, Supervisor, or Admin. Returns read-only definitions derived from the five versioned backend rule definitions and their field/context requirements.

```json
{
  "items": []
}
```

### `GET /api/v1/reports`

Returns paginated persisted `Report` records with `items`, `total`, `page`, and `page_size`. Completed reports include a CSV `download_url`.

```json
{
  "items": []
}
```

### `GET /api/v1/reports/{report_id}/download`

Returns a completed report as `text/csv` with an attachment filename. Returns `404` when the report does not exist and `409` when it is not completed.

### `POST /api/v1/reports`

Generates and persists a completed daily report from authoritative stored results. Repeating the same UTC period returns the existing canonical report without replacing its summary or history.

Request:

```json
{
  "type": "DAILY",
  "period_start": "2026-09-20T00:00:00Z",
  "period_end": "2026-09-21T00:00:00Z"
}
```

### `GET /api/v1/reports/schedule` (Admin)

Returns whether the backend scheduler is enabled, the next UTC period to process, and up to 50 recent attempt records. The worker runs in the FastAPI lifespan when `DAILY_REPORT_SCHEDULER_ENABLED=true`; it targets the previous full UTC day, catches up missed periods sequentially, and retries failures with bounded backoff. It is disabled by default and must be enabled in the approved backend runtime during Phase 24.

## WebSocket contract

### `/ws/alerts`

Implemented authenticated server-to-client change signal. Each newly created high-risk alert emits an `alerts.changed` invalidation event; the event contains no alert row or identifier. Clients reconcile through the paginated, actor-scoped `GET /api/v1/alerts` endpoint on connection readiness, reconnect, and change signals. This keeps WebSocket delivery from bypassing team and assignment visibility rules. Reconciliation deduplicates by persisted alert ID and replaces the client snapshot so alerts removed from the actor's current scope are dropped.

Event envelope:

```json
{
  "type": "alerts.changed",
  "occurred_at": "2026-10-03T14:42:03Z"
}
```

The client implements bounded reconnection attempts, sends its bearer token in the first WebSocket application frame, and subscribes only after `auth.ready`. The backend validates the session at connection and during delivery. The client loads the complete actor-scoped alert snapshot through paginated `GET /api/v1/alerts` on mount, reconnect, and change signals. The stream manager remains process-local; Phase 24 must choose an approved deployment topology that accounts for this.

The Phase 17 notification API contract is `GET /api/v1/notifications?page=1&page_size=25&unread_only=false`, `PATCH /api/v1/notifications/{notification_id}/read`, and `POST /api/v1/notifications/read-all`. Every operation derives the recipient from the authenticated user and cannot access another user's records. Event notifications are persisted idempotently with their source alert, assignment, access request, or account event. Approved access requests may notify the activated request owner; rejected requests remain in Admin request/audit records and do not send an in-app notification until a safe delivery channel is selected. Migration 016 must be applied before these routes can use live storage.

## Responsibility boundary

### Frontend

- React UI and navigation
- Dashboard, transaction, alert, and report views
- Search, filter, and sort controls
- Loading, error, and empty states
- REST API client and WebSocket client
- Displaying backend results

### Backend

- Transaction ingestion and validation
- Missing-field handling
- PostgreSQL persistence
- Five audit rules and rule score
- Isolation Forest and AI anomaly score
- Authoritative 60/40 risk calculation and risk classification
- Alert creation and WebSocket publication
- Gemini explanation calls
- Report generation
- Authentication and authorization enforcement

The frontend must never become the authoritative source for audit decisions.

## Case routes (Phase 18)

- `GET /api/v1/cases?page=1&page_size=25&status=&priority=&search=` and `GET /api/v1/cases/{case_id}` return only cases in the authenticated actor's scope (Auditor: assigned cases; Supervisor: own team; Admin: global).
- `POST /api/v1/cases` creates from an explicit `ALERT` or `TRANSACTION` source; payload fields are `source_type`, `source_id`, `title`, `description`, `priority`, optional `department`, and optional `assigned_to_id`.
- `POST /api/v1/cases/{case_id}/status`, `/assignment`, and `/comments` persist validated transitions, assignment history, and immutable comments.
- An assigned Auditor submits `POST /api/v1/cases/{case_id}/closure-request`; an active same-team Supervisor or global Admin decides with `POST /api/v1/cases/{case_id}/closure-decision`. The requester cannot decide their own request. Rejection reopens investigation and resets the SLA deadline.
- Evidence uses raw PDF/PNG/JPEG request bytes at `POST /api/v1/cases/{case_id}/evidence?category=...`, with `X-File-Name`; maximum size is 10 MiB. The API fails closed unless a private bucket and antivirus executable are configured. Downloads are authorized and streamed through the API; storage keys never leave the server.
- SLA targets are LOW 72h, MEDIUM 48h, HIGH 24h, CRITICAL 8h. When enabled, the API server worker runs the idempotent `escalate_overdue_cases` RPC every minute; overdue cases become ESCALATED and notify the assignee, team Supervisor, and active Admins. `CASE_SLA_ESCALATION_ENABLED` must be enabled in the deployed runtime and verified in Phase 24.

## Vendor monitoring routes (Phase 19, merged)

These routes are implemented on `main`; the owner reported Migration 018 applied, but this was not independently queried:

- `GET /api/v1/vendors?page=1&page_size=25&status=NORMAL|WATCHLISTED|BLOCKED` returns the approved-vendor registry with risk and actor-scoped alert/case summaries; `GET /api/v1/vendors/{vendor_id}` returns the vendor profile, related records, requests, and monitoring history. Request details are visible to the requester, their active team Supervisor, and Admin; Auditor alert and case details retain their existing assignment scopes.
- An Auditor submits `POST /api/v1/vendors/{vendor_id}/watchlist-requests`; only the active Supervisor of the requester's team may decide `POST /api/v1/vendors/requests/{request_id}/decision`.
- A Supervisor submits `POST /api/v1/vendors/{vendor_id}/block-requests`; only an active Admin may decide. Supervisors may remove a watchlist entry within their team scope; only Admin may unblock a vendor.
- Each request, decision, removal, and unblock retains actor, role, reason, status transition, and timestamp. Approved requests notify the requester; new watchlist requests notify the owning Supervisor and block requests notify active Admins.
- `BLOCKED` means audit-monitoring status only. It does not prevent or reject an ERP payment. `approved_vendors.is_active` remains the independent approved-vendor registry state used by Ghost Vendor evaluation.
## Settings (Phase 21, merged)

- `GET /api/v1/settings` — any active Auditor, Supervisor, or Admin; returns the authoritative `organization_name` and `updated_at`.
- `PATCH /api/v1/settings/organization` — active Admin only; body is `{ "organization_name": "..." }`. The trimmed name must be 2–120 characters. The server records `ORGANIZATION_SETTINGS_UPDATED` in the append-only audit log atomically with the setting change; a no-op update creates no audit event.
- Currency, risk thresholds, audit rules, report frequency, alert thresholds, and integration status remain read-only reference values. This phase does not make them configurable.

\r\n
