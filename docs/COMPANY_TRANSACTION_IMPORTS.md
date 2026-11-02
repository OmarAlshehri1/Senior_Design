# Company transaction imports

Implementation sequence: inspect existing pipeline; define contract/access; file
parsing; mapping/validation preview; atomic confirmed ingestion; authenticated
JSON input; isolated tests and timing evidence.

Initial contract: Admin sessions only, with a direct explicit source assignment.
Organization is taken from the registered source, never from the uploaded file.
Sources, verified policies/registry and optional source-compatible model approval
are provisioned by an operator using the existing feed setup. Reading another
source does not allow importing it. This adds no public company registration.

Support UTF-8 comma-separated CSV and modern XLSX, one sheet and at most 50,000
data rows/64 columns/25 MiB per upload. Preserve numeric text, dates and leading-zero
identifiers; reject formulas, ambiguous headers, unsupported types and expanded
workbooks over 128 MiB. Expanded row JSON is bounded at 64 MiB; each transaction
must fit the existing 256 KiB receipt envelope. Other formats are explicitly
unsupported. These are per-upload limits, not a cap on total stored transactions;
larger populations can arrive in multiple files or through the JSON feed.

Upload -> choose mapping and stable source transaction ID column -> preview all
rows -> confirm exact preview -> atomic receipts/jobs -> existing validation/audit
workers -> source-scoped Feed Review, exceptions and report exports. Missing
business/reference information stays unavailable, not fabricated. Existing
Payments dashboard/saved reports remain their existing population. Feed results
are deliberately separate and are not automatically merged into Payments.

Confirmation requires a current mapping revision. No records are queued while
any row is invalid. Same source ID and identical original record/mapping reuses
the original receipt; changed content or mapping conflicts and rolls back the
whole confirmation. Identical values under different stable IDs remain distinct
transactions for the duplicate-payment rule, not transport deduplication.

Confirmation uses bulk inserts for receipts and validation jobs rather than a
per-row SQL loop or repeatedly growing a JSON array. It preserves the source
lock, conflict rejection, all-or-nothing commit and replay guarantees. File RPCs
use a bounded 60-second transport timeout; other identity operations keep their
existing timeout. Worker auditing remains asynchronous after durable confirmation.

Mappings can be saved per source and reused; each confirmed receipt pins its
mapping. JSON producers use the existing source-authenticated ingestion endpoint,
stable event/record IDs and the source's registered mapping. Browser sessions and
producer credentials are separate. Neither browser requests nor source payloads
can set scores, control results, company identity or reference-policy truth.

The feature defaults off via COMPANY_IMPORTS_ENABLED and requires enabled intake,
validation, auditing and Feed Review. No migrations or feature flags are applied
at startup. Develop/test in isolated local storage first. Pending/blocked jobs,
null AI/risk and partial coverage are visible outcomes, not completed scoring.

## Implemented endpoints

All `/api/v1/company-imports` operations use an application session; writes require
an active Admin with a direct source assignment. Capabilities are readable by any
authenticated role but return enabled=false for non-Admins.

| Method / path | Behavior |
| --- | --- |
| GET `/capabilities` | Availability and file limits; no source data. |
| GET `/sources` | Explicitly assigned active, audit-enabled sources. |
| GET `/history?source_id=...` | Saved source mappings and the actor's latest 20 uploads. |
| POST `/uploads?source_id=...&filename=...&sheet=...` | Raw file bytes; saves an unconfirmed draft, returns columns/sheets and five sample rows. |
| POST `/{id}/preview` | Validates every row using explicit mapping, checks existing references, returns counts, ten examples and up to 100 invalid-row locations. |
| POST `/{id}/confirm` | Confirms the exact revision atomically; creates receipts/jobs, saves optional mapping and attributes an audit event. Conflicts roll back all new rows. |
| GET `/{id}/progress?source_id=...` | Durable completed/pending/blocked/rejected counts, including after a page reload through history. |

The source-producer JSON path already exists at `POST /api/v1/ingestion/events`.
It uses a dedicated revocable source credential, not a browser Admin credential:

```json
{
  "schema_version": "1.0",
  "source_id": "registered-company-source",
  "event_id": "stable-delivery-001",
  "record_id": "company-transaction-001",
  "event_type": "transaction.created",
  "original_record": { "Payment_Value": "125.50", "Currency_Code": "USD" }
}
```

The operator pins a source mapping for `Payment_Value` and `Currency_Code` before
delivery; this example deliberately supplies no invented actor/policy/registry.
Send `Content-Type: application/json` and `Authorization: Bearer <SOURCE_CREDENTIAL>`.
202 means durably received, not audited. Poll `/ingestion/receipts/{receipt_id}`;
an identical replay returns 200, changed content under a reused ID returns 409.
Field meanings, supported currency, identity namespaces, reference provenance
and any model approval must be configured for each source. The existing retail
model is not automatically approved for new company files.

Stable reference values must fit the existing source contract: 1-128 characters,
starting with a letter/digit and containing letters/digits or `_ . : / -`.
Leading-zero text references are preserved. Native Excel date-only cells become
explicit date-only strings; exact instants require a timezone in the source.
Formula cells, macros and external workbook links are rejected. This is a
declared source-adapter contract, not support for every possible workbook layout.

## Local verification

The local API fixture substitutes a synthetic Admin and uses in-memory PGlite.
It cannot contact a hosted database. The dedicated frontend check page is a Vite
development-only entry, not part of the production build.

1. From the repository root: `backend/.venv/Scripts/python.exe backend/test-support/company_imports_local.py --port 54351`.
2. Start Vite in `frontend` on `127.0.0.1:5189`, with
   `VITE_API_BASE_URL=http://127.0.0.1:54351/api/v1` and
   `VITE_WS_URL=ws://127.0.0.1:54351/ws/alerts`.
3. Open `/company-import-check.html`, or from `backend` run
   `.venv/Scripts/python.exe -m scripts.check_company_import_ui --url http://127.0.0.1:5189/company-import-check.html --evidence ../docs/evidence/company_import_browser_new.json`.
   Use a new evidence path each time; the script refuses to overwrite evidence.

The browser script creates only synthetic CSV/XLSX fixtures. It verifies CSV
mapping/completion, saved mapping reuse, identical file replay, invalid-row
blocking, Excel worksheet selection, mobile layout and runtime errors. The API
pipeline test additionally exercises real JSON intake, all five rule outcomes,
the pinned retail artifact under explicitly fictional conformance-test approval,
saved HIGH-risk alert creation and truthful null scores for an unapproved source.
Local timings do not certify S4 on Render or notification delivery under IS2.

## Activation checklist (not executed)

- Confirm required existing feed migrations 026-039 are installed in the selected
  isolated environment; do not replay old migrations unnecessarily.
- Review/apply `20261101181927_company_transaction_imports.sql` once. Verify new
  tables are private and RPC execution is service-only. No dataset import/reset
  or source registration is performed by the migration.
- Configure a source and immutable mapping/context using existing onboarding.
  Assign the intended Admin directly in `feed_review_users`; no global role
  grants implicit company import access. Review team/user grants separately for
  Feed Review and reports. Credentials remain server/producer-side.
- Set `COMPANY_IMPORTS_ENABLED`, `INGESTION_ENABLED`,
  `INGESTION_VALIDATION_ENABLED`, `INGESTION_AUDIT_ENABLED`, and
  `FEED_REVIEW_ENABLED` to true in the isolated host, then restart/deploy so
  lifespan workers start. Anomaly scoring requires its separate opt-in flag and
  source/model approval; leave it off when those are unavailable.
- Verify actual Admin sign-in and denied Supervisor/Auditor/unassigned-source
  imports, file/JSON intake, retries, completed/blocked outcomes, scoped
  result/report reads, and hosted receipt/posting-to-alert timing.
- Agree source-data retention and schedule cleanup of expired unconfirmed draft
  records before onboarding real data. Expiration is an access boundary; it does
  not itself physically delete a row. Confirmed receipts retain the existing
  evidence policy. Back out by disabling COMPANY_IMPORTS_ENABLED; already
  confirmed jobs remain durable and existing Payments records are unchanged.

Current state: implemented and verified locally; no hosted migration, flag change,
source registration, production file import or application deployment performed.

## Acceptance result - 2026-11-01

The initial acceptance below used 1,000-row/5 MiB limits. Those size limits are
superseded by the larger-file acceptance update following this section.

All seven implementation steps are complete for the local scope. Review/access
contract, CSV/XLSX parsing, explicit mapping with saved profiles, all-row preview,
existing-reference checks, atomic confirmation/jobs, JSON input reuse and isolated
verification are implemented. Processing can be reopened from history after reload.

Validation passed: 142 backend tests; 325 frontend tests; two isolated PostgreSQL
test groups; frontend lint and production build. Browser acceptance passed CSV,
XLSX sheet selection, saved mapping reuse, replay, pre-confirmation conflict/invalid
row blocking, durable progress restoration, mobile overflow and runtime checks.
The build reports a main-bundle size warning; it succeeds.

The real local pipeline produced five evaluated rules, a HIGH-risk result and one
persisted alert. One observed receipt-to-alert interval was 193 ms. This is a
single synthetic local observation, not evidence that the current Render system
meets S4 under representative load. A source without approval/reference context
completed with explicit null risk and unavailable rule outcomes.

[Aggregate acceptance evidence](evidence/company_import_local_acceptance_2026-11-01.json)
and [browser evidence](evidence/company_import_browser_acceptance_2026-11-01.json).

## Larger-file acceptance update - 2026-11-01

The supported upload limits are now 50,000 rows and 25 MiB. The UI displays and
enforces the backend capability values rather than maintaining a second hardcoded
limit. XLSX numeric extraction streams only the selected worksheet instead of
building complete XML trees and numeric maps for every sheet.

Verification:

- Full 50,000-row CSV parsing and validation preview passed, using a file over the
  former 5 MiB limit. Full 50,000-row XLSX parsing preserved exact numeric text.
- Oversized files, 50,001 rows and rows too large for the ingestion envelope are
  rejected before queuing.
- Real local HTTP upload -> preview -> confirmation -> progress passed with
  50,000 synthetic rows; all 50,000 remained durably queued as expected.
- The isolated SQL test inserted 50,000 receipts/jobs, preserved replay safety,
  and retained the conflict rollback and scope/permission checks. One local bulk
  confirmation observation took 6.346 seconds. This measures queue acceptance,
  not completed auditing or hosted throughput.
- 167 backend regression tests, frontend lint and production build passed. The
  browser verified the advertised limits and the existing small-file workflow.

[Larger-file evidence](evidence/company_import_large_file_acceptance_2026-11-01.json)
and [updated browser evidence](evidence/company_import_large_limits_browser_2026-11-01.json).
The migration has not been applied to a hosted database; modifying this still-local
migration does not rewrite any previously applied production migration. Hosted
request limits/timing and real sign-in remain staging acceptance work.

Uploaded row evidence is private. Unconfirmed drafts expire after 24 hours;
operator cleanup deletes expired draft rows. Confirmed raw receipts follow the
existing source retention policy, which must be agreed before real-company data
is onboarded. Limits, permissions and model/source suitability are part of setup.
