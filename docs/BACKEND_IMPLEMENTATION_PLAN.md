# Backend Implementation Plan — Team M004

Last updated: 2026-10-01  
Owner scope: CS — C1, C3, and the CS portions of IS1 and IS3

## How to use this file

- `[x]` completed and verified.
- `[ ]` not completed yet.
- The item labeled **CURRENT** is the task being implemented now.
- Do not mark an item complete until its tests pass.
- Add the commit and pull-request number after each merged phase.
- Before starting new work: switch to `main`, pull with `--ff-only`, verify a clean status, then create a feature branch.

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
- [ ] **CURRENT:** Commit and merge versioned Gemini explanations.

## Phase 12 — Frontend integration and deployment coordination

- [ ] Coordinate activation of the API data source with the frontend owner.
- [ ] Configure `VITE_API_BASE_URL` for local and deployed environments.
- [ ] Configure backend CORS for the approved Vercel origin.
- [ ] Fix frontend mapping of `missing_fields` into `dataQuality.missingFields`.
- [ ] Derive or display date/time consistently from `timestamp`.
- [ ] Map any required AI status and explanation fields.
- [ ] Keep mock preview data available only as an explicit demo fallback.
- [ ] Deploy FastAPI to the selected backend host.
- [ ] Store secrets only in backend host environment variables.
- [ ] Run an end-to-end test: frontend -> FastAPI -> Supabase -> frontend.

## Specification verification checklist

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

These are implementation estimates, not final evaluation grades.

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

## Next action

Commit and merge versioned Gemini explanations, then continue frontend integration and deployment coordination.