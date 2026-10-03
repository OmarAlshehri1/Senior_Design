# Shared API Contract

This document is the preliminary contract between the React frontend and FastAPI backend. It defines planned field names and payload shapes so frontend and backend development can proceed independently.

`GET /api/v1/health`, `GET /api/v1/transactions`, `GET /api/v1/transactions/{transaction_id}`, and `POST /api/v1/transactions` are implemented. The remaining endpoints in this document are contracts only and are not implemented yet. Shapes may be extended through team agreement, but existing names should not be changed without coordinating both branches.

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

Automated evaluation coverage is calculated as transactions whose latest snapshot contains at least one `PASSED` or `FAILED` rule divided by all stored transactions, multiplied by 100. Rules marked `NOT_EVALUATED` do not count as executed. The controlled 10,002-transaction database currently achieves 100% coverage after the idempotent evaluation backfill; no transactions remain unevaluated.

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
  "reviewed_at": null
}
```

Alert `status` is `ACTIVE` or `REVIEWED`.

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

```json
{
  "summary": "This transaction was classified as high risk.",
  "factors": [
    "A rule violation was detected.",
    "The transaction pattern was anomalous."
  ],
  "source": "GEMINI",
  "generated_at": "2026-09-20T14:42:05Z"
}
```

`source` identifies how explanatory text was produced; it does not affect the authoritative score. An explanation may be `null` when unavailable or pending.

### Report

```json
{
  "id": "RPT-2026-09-20",
  "type": "DAILY",
  "status": "COMPLETED",
  "period_start": "2026-09-20T00:00:00Z",
  "period_end": "2026-09-20T23:59:59Z",
  "created_at": "2026-09-21T00:05:00Z",
  "download_url": "/api/v1/reports/RPT-2026-09-20/download"
}
```

Report `status` is `PENDING`, `COMPLETED`, or `FAILED`.

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

### `GET /api/v1/dashboard/summary`

Returns `DashboardSummary` for the current organization and reporting period.

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

The transaction is validated, assessed for missing fields, persisted to Supabase PostgreSQL, evaluated by the eligible audit rules, assigned an authoritative rule score, and stored with a versioned evaluation snapshot. Isolation Forest anomaly scoring is performed and persisted immediately. Combined risk scoring is performed and persisted immediately. Alert generation and explanations will be added in later stages.

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

Returns a paginated collection of `Alert` objects.

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 25
}
```

### `PATCH /api/v1/alerts/{alert_id}/review`

Marks an alert as reviewed and returns the updated `Alert`.

Preliminary request:

```json
{
  "status": "REVIEWED"
}
```

### `GET /api/v1/audit-rules`

Returns the available `AuditRule` definitions.

```json
{
  "items": []
}
```

### `GET /api/v1/reports`

Returns a collection of `Report` records.

```json
{
  "items": []
}
```

### `POST /api/v1/reports`

Requests report generation and returns a `Report` with its current processing status.

Preliminary request:

```json
{
  "type": "DAILY",
  "period_start": "2026-09-20T00:00:00Z",
  "period_end": "2026-09-20T23:59:59Z"
}
```

## WebSocket contract

### `/ws/alerts`

Planned server-to-client alert stream. It is not implemented yet.

Preliminary event envelope:

```json
{
  "type": "alert.created",
  "occurred_at": "2026-09-20T14:42:03Z",
  "data": {
    "id": "AL-0001",
    "transaction_id": "TX-10496",
    "created_at": "2026-09-20T14:42:03Z",
    "severity": "HIGH",
    "title": "High-risk transaction detected",
    "description": "The transaction requires auditor review.",
    "reason": "Rule and anomaly results exceeded the high-risk threshold.",
    "status": "ACTIVE",
    "reviewed_at": null
  }
}
```

Authentication, reconnect behavior, delivery guarantees, ordering, and missed-event reconciliation remain to be defined before implementation.

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
