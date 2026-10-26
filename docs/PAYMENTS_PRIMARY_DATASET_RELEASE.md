# Payments primary dataset release — 26 October 2026

The owner requested the entire edited workbook in the main hosted application, selected the Payments-specific model, and chose to retain Supabase Free through storage optimization. Feed Review, Experimental Review and all four ingestion flags stay disabled. No billing upgrade or reduction of the selected population is authorized.

## Reviewed source and inference

- Selected workbook: `Payments_355426_Edited_2026-10-26.xlsx`; SHA-256 `028b093f8031c5c3b4bbbc8d52fe45f6c475a6dbc9350581cb1823ae708796cc`.
- Accepted population: 355,426; rejected: zero. USD total: 31,539,215,226.22. Category remains unavailable, so all records retain PARTIAL input quality even though all five rule checks execute.
- Source dates run from January 2022 through October 2026. Actors, limits, vendor references and time of day are simulated enrichments. Nineteen data actors are not authentication accounts. The matching original workbook supplies 68,117 vendor references; its hash is `29f4f9be083a5ea736f0047a090b1063144eb780757fe75c7f121451aa274269`.
- Runtime model: `payments-primary-no-calendar-1.0.0`; artifact SHA-256 `85b034c6c247e4be4532e7b1f76bd2ec1ab7eac4a76514edccd9ce83910bdbc8`. Private artifact size: 2,903,899 bytes. It uses amount and exact source-name frequency/deviation features, with no calendar, actor, limit or rule-result features.
- All 199,092 Fit and 49,614 Validation inputs match the selected source. Fit reference ranks are recomputed from Fit only. The normalized threshold 99.51 selects 488 Validation candidates, within the frozen raw cutoff capacity of 496. Testing was not used for this threshold selection; historical Testing was previously exposed during research. Full-population inference is not a fresh holdout evaluation. There are no independently verified fraud labels or fraud-accuracy claims.
- All 355,426 rule results were checked against the Python evaluator. SQL reconstruction matched 2,058 detailed parity samples. Existing risk policy remains 60% rule score plus 40% AI rank: 338,885 LOW, 16,541 MEDIUM, zero HIGH. There are 2,976 anomaly candidates; anomaly candidacy and combined-risk alerts have different thresholds.

## Storage and application behavior

Dataset provenance and fixed rule language are stored once. Transactions retain typed rule outcomes, exact context counts, source-row/contract references and model/risk scores; bounded reads reconstruct the existing API shapes. Original amount lexemes and vendor-name exceptions remain per-row. Bulk inference creates no duplicate durable jobs or hundreds of thousands of language-model requests. Main detail pages receive deterministic explanations of saved results.

The complete local PostgreSQL import, including all vendors, alerts and final indexes, measured 244,777,364 additional bytes. With the retained Production database of 88,566,931 bytes, the projected total is 333,344,295 bytes, leaving approximately 167 MB under the 500 MB Free limit. Import RPCs stop at 420 MB and activation stops at 440 MB. Production usage must be measured during and after import; local measurements are not a substitute for that check.

The dataset begins IMPORTING and invisible. Sealing reconciles counts, amount, registry and result completeness. A single guarded pointer change activates it. Old transactions, cases, reviews and saved reports remain in Supabase; archived transaction links remain readable with a dataset label. No authentication identities, assignments or review decisions are fabricated. Auditors see assigned alerts under the existing team rules; Supervisors can assign unassigned alerts. Bulk alerts have no online-request latency and do not enqueue thousands of retrospective notifications.

The model lives in a private Supabase Storage bucket. The backend downloads it with its existing server credential, checks size and SHA-256 before deserialization, and caches it on Render's ephemeral filesystem. The actual saved transaction determines which model applies. Legacy transactions retain the retail model. Missing date/positive amount or non-USD manual inputs have unavailable Payments AI/risk scores. A failed model download never falls back to the retail model for Payments inputs.

## Publication sequence and rollback

1. Verify current Production branch, schema, counts, access and capacity. Preserve the old dataset in place. A proposed full local recovery export was rejected by automatic approval review because it included sensitive profiles, audits, reviews and cases; no such export was performed. Recovery uses the retained records and tested pointer switch.
2. Apply `20261026074357_payments_primary_dataset.sql` while the active dataset remains legacy 0. Run security advisors and service-role/anonymous access probes.
3. Provision the immutable private model object, verify a server download hash, and verify anonymous access fails. Register source/model provenance on a generated IMPORTING dataset ID.
4. Publish the reviewed application commit. Set only `PAYMENTS_PRIMARY_ENABLED=true` on Render; preserve the six existing disabled flags and unrelated environment settings. Both current main-branch deployments are automatic. Check exact deployed commits and public health/CORS/anonymous denials.
5. Send hash-verified vendor records and bounded payment batches to the generated dataset ID. Receipts make payment retries idempotent. Monitor database bytes. Reconcile all 355,426 records, exact USD total, scores and references, then seal and create the actual 16,541 alerts.
6. Verify the source-bound runtime model loads, then activate using the expected old pointer. Verify dataset metadata, dashboard/analytics, lists, details, vendor monitoring, reports, historical workflows and feature gates. Record remaining manual authenticated checks honestly.

Rollback is `activate_primary_dataset(0, <current generated ID>)`, using the existing server/operator channel. Keep the compatible code and primary flag enabled during data rollback; disabling the flag alone does not select the old dataset. This switches the main population without deleting either dataset or its workflow history. Never delete legacy rows to gain space and never publish raw JSONL, workbooks, SQLite files, recovery payloads, or model artifacts to the public repository.

## Validation before publication

The existing backend suite passed 304 tests in the sandbox; two worker-pipe-dependent model tests passed when rerun outside it (all four tests in that model module passed). The five new PostgreSQL dataset tests pass. The existing PostgreSQL business-report tests (4) and transaction/workflow tests (30) pass. The frontend build and all 294 tests pass. Full-population storage, SQL evidence parity, source-only model invariance, serialization and batch/single inference checks pass. Local full-population query timings include vendor page 89 ms, daily summary 38 ms, dashboard 439 ms and analytics 400 ms; hosted timings will differ.

## Production result

The Payments dataset is active in Production as dataset 1. All 355,426 rows, USD 31,539,215,226.22, 68,117 vendor references, 2,976 anomaly candidates and 16,541 MEDIUM alerts reconciled. Storage measured 341,683,347 bytes after import, leaving approximately 158 MB below the conservative 500 MB limit. The 9,853 legacy transactions, one case and four reviews remain available; historical case and review links still join to readable transaction details.

The actual server-side dataset binding selected the private Payments artifact and reproduced 100 saved scores. All three active roles read 355,426 dashboard transactions, 100% coverage and 68,117 vendors. Initial new-alert visibility was 16,541 for Admin/Supervisor and zero for the Auditor, because no new alert assignments were fabricated. A Supervisor must assign new alerts before an Auditor sees them or before they enter a team-scoped report. An empty team has no dated report cohort under the existing rules.

Follow-up migrations preserve dataset-specific report histories and source context. Hosted measurement exposed a business-report plan scanning the full population before applying date bounds. Two measured query refinements removed that scan and redundant alert joins. The final query returned the same 182 latest-day rows in 601 ms, down from 25,891 ms. Report scope, evidence, immutable-history and UTC-boundary tests pass.

Both hosting providers deployed application commit `017b415159a73dafa7eb452e85a30c8253ad7407`; Render deployment `dep-dbfhbq6q1p3s73f7khlg` was live and Vercel Production deployment `7327771826` succeeded at `https://senior-design-a10b4bt4j-omar22222.vercel.app`. Subsequent migration/evidence-only publication retains this application behavior. Public health, Production-origin CORS, unauthorized-access denials and a fresh public browser check passed. No Render error logs were returned for the checked interval.

Security advisors introduced no new warnings; four new service-only RLS tables intentionally have no client policies. Existing `rls_auto_enable` grants and Auth password-protection warnings are unchanged and outside this data release. The model bucket is private; both anonymous download routes returned HTTP 400.

Automatic approval review also rejected a bounded local API/report probe because it would bring Production payloads into a local process. That probe was not run. Verification continued inside the database, returning aggregate checks only. The owner chose to verify signed-in browser workflows in the site; that manual sign-off remains pending. No Production user session was impersonated and no test reviews, cases or assignments were created. Release code is in the isolated checkout described in the work log; the original mixed working tree was not overwritten.
