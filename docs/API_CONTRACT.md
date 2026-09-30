# Shared API Contract

This document is the preliminary contract between the React frontend and FastAPI backend. It defines planned field names and payload shapes so frontend and backend development can proceed independently.

`GET /api/v1/health`, `POST /api/v1/transactions`, and `POST /api/v1/transactions/import` are implemented. The remaining endpoints in this document are contracts only and are not implemented yet. Shapes may be extended through team agreement, but existing names should not be changed without coordinating both branches.

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

This calculation is not implemented yet. Rounding, incomplete-data behavior, and score-version metadata must be confirmed before implementation.

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
  "status": "FAILED",
  "score_contribution": 35,
  "detail": "Possible duplicate payment detected.",
  "evidence": {}
}
```

`status` is one of `PASSED`, `FAILED`, or `NOT_EVALUATED`. The final contents of `evidence` will be rule-specific and must avoid unnecessary sensitive data.

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

Returns a paginated transaction collection.

Planned query parameters include `search`, `risk_level`, `rule_status`, `sort`, `page`, and `page_size`.

```json
{
  "items": [],
  "total": 0,
  "page": 1,
  "page_size": 25
}
```

Each item has the `Transaction` shape.

### `GET /api/v1/transactions/{transaction_id}`

Returns one `Transaction`, including its `rule_results` and optional `explanation`. Returns `404` when the transaction does not exist or is not accessible to the caller.

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
  "transaction": {
    "id": "TX-TEST-001",
    "timestamp": "2026-09-28T08:00:00Z",
    "vendor_id": "VEN-001",
    "vendor_name": "Riyadh Wholesale Trading",
    "invoice_number": "INV-1001",
    "category": "Inventory",
    "amount": "18750",
    "currency": "SAR",
    "created_by": "EMP-101",
    "approved_by": "MGR-201",
    "approver_role": "Store Manager",
    "approval_limit": "20000"
  },
  "data_quality_status": "COMPLETE",
  "missing_fields": []
  "persisted_rows": 1
}
```

A transaction with missing optional fields returns `data_quality_status` as `PARTIAL` and lists the unavailable fields in `missing_fields`. Unknown fields or invalid values return `422 Unprocessable Entity`.

The transaction is validated, assessed for missing fields, and persisted to Supabase PostgreSQL. Rule evaluation, anomaly scoring, and alert generation will be added in later stages.

### `POST /api/v1/transactions/import`

Accepts an Excel `.xlsx` file as `multipart/form-data` and imports transaction rows in batches. The maximum upload size is 20 MB and the maximum supported worksheet size is 50,000 transaction rows.

Supported input schemas:

- The standardized transaction schema documented above.
- The SME retail expenses schema used by `SME_Retail_Expenses_Purchases_10k_Dataset.xlsx`.

The SME retail adapter applies the following mappings:

| Source column | Standard field |
| --- | --- |
| `transaction_id` | `id` |
| `expense_category` | `category` |
| `amount_sar` | `amount` |
| `approved_by_role` | `approver_role` |

The adapter also assigns `SAR` as the currency. Source metadata such as branch, employee role, and payment method is retained separately. `violation_type` and `is_anomaly` are retained as ground-truth evaluation labels and are not used as model input features.

Response `200 OK` summary example:

```json
{
  "source_schema": "SME_RETAIL_EXPENSES",
  "total_rows": 10000,
  "accepted_rows": 10000,
  "complete_rows": 0,
  "partial_rows": 10000,
  "rejected_rows": 0,
  "persisted_rows": 10000,
  "processing_time_seconds": 1.7353,
  "returned_rows": 10,
  "has_more": true,
  "transactions": [
    {
      "id": "EXP-2026-006253",
      "data_quality_status": "PARTIAL"
    }
  ],
  "errors": []
}
```
All rows are validated, but the response includes at most 10 preview transactions to prevent oversized HTTP responses. `has_more` indicates that additional accepted rows exist. Full dataset retrieval will use database-backed pagination in a later stage.

The current SME retail dataset does not provide `approval_limit`, so its imported transactions are marked `PARTIAL`. The service does not invent missing approval limits.

Error responses:

- `400 Bad Request`: unsupported file extension.
- `413 Content Too Large`: file exceeds 20 MB.
- `422 Unprocessable Content`: invalid workbook or unsupported column structure.
- `502 Bad Gateway`: Supabase rejected or could not complete the storage request.
- `503 Service Unavailable`: Supabase environment variables are not configured.

The importer validates all accepted rows and persists them to Supabase PostgreSQL using server-side credentials. Records are upserted by transaction ID in batches of 500. Database-backed pagination, rule evaluation, and anomaly scoring will be added later.

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
